import type { AgentWorkOrderCard, AgentWorkOrderDetail, GeoPoint } from '@alocidadao/shared';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionApi } from '../auth/native-session';
import { useSession } from '../auth/use-session';
import { getCurrentPoint } from '../lib/location';
import { isOnline } from '../lib/net-info';
import {
  onOutboxSynced,
  removeOutboxItem,
  removeSentAgentActions,
} from '../offline/outbox-service';
import { openAppDatabase, openOutboxStore } from '../offline/sqlite-outbox-store';
import { useOutbox } from '../offline/use-outbox-sync';
import {
  offlineBanner,
  pendingSendCount,
  teamHeader,
  toAgentList,
  type AgentList,
} from './agent-view';
import { refreshAgentWorkOrders } from './agent-refresh';
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
  /** Posição do aparelho (o agente no mapa); `null` sem localização. */
  here: GeoPoint | null;
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
  useEffect(() => {
    refreshMeRef.current = refreshMe;
  }, [refreshMe]);

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

  /** Uma atualização: listas de todas as prefeituras, depois os detalhes. */
  const pass = useCallback(async () => {
    // A posição vem à parte: esperar o GPS não segura o "atualizando".
    void readHere().catch(() => undefined);
    const tenants = tenantsRef.current;
    if (!(await isOnline())) {
      setAttempted(true);
      return;
    }
    // Sem `me` (app aberto sem rede) não se sabe as prefeituras: fica o cache. Com a rede de
    // volta, busca `me`; as prefeituras chegam por ele e disparam a atualização.
    if (tenants === null) {
      // Enquanto `me` chega, a A1 mostra "carregando" (não "Não foi possível carregar"). Com
      // `me`, as prefeituras disparam a próxima atualização, que desliga o `refreshing`.
      setRefreshing(true);
      const ok = await refreshMeRef.current().then(
        () => true,
        (cause: unknown) => {
          console.warn('Falha ao buscar o usuário', cause);
          return false;
        },
      );
      if (!ok) setRefreshing(false);
      setAttempted(true);
      return;
    }
    setRefreshing(true);
    try {
      const { failed } = await refreshAgentWorkOrders({
        store: await openAgentStore(),
        tenants,
        fetchList: (tenantId) => sessionApi.agentWorkOrders(tenantId),
        fetchDetail: (tenantId, id) => sessionApi.agentWorkOrder(tenantId, id),
        listOutbox: async () => (await openOutboxStore()).list(),
        removeSent: removeSentAgentActions,
        refreshMe: () => refreshMeRef.current(),
        onListsSaved: reloadCache,
      });
      await reloadCache();
      setError(failed);
      if (!failed) setSynced(true);
    } catch (cause) {
      console.warn('Falha ao atualizar as atividades', cause);
      setError(true);
    } finally {
      setRefreshing(false);
      setAttempted(true);
    }
  }, [readHere, reloadCache]);

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

  // Ao abrir e quando as prefeituras do agente mudam (ex.: vínculo encerrado): atualiza. Cada
  // atualização também relê a posição do aparelho (mesmo sem rede).
  useEffect(() => {
    tenantsRef.current = tenantKey === null ? null : tenantKey.split(',').filter(Boolean);
    void refresh();
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
    here,
    banner: offlineBanner(online, pendingSendCount(queue)),
    team: teamHeader(cards ?? []),
    removeSend,
  };
}
