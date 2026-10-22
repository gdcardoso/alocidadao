import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api';
import { measureApiLatency, toConnectionContext } from '../lib/connection';
import { readNetSnapshot } from '../lib/net-info';
import { createHttpTransportFromEnv } from './http-transport';
import { processOutbox, type OutboxItem, type ProcessOutboxDeps } from './outbox';
import { createSingleFlight } from './single-flight';
import { openOutboxStore, type SqliteOutboxStore } from './sqlite-outbox-store';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3333';

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
      const transport = createHttpTransportFromEnv(baseUrl);
      const flight: () => Promise<unknown> = createSingleFlight(async () => {
        setSyncing(true);
        try {
          await processOutbox({ store: s, transport, connection });
        } finally {
          setSyncing(false);
          await refresh(s);
          onSyncedRef.current?.();
        }
        // Itens em espera de backoff: tenta de novo quando vencerem (só com rede).
        if (timer.current) clearTimeout(timer.current);
        const waiting = await s.listPending();
        const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
        if (waiting.length > 0 && (await NetInfo.fetch()).isConnected === true) {
          timer.current = setTimeout(() => void flight(), Math.max(next - Date.now(), 0) + 200);
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

  return { store, items, syncing, syncNow, refresh };
}
