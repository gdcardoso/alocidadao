import { describe, expect, it } from 'vitest';
import { nodeDb } from '../offline/node-db';
import { migrateOutbox } from '../offline/outbox-schema';
import { TENANT_A, TENANT_B, makeCard, makeDetail, wo } from './test-helpers';
import { AgentWorkOrderStore } from './work-order-store';

async function newStore(now = () => 1000) {
  const db = nodeDb();
  await migrateOutbox(db, async () => null);
  return { db, store: new AgentWorkOrderStore(db, now) };
}

describe('AgentWorkOrderStore', () => {
  it('replaces the cards of one tenant and keeps the others', async () => {
    const { store } = await newStore();
    await store.replaceTenant(TENANT_A, [makeCard({ id: wo(1) }), makeCard({ id: wo(2) })]);
    await store.replaceTenant(TENANT_B, [makeCard({ id: wo(3), tenantId: TENANT_B })]);

    await store.replaceTenant(TENANT_A, [makeCard({ id: wo(2), status: 'in_execution' })]);

    const ids = (await store.list()).map((c) => [c.id, c.status]);
    expect(ids).toEqual([
      [wo(2), 'in_execution'],
      [wo(3), 'assigned'],
    ]);
  });

  it('keeps the saved detail when the card is refreshed and drops it with the card', async () => {
    const { store } = await newStore();
    await store.replaceTenant(TENANT_A, [makeCard()]);
    const detail = makeDetail({ status: 'in_execution' });
    await store.saveDetail(detail);
    expect(await store.detail(wo(1))).toEqual(detail);
    // O detalhe traz o cartão mais novo também.
    expect((await store.list())[0]?.status).toBe('in_execution');

    await store.replaceTenant(TENANT_A, [makeCard({ reportCount: 7 })]);
    expect(await store.detail(wo(1))).toEqual(detail);

    await store.replaceTenant(TENANT_A, []);
    expect(await store.detail(wo(1))).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('removes one work order and the tenants the agent left', async () => {
    const { store } = await newStore();
    await store.replaceTenant(TENANT_A, [makeCard({ id: wo(1) }), makeCard({ id: wo(2) })]);
    await store.replaceTenant(TENANT_B, [makeCard({ id: wo(3), tenantId: TENANT_B })]);

    await store.remove(wo(1));
    await store.keepTenants([TENANT_A]);

    expect((await store.list()).map((c) => c.id)).toEqual([wo(2)]);
  });

  it('remembers opened work orders by id and assignment', async () => {
    const { store } = await newStore();
    await store.markSeen(wo(1), '2026-10-24T10:00:00.000Z');
    await store.markSeen(wo(1), '2026-10-24T10:00:00.000Z');
    expect([...(await store.seenKeys())]).toEqual([`${wo(1)}:2026-10-24T10:00:00.000Z`]);
  });

  it('skips unreadable rows and clears everything', async () => {
    const { db, store } = await newStore();
    await store.replaceTenant(TENANT_A, [makeCard({ id: wo(1) }), makeCard({ id: wo(2) })]);
    db.raw.prepare(`UPDATE agent_work_orders SET card_json = '{x' WHERE id = ?`).run(wo(1));
    expect((await store.list()).map((c) => c.id)).toEqual([wo(2)]);

    await store.markSeen(wo(2), '2026-10-24T10:00:00.000Z');
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect((await store.seenKeys()).size).toBe(0);
  });
});
