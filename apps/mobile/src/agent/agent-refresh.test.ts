import { ApiError } from '@alocidadao/api-client';
import type { AgentWorkOrderCard } from '@alocidadao/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeDb } from '../offline/node-db';
import { migrateOutbox } from '../offline/outbox-schema';
import { MemoryOutboxStore, makeItem } from '../offline/test-helpers';
import { refreshAgentWorkOrders, type AgentRefreshDeps } from './agent-refresh';
import { toAgentList } from './agent-view';
import { TENANT_A, TENANT_B, makeCard, makeDetail, wo } from './test-helpers';
import { AgentWorkOrderStore } from './work-order-store';

const NOW = new Date('2026-10-24T12:00:00.000Z');

async function setup(lists: Record<string, AgentWorkOrderCard[] | Error>) {
  const db = nodeDb();
  await migrateOutbox(db, async () => null);
  const store = new AgentWorkOrderStore(db);
  const outbox = new MemoryOutboxStore();
  const removed: string[][] = [];
  const refreshMe = vi.fn(async () => undefined);
  const deps: AgentRefreshDeps = {
    store,
    tenants: Object.keys(lists),
    fetchList: async (tenantId) => {
      const result = lists[tenantId]!;
      if (result instanceof Error) throw result;
      return result;
    },
    fetchDetail: async (_tenantId, id) => {
      const card = Object.values(lists)
        .flatMap((l) => (l instanceof Error ? [] : l))
        .find((c) => c.id === id)!;
      return makeDetail(card);
    },
    listOutbox: () => outbox.list(),
    removeSent: async (ids) => {
      removed.push([...ids]);
      for (const id of ids) await outbox.remove(id);
    },
    refreshMe,
  };
  return { store, outbox, deps, removed, refreshMe };
}

const view = async (store: AgentWorkOrderStore, outbox: MemoryOutboxStore) =>
  toAgentList({
    cards: await store.list(),
    queue: await outbox.list(),
    seen: new Set(),
    here: null,
    now: NOW,
  });

describe('agent refresh', () => {
  it('done action is pruned after the tenant list refreshes', async () => {
    const { outbox, deps, removed } = await setup({
      [TENANT_A]: [makeCard({ id: wo(1), status: 'in_execution' })],
      [TENANT_B]: new Error('network'),
    });
    const sentA = makeItem({
      id: 'a-done',
      tenantId: TENANT_A,
      workOrderId: wo(1),
      status: 'done',
    });
    const pendingA = makeItem({ id: 'a-pending', tenantId: TENANT_A, status: 'pending' });
    const conflictA = makeItem({ id: 'a-conflict', tenantId: TENANT_A, status: 'conflict' });
    // A lista da outra prefeitura não veio: a ação enviada dela continua cobrindo o cartão.
    const sentB = makeItem({ id: 'b-done', tenantId: TENANT_B, status: 'done' });
    for (const item of [sentA, pendingA, conflictA, sentB]) await outbox.add(item);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await refreshAgentWorkOrders(deps)).toEqual({ failed: true });

    expect(removed).toEqual([['a-done']]);
    expect((await outbox.list()).map((i) => i.id)).toEqual(['a-pending', 'a-conflict', 'b-done']);
  });

  it('rework after a sent complete shows even with the phone clock ahead', async () => {
    const lists: Record<string, AgentWorkOrderCard[]> = {
      [TENANT_A]: [makeCard({ id: wo(1), status: 'in_execution' })],
    };
    const { store, outbox, deps } = await setup(lists);
    await refreshAgentWorkOrders(deps);
    // Concluída e enviada, com o relógio do aparelho 1 h à frente do servidor.
    await outbox.add(
      makeItem({
        id: 'done-complete',
        workOrderId: wo(1),
        action: 'complete',
        status: 'done',
        occurredAt: '2026-10-24T13:00:00.000Z',
      }),
    );
    // Antes da próxima lista, a ação enviada cobre o cartão antigo.
    expect((await view(store, outbox)).items[0]?.badge.label).toBe('Aguardando revisão');

    // O gestor pediu ajuste logo depois (hora do servidor antes da hora do aparelho).
    lists[TENANT_A] = [
      makeCard({
        id: wo(1),
        status: 'rework_requested',
        statusChangedAt: '2026-10-24T12:05:00.000Z',
      }),
    ];
    await refreshAgentWorkOrders(deps);

    expect((await view(store, outbox)).items[0]?.badge.label).toBe('Ajuste pedido');
  });

  it('asks for me once per pass and drops work orders whose detail is gone', async () => {
    const notMember = new ApiError(403, { code: 'not_a_member' });
    const { store, deps, refreshMe } = await setup({
      [TENANT_A]: [makeCard({ id: wo(1) }), makeCard({ id: wo(2) })],
      [TENANT_B]: notMember,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deps.fetchDetail = async (_tenantId, id) => {
      if (id === wo(1)) throw new ApiError(404, { code: 'work_order_not_found' });
      throw new ApiError(401, { code: 'unauthorized' });
    };

    await refreshAgentWorkOrders(deps);

    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect((await store.list()).map((c) => c.id)).toEqual([wo(2)]);
  });
});
