import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createSessionTransport } from '../auth/native-session';
import { api } from '../lib/api';
import { measureApiLatency, toConnectionContext } from '../lib/connection';
import { readNetSnapshot } from '../lib/net-info';
import { processOutbox, type OutboxItem, type ProcessOutboxDeps } from './outbox';
import { createSingleFlight } from './single-flight';
import { openOutboxStore, type SqliteOutboxStore } from './sqlite-outbox-store';

/** Monta o contexto de conexão de cada ação enviada (rede, latência até a API, upload, offline). */
const connection: ProcessOutboxDeps['connection'] = async (m) => {
  const net = await readNetSnapshot();
  const apiLatencyMs = await measureApiLatency(() => api.health());
  return toConnectionContext(net, {
    apiLatencyMs,
    uploadDurationMs: m.uploadDurationMs,
    sentOffline: m.sentOffline,
  });
};

/**
 * Dispara a fila ao ganhar rede, ao voltar ao primeiro plano e sob demanda.
 * `onSynced` roda depois de cada passada (a tela atualiza lista e status locais).
 */
export function useOutboxSync(onSynced?: () => void) {
  const [store, setStore] = useState<SqliteOutboxStore | null>(null);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  });

  const refresh = useCallback(async (s: SqliteOutboxStore) => setItems(await s.list()), []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<(() => Promise<unknown>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void openOutboxStore().then((s) => {
      if (cancelled) return;
      const flight: () => Promise<unknown> = createSingleFlight(async () => {
        if (cancelled) return;
        setSyncing(true);
        try {
          // Montado a cada passada: pega a sessão e a prefeitura do login atual.
          const transport = await createSessionTransport();
          await processOutbox({ store: s, transport, connection });
          if (!cancelled) setLastSyncError(null);
        } catch (error) {
          // Uma passada que falha não pode derrubar o rearme do timer nem virar rejeição solta.
          console.warn('Falha na sincronização da fila', error);
          if (!cancelled) setLastSyncError(error instanceof Error ? error.message : String(error));
        } finally {
          if (!cancelled) {
            setSyncing(false);
            try {
              await refresh(s);
            } catch (error) {
              console.warn('Falha ao ler a fila', error);
            }
            onSyncedRef.current?.();
          }
        }
        // Itens em espera de backoff: tenta de novo quando vencerem (só com rede).
        try {
          if (timer.current) clearTimeout(timer.current);
          const waiting = await s.listPending();
          const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
          if (!cancelled && waiting.length > 0 && (await NetInfo.fetch()).isConnected === true) {
            timer.current = setTimeout(() => void flight(), Math.max(next - Date.now(), 0) + 200);
          }
        } catch (error) {
          console.warn('Falha ao reagendar a fila', error);
        }
      });
      runRef.current = flight;
      setStore(s);
      void refresh(s);
      void flight();
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  useEffect(() => {
    const trigger = () => void runRef.current?.();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && state.isInternetReachable !== false) trigger();
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') trigger();
    });
    return () => {
      unsubscribeNet();
      sub.remove();
    };
  }, []);

  const syncNow = useCallback(async () => {
    await runRef.current?.();
  }, []);

  return { store, items, syncing, lastSyncError, syncNow, refresh };
}
