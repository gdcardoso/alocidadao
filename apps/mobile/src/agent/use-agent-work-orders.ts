import { ApiError } from '@alocidadao/api-client';
import type { AgentWorkOrderCard, AgentWorkOrderDetail, GeoPoint } from '@alocidadao/shared';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionApi } from '../auth/native-session';
import { useSession } from '../auth/use-session';
import { getCurrentPoint } from '../lib/location';
import { isOnline } from '../lib/net-info';
import { onOutboxSynced, removeOutboxItem } from '../offline/outbox-service';
import { openAppDatabase } from '../offline/sqlite-outbox-store';
import { useOutbox } from '../offline/use-outbox-sync';
import {
  offlineBanner,
  pendingSendCount,
  teamHeader,
  toAgentList,
  type AgentList,
} from './agent-view';
import { AgentWorkOrderStore } from './work-order-store';

// Lista do agente (A1): cache no SQLite, atualizado de todas as prefeituras do agente.

/** Cache das atividades no banco do app. */
export async function openAgentStore(): Promise<AgentWorkOrderStore> {
  return new AgentWorkOrderStore(await openAppDatabase());
}

/** O agente abriu o detalhe: a atividade deixa de ser "Nova" (até ser reagendada). */
export async function markWorkOrderSeen(id: string, assignedAt: string): Promise<void> {
  await (await openAgentStore()).markSeen(id, assignedAt);
}

/** Detalhe guardado no cache (para abrir sem rede). */
export async function cachedWorkOrderDetail(id: string): Promise<AgentWorkOrderDetail | null> {
  return (await openAgentStore()).detail(id);
}

const errorCode = (error: unknown) =>
  error instanceof ApiError ? (error.body as { code?: unknown } | null)?.code : undefined;

/** O detalhe dá 404 quando a atividade foi concluída, cancelada ou saiu da equipe. */
const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Sessão recusada (401) ou vínculo encerrado (403 `not_a_member`): relê `me`. */
const needsMe = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === 401 || (error.status === 403 && errorCode(error) === 'not_a_member'));

/** Detalhes baixados ao mesmo tempo. */
const DETAIL_CONCURRENCY = 4;

