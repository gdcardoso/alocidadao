import { ApiError } from '@alocidadao/api-client';
import type { AgentWorkOrderDetail, GeoPoint } from '@alocidadao/shared';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionApi } from '../auth/native-session';
import { useSession } from '../auth/use-session';
import { getCurrentPoint, getLastKnownPoint } from '../lib/location';
import { isOnline } from '../lib/net-info';
import { openAgentStore } from './use-agent-work-orders';

// Detalhe da atividade do agente (A2/A5): abre do cache (sem rede também) e atualiza com rede.

/**
 * `loading`: lendo o cache ou buscando sem cache. `gone`: o servidor não tem mais a atividade
 * com o agente (concluída, cancelada ou de outra equipe). `unavailable`: sem cache e sem rede
 * (ou com erro).
 */
export type AgentWorkOrderState =
  | { phase: 'loading' }
  | { phase: 'ready'; detail: AgentWorkOrderDetail }
  | { phase: 'gone' }
  | { phase: 'unavailable' };

export interface AgentWorkOrderResult {
  state: AgentWorkOrderState;
  /** Posição do aparelho (distância até a ocorrência); `null` sem localização. */
  here: GeoPoint | null;
  /** Referência dos tempos relativos ("devolvido há 20 min"), renovada a cada leitura. */
  now: Date;
  reload(): Promise<void>;
}

/** Prefeitura da atividade: do detalhe ou do cartão no cache; sem eles, todas as do agente. */
async function tenantsFor(id: string, cached: AgentWorkOrderDetail | null, all: string[]) {
  if (cached) return [cached.tenantId];
  const card = (await (await openAgentStore()).list()).find((c) => c.id === id);
  return card ? [card.tenantId] : all;
}

export function useAgentWorkOrder(id: string): AgentWorkOrderResult {
  const { me, refreshMe } = useSession();
  const [state, setState] = useState<AgentWorkOrderState>({ phase: 'loading' });
  const [here, setHere] = useState<GeoPoint | null>(null);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);
  const tenantsRef = useRef<string[]>([]);
  const refreshMeRef = useRef(refreshMe);
  useEffect(() => {
    tenantsRef.current = me ? me.agentTenants.map((t) => t.tenantId) : [];
    refreshMeRef.current = refreshMe;
  }, [me, refreshMe]);

  const load = useCallback(async () => {
    const call = ++latest.current;
    const current = () => call === latest.current;
    setNow(new Date());
    const store = await openAgentStore();
    const cached = await store.detail(id);
    if (cached && current()) {
      setState({ phase: 'ready', detail: cached });
      // Aberta: deixa de ser "Nova" (até ser reagendada).
      await store.markSeen(cached.id, cached.assignedAt);
    }
    if (!(await isOnline())) {
      if (!cached && current()) setState({ phase: 'unavailable' });
      return;
    }
    let missing = false;
    for (const tenantId of await tenantsFor(id, cached, tenantsRef.current)) {
      try {
        const fresh = await sessionApi.agentWorkOrder(tenantId, id);
        await store.saveDetail(fresh);
        await store.markSeen(fresh.id, fresh.assignedAt);
        if (current()) setState({ phase: 'ready', detail: fresh });
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Sessão recusada: refreshMe leva para o login.
          void refreshMeRef.current().catch(() => undefined);
          break;
        }
        if (error instanceof ApiError && error.status === 404) {
          missing = true;
          continue;
        }
        console.warn('Falha ao atualizar a atividade', error);
        if (!cached && current()) setState({ phase: 'unavailable' });
        return;
      }
    }
    if (missing) {
      // Saiu do agente: tira do cache para a A1 também não mostrar mais.
      await store.remove(id);
      if (current()) setState({ phase: 'gone' });
    } else if (!cached && current()) setState({ phase: 'unavailable' });
  }, [id]);

  const reload = useCallback(async () => {
    try {
      await load();
    } catch (cause) {
      console.warn('Falha ao abrir a atividade', cause);
      setState((prev) => (prev.phase === 'ready' ? prev : { phase: 'unavailable' }));
    }
  }, [load]);

  // Ao abrir e ao voltar (ex.: da galeria ou da A3).
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // A rede voltou: atualiza.
  const wasOnline = useRef(true);
  useEffect(
    () =>
      NetInfo.addEventListener((net) => {
        const next = net.isConnected === true && net.isInternetReachable !== false;
        if (next && !wasOnline.current) void reload();
        wasOnline.current = next;
      }),
    [reload],
  );

  useEffect(() => {
    void (async () => {
      // A última posição conhecida mostra a distância na hora; o GPS a refina depois.
      const last = await getLastKnownPoint();
      if (last) setHere((prev) => prev ?? last);
      const current = await getCurrentPoint();
      if ('point' in current) setHere(current.point);
    })().catch(() => undefined);
  }, []);

  return { state, here, now, reload };
}
