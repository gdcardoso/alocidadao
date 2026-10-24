import { randomUUID } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import type { WorkOrderStatus } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { occurrences, requests, workOrders, photos, statusEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let app: Awaited<ReturnType<typeof buildApp>>;
let tenantId: string;
let teamId: string;
let agentId: string;
let managerId: string;
let citizenId: string;
let categoryId: string;
let authHeaders: Record<string, string>;

/** Cria ocorrência, relato e a atividade no status pedido (dono: ignora o RLS). */
async function newWorkOrder(status: WorkOrderStatus) {
  return withContext(owner.db, { tenantId }, async (tx) => {
    const location = geoPoint({ lat: -23.55, lng: -46.63 });
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId, categoryId, location, status: 'in_progress' })
      .returning();
    await tx.insert(requests).values({
      tenantId,
      citizenId,
      categoryId,
      occurrenceId: occurrence!.id,
      status: 'in_progress',
      description: 'Buraco na via, teste do gestor',
      location,
      gpsLocation: location,
    });
    const [order] = await tx
      .insert(workOrders)
      .values({ tenantId, occurrenceId: occurrence!.id, teamId, status })
      .returning();
    return order!.id;
  });
}

/** Foto de conclusão pendente na atividade. */
async function addCompletionPhoto(workOrderId: string) {
  const [photo] = await owner.db
    .insert(photos)
    .values({
      tenantId,
      workOrderId,
      storageKey: `${tenantId}/uploads/${randomUUID()}.jpg`,
      uploadedBy: agentId,
      review: 'pending',
      purpose: 'completion',
    })
    .returning();
  return photo!.id;
}

const manage = (workOrderId: string, payload: unknown, target = app) =>
  target.inject({
    method: 'POST',
    url: `/dev/work-orders/${workOrderId}/manager`,
    headers: authHeaders,
    payload: payload as never,
  });

async function eventsOf(workOrderId: string) {
  return owner.db.select().from(statusEvents).where(eq(statusEvents.workOrderId, workOrderId));
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  ({ tenantId, teamId, agentId, managerId } = seeded);
  const [row] = await owner.db
    .select({ citizenId: requests.citizenId, categoryId: requests.categoryId })
    .from(requests)
    .where(eq(requests.tenantId, tenantId))
    .limit(1);
  citizenId = row!.citizenId;
  categoryId = row!.categoryId;
  authHeaders = { ...(await appAuthHeader(appDb.db, agentId)), 'x-tenant-id': tenantId };
  app = await buildApp({ devRoutes: true, database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app?.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('dev manager actions', () => {
  it('dev request_rework discards the chosen photos and records reasons', async () => {
    const id = await newWorkOrder('awaiting_review');
    const [dark, good] = [await addCompletionPhoto(id), await addCompletionPhoto(id)];
    const res = await manage(id, {
      action: 'request_rework',
      reasons: ['new_photos', 'return_to_site'],
      message: 'A foto ficou escura, tire outra de perto.',
      discardedPhotoIds: [dark],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workOrderId: id, status: 'rework_requested' });

    const stored = await owner.db.select().from(photos).where(eq(photos.workOrderId, id));
    expect(stored.find((p) => p.id === dark)?.review).toBe('discarded');
    expect(stored.find((p) => p.id === good)?.review).toBe('pending');

    const [order] = await owner.db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(order?.status).toBe('rework_requested');
    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromStatus: 'awaiting_review',
      toStatus: 'rework_requested',
      actorUserId: managerId,
      comment: 'A foto ficou escura, tire outra de perto.',
      details: { reasons: ['new_photos', 'return_to_site'], discardedPhotoIds: [dark] },
    });
  });

  it('dev request_rework refuses a photo of another work order', async () => {
    const id = await newWorkOrder('awaiting_review');
    const foreign = await addCompletionPhoto(await newWorkOrder('awaiting_review'));
    const res = await manage(id, {
      action: 'request_rework',
      reasons: ['new_photos'],
      message: 'Tire outra foto.',
      discardedPhotoIds: [foreign],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'photo_not_found' });
    expect(await eventsOf(id)).toHaveLength(0);
  });

  it('dev request_rework outside awaiting_review is 409 work_order_unavailable', async () => {
    const id = await newWorkOrder('assigned');
    const res = await manage(id, {
      action: 'request_rework',
      reasons: ['new_note'],
      message: 'Conte melhor o que foi feito.',
      discardedPhotoIds: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'work_order_unavailable', status: 'assigned' });
  });

  it('dev reschedule brings an impeded work order back to assigned', async () => {
    const id = await newWorkOrder('impeded');
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const res = await manage(id, { action: 'reschedule', dueAt });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workOrderId: id, status: 'assigned' });
    const [order] = await owner.db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(order?.status).toBe('assigned');
    expect(order?.dueAt?.toISOString()).toBe(dueAt);
    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromStatus: 'impeded',
      toStatus: 'assigned',
      actorUserId: managerId,
    });
  });

  it('unknown work order is 404', async () => {
    const res = await manage(randomUUID(), { action: 'reschedule', dueAt: null });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'work_order_not_found' });
  });

  it('is not registered without dev routes', async () => {
    const prod = await buildApp({ database: appDb.db, auth: testAuthOptions });
    const res = await manage(randomUUID(), { action: 'reschedule', dueAt: null }, prod);
    await prod.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toEqual({ code: 'work_order_not_found' });
  });
});
