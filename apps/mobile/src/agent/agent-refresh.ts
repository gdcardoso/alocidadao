import { ApiError } from '@alocidadao/api-client';
import type { AgentWorkOrderCard, AgentWorkOrderDetail } from '@alocidadao/shared';
import type { OutboxItem, WorkOrderActionPayload } from '../offline/outbox';
import type { AgentWorkOrderStore } from './work-order-store';

// Uma atualização da lista do agente, sem nada nativo (testável no Node).

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

export interface AgentRefreshDeps {
  store: AgentWorkOrderStore;
  /** Prefeituras de `me.agentTenants`. */
  tenants: readonly string[];
  fetchList(tenantId: string): Promise<AgentWorkOrderCard[]>;
  fetchDetail(tenantId: string, id: string): Promise<AgentWorkOrderDetail>;
  /** Itens da fila, para achar as ações do agente já enviadas. */
  listOutbox(): Promise<OutboxItem[]>;
  /** Tira da fila as ações enviadas que a lista do servidor já mostra. */
  removeSent(ids: readonly string[]): Promise<void>;
  /** Relê `me` (no máximo uma vez por atualização). */
  refreshMe(): Promise<void>;
  /** Cartões gravados: a tela relê o cache antes dos detalhes. */
  onListsSaved?(): Promise<void>;
}

/** Ações do agente enviadas (`done`) nesta prefeitura. */
async function sentActionIds(deps: AgentRefreshDeps, tenantId: string): Promise<string[]> {
  return (await deps.listOutbox())
    .filter(
      (item) =>
        item.kind === 'work_order_action' &&
        item.status === 'done' &&
        (item.payload as Partial<WorkOrderActionPayload> | null)?.tenantId === tenantId,
    )
    .map((item) => item.id);
}

/**
 * Atualiza o cache com a lista de cada prefeitura e depois baixa o detalhe de cada atividade
 * (404 tira a atividade do cache). Ação enviada só vale na lista até a próxima lista da
 * prefeitura chegar: as que já estavam enviadas antes do pedido saem da fila, porque a
 * resposta já as mostra. Devolve `failed` quando alguma lista não veio.
 */
export async function refreshAgentWorkOrders(deps: AgentRefreshDeps): Promise<{ failed: boolean }> {
  const { store } = deps;
  let failed = false;
  let meStale = false;
  const fetched: AgentWorkOrderCard[] = [];

  for (const tenantId of deps.tenants) {
    try {
      // Antes do pedido: uma ação enviada depois dele ainda pode faltar na resposta.
      const sent = await sentActionIds(deps, tenantId);
      const list = await deps.fetchList(tenantId);
      await store.replaceTenant(tenantId, list);
      if (sent.length > 0) await deps.removeSent(sent);
      fetched.push(...list);
    } catch (cause) {
      failed = true;
      if (needsMe(cause)) meStale = true;
      console.warn('Falha ao atualizar as atividades', tenantId, cause);
    }
  }
  await store.keepTenants(deps.tenants);
  await deps.onListsSaved?.();

  await eachLimited(fetched, DETAIL_CONCURRENCY, async (card) => {
    try {
      await store.saveDetail(await deps.fetchDetail(card.tenantId, card.id));
    } catch (cause) {
      // Concluída ou cancelada no meio do caminho: sai do cache (não é erro).
      if (isGone(cause)) await store.remove(card.id);
      else if (needsMe(cause)) meStale = true;
    }
  });

  if (meStale) await deps.refreshMe().catch(() => undefined);
  return { failed };
}
