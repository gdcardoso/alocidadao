import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { occurrences, requests, statusEvents, workOrders } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let app: Awaited<ReturnType<typeof buildApp>>;
let tenantId: string;
let teamId: string;
let citizenId: string;
let categoryId: string;
let authHeaders: Record<string, string>;

/** Cria ocorrência, a solicitação dela e a atividade atribuída à equipe (dono: ignora o RLS). */
async function freshWorkOrder() {
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
      description: 'Buraco na via, teste de atividade',
      location,
      gpsLocation: location,
    });
    const [order] = await tx
      .insert(workOrders)
      .values({ tenantId, occurrenceId: occurrence!.id, teamId })
      .returning();
    return order!.id;
  });
}

const cancel = (id: string) =>
  app.inject({ method: 'POST', url: `/dev/work-orders/${id}/cancel`, headers: authHeaders });

async function countStatusEvents(workOrderId: string) {
  const rows = await owner.db
    .select()
    .from(statusEvents)
    .where(eq(statusEvents.workOrderId, workOrderId));
  return rows.length;
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  ({ tenantId, teamId } = seeded);
  const [row] = await owner.db
    .select({ citizenId: requests.citizenId, categoryId: requests.categoryId })
    .from(requests)
    .where(eq(requests.tenantId, tenantId))
    .limit(1);
  citizenId = row!.citizenId;
  categoryId = row!.categoryId;
  authHeaders = { ...(await appAuthHeader(appDb.db, seeded.agentId)), 'x-tenant-id': tenantId };
  app = await buildApp({ devRoutes: true, database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app?.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('dev cancel', () => {
  it('cancels an active work order with one event', async () => {
    const id = await freshWorkOrder();
    const res = await cancel(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workOrderId: id, status: 'cancelled' });
    expect(await countStatusEvents(id)).toBe(1);
  });

  it('cancelling an already cancelled work order is idempotent', async () => {
    const id = await freshWorkOrder();
    const first = await cancel(id);
    expect(first.statusCode).toBe(200);
    const events = await countStatusEvents(id);
    const second = await cancel(id);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await countStatusEvents(id)).toBe(events);
  });

  it('the agent actions route left the dev routes', async () => {
    const id = await freshWorkOrder();
    const res = await app.inject({
      method: 'POST',
      url: `/dev/work-orders/${id}/actions`,
      headers: authHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