async function eachLimited<T>(
  list: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < list.length) await run(list[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

/**
 * `loading`: lendo o cache ou na primeira atualização. `unavailable`: sem cache e sem
 * atualização (sem rede ou com erro): "Não foi possível carregar as atividades.".
 */
export type AgentListPhase = 'loading' | 'ready' | 'unavailable';

export interface AgentWorkOrdersState {
  list: AgentList;
  phase: AgentListPhase;
  refreshing: boolean;
  /** A última atualização falhou (a lista do cache continua na tela). */
  error: boolean;
  refresh(): Promise<void>;
  online: boolean;
  /** Faixa offline da A1 (`null` com rede). */
  banner: string | null;
  /** Nome da equipe ou `{n} equipes`; `null` sem atividades. */
  team: string | null;
  /** "Remover envio" do aviso: tira o item da fila e as fotos dele. */
  removeSend(itemId: string): Promise<void>;
}

/**
 * Atividades do agente para a A1. Lê o cache na hora; com rede, atualiza de todas as
 * prefeituras de `me.agentTenants` (ao abrir, ao voltar a rede, depois de cada passada da fila
 * com envio e no "puxar para atualizar") e baixa o detalhe de cada atividade para o cache.
 */
export function useAgentWorkOrders(): AgentWorkOrdersState {
  const { me, refreshMe } = useSession();
  const { items: queue } = useOutbox();
  const [cards, setCards] = useState<AgentWorkOrderCard[] | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [here, setHere] = useState<GeoPoint | null>(null);
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [synced, setSynced] = useState(false);
  // Referência dos tempos relativos ("há 10 min"), renovada a cada leitura do cache.
  const [now, setNow] = useState(() => new Date());

  const tenantKey = me ? me.agentTenants.map((t) => t.tenantId).join(',') : null;
  const tenantsRef = useRef<string[] | null>(null);
  const refreshMeRef = useRef(refreshMe);
  // Declarado antes dos efeitos que atualizam: eles já leem as prefeituras novas.
  useEffect(() => {
    tenantsRef.current = tenantKey === null ? null : tenantKey.split(',').filter(Boolean);
    refreshMeRef.current = refreshMe;
  }, [tenantKey, refreshMe]);

  const reloadCache = useCallback(async () => {
    const store = await openAgentStore();
    const [list, keys] = await Promise.all([store.list(), store.seenKeys()]);
    setCards(list);
    setSeen(keys);
    setNow(new Date());
  }, []);

  const readHere = useCallback(async () => {
    const current = await getCurrentPoint();
    if ('point' in current) setHere(current.point);
    // Sem permissão a distância some; GPS sem resposta mantém a última posição.
    else if (current.error === 'permission_denied') setHere(null);
  }, []);

  const handleApiError = useCallback((cause: unknown) => {
    if (needsMe(cause)) void refreshMeRef.current().catch(() => undefined);
  }, []);

  /** Uma atualização: listas de todas as prefeituras, depois os detalhes. */
  const pass = useCallback(async () => {
    const tenants = tenantsRef.current;
    // Sem `me` (app aberto sem rede) não se sabe as prefeituras: fica o cache.
    if (tenants === null || !(await isOnline())) {
      setAttempted(true);
      return;
    }
    setRefreshing(true);
    const location = readHere().catch(() => undefined);
    try {
      const store = await openAgentStore();
      let failed = false;
      const fetched: AgentWorkOrderCard[] = [];
      for (const tenantId of tenants) {
        try {
          const list = await sessionApi.agentWorkOrders(tenantId);
          await store.replaceTenant(tenantId, list);
          fetched.push(...list);
        } catch (cause) {
          failed = true;
          handleApiError(cause);
          console.warn('Falha ao atualizar as atividades', tenantId, cause);
        }
      }
      await store.keepTenants(tenants);
      await reloadCache();
      await eachLimited(fetched, DETAIL_CONCURRENCY, async (card) => {
        try {
          await store.saveDetail(await sessionApi.agentWorkOrder(card.tenantId, card.id));
        } catch (cause) {
          // Concluída ou cancelada no meio do caminho: sai do cache (não é erro).
          if (isGone(cause)) await store.remove(card.id);
          else handleApiError(cause);
        }
      });
      await reloadCache();
      setError(failed);
      if (!failed) setSynced(true);
    } catch (cause) {
      console.warn('Falha ao atualizar as atividades', cause);
      setError(true);
    } finally {
      await location;
      setRefreshing(false);
      setAttempted(true);
    }
  }, [handleApiError, readHere, reloadCache]);

  // Uma atualização por vez; um pedido durante a atual roda de novo no fim (ex.: `me` mudou).
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = async () => {
      do {
        again.current = false;
        await pass();
      } while (again.current);
    };
    running.current = run().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [pass]);

  // Posição do aparelho para a distância (relida a cada atualização).
  useEffect(() => {
    void (async () => {
      await readHere().catch(() => undefined);
    })();
  }, [readHere]);

  // Prefeituras do agente conhecidas ou mudadas (ex.: vínculo encerrado): atualiza.
  useEffect(() => {
    if (tenantKey !== null) void refresh();
  }, [tenantKey, refresh]);

  // Ao abrir e ao voltar para a tela (ex.: depois do detalhe), relê o cache e as atividades
  // abertas: sem rede, a lista já aparece.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          await reloadCache();
        } catch (cause) {
          console.warn('Falha ao ler o cache das atividades', cause);
          setCards((prev) => prev ?? []);
        }
      })();
    }, [reloadCache]),
  );

  // Rede: a faixa offline e a atualização quando o sinal volta.
  const wasOnline = useRef(true);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        const next = state.isConnected === true && state.isInternetReachable !== false;
        setOnline(next);
        if (next && !wasOnline.current) void refresh();
        wasOnline.current = next;
      }),
    [refresh],
  );

  // A fila enviou algo: o servidor já tem o status novo.
  useEffect(
    () =>
      onOutboxSynced(({ sent }) => {
        if (sent > 0) void refresh();
      }),
    [refresh],
  );

  const list = useMemo(
    () => toAgentList({ cards: cards ?? [], queue, seen, here, now }),
    [cards, queue, seen, here, now],
  );

  const removeSend = useCallback(async (itemId: string) => {
    await removeOutboxItem(itemId);
  }, []);

  let phase: AgentListPhase;
  if (cards === null) phase = 'loading';
  else if (cards.length > 0 || synced) phase = 'ready';
  // Sem `me` (app aberto sem rede) não há atualização a esperar.
  else if ((!attempted && tenantKey !== null) || refreshing) phase = 'loading';
  else phase = 'unavailable';

  return {
    list,
    phase,
    refreshing,
    error,
    refresh,
    online,
    banner: offlineBanner(online, pendingSendCount(queue)),
    team: teamHeader(cards ?? []),
    removeSend,
  };
}
