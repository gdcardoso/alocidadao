import { randomUUID } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import type { ConnectionContext } from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage, newPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { tenants, users, memberships, departments, teams, teamMembers, categories, requests } =
  schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);

const connection: ConnectionContext = {
  networkType: 'cellular',
  cellularGeneration: '4g',
  apiLatencyMs: 120,
  uploadDurationMs: null,
  sentOffline: true,
};

let app: Awaited<ReturnType<typeof buildApp>>;
let tenantId: string;
let teamId: string;
let agentId: string;
let outsiderId: string;
let wo: string[];
let otherTenantId: string;
let otherTenantAgentId: string;
let otherTenantWorkOrder: string;
let citizenId: string;
let categoryId: string;

/** Cria prefeitura, equipe, agente, categoria, cidadão e uma atividade (dono: ignora o RLS). */
async function seedTenant(label: string, ibgeCode: string) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({ name: `Prefeitura ${label}`, city: label, state: 'SP', ibgeCode, active: true })
    .returning();
  const [agent] = await owner.db
    .insert(users)
    .values({ name: `Agente ${label}`, email: `agente.${label}@obras.dev`, passwordHash: 'x' })
    .returning();
  const [citizen] = await owner.db
    .insert(users)
    .values({ name: `Cidadão ${label}`, email: `cidadao.${label}@obras.dev`, passwordHash: 'x' })
    .returning();
  await owner.db.insert(memberships).values({
    tenantId: tenant!.id,
    userId: agent!.id,
    role: 'field_agent',
  });
  const [dept] = await owner.db
    .insert(departments)
    .values({ tenantId: tenant!.id, name: 'Obras' })
    .returning();
  const [team] = await owner.db
    .insert(teams)
    .values({ tenantId: tenant!.id, departmentId: dept!.id, name: 'Equipe' })
    .returning();
  await owner.db
    .insert(teamMembers)
    .values({ tenantId: tenant!.id, teamId: team!.id, userId: agent!.id });
  const [category] = await owner.db
    .insert(categories)
    .values({ tenantId: tenant!.id, departmentId: dept!.id, name: 'Buraco' })
    .returning();
  const workOrderId = await newWorkOrder(tenant!.id, team!.id, citizen!.id, category!.id);
  return { tenantId: tenant!.id, agentId: agent!.id, workOrderId };
}

async function newWorkOrder(tid: string, teamIdArg: string, citizen: string, category: string) {
  // O protocolo sai de next_request_protocol(), que lê a prefeitura do contexto.
  return withContext(owner.db, { tenantId: tid }, async (tx) => {
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId: tid,
        citizenId: citizen,
        categoryId: category,
        description: 'Buraco na via, teste de atividade',
        location: geoPoint({ lat: -23.55, lng: -46.63 }),
      })
      .returning();
    const [order] = await tx
      .insert(schema.workOrders)
      .values({ tenantId: tid, requestId: request!.id, teamId: teamIdArg })
      .returning();
    return order!.id;
  });
}

const freshWorkOrder = () => newWorkOrder(tenantId, teamId, citizenId, categoryId);

function headers(as: { tenantId: string; userId: string } = { tenantId, userId: agentId }) {
  return { 'x-dev-tenant-id': as.tenantId, 'x-dev-user-id': as.userId };
}

function inject(method: 'GET' | 'POST', url: string, payload?: unknown, as?: typeof outsider) {
  return app.inject({ method, url, headers: headers(as), payload: payload as never });
}

let outsider: { tenantId: string; userId: string };

const start = () => ({
  clientActionId: randomUUID(),
  action: 'start' as const,
  occurredAt: new Date().toISOString(),
  photoKeys: [] as string[],
  connection,
});
const complete = ({ photoKeys }: { photoKeys: string[] }) => ({
  clientActionId: randomUUID(),
  action: 'complete' as const,
  occurredAt: new Date().toISOString(),
  note: 'Buraco tapado com massa asfáltica',
  photoKeys,
  connection,
});
const act = (workOrderId: string, body: unknown, as?: typeof outsider) =>
  inject('POST', `/dev/work-orders/${workOrderId}/actions`, body, as);

async function uploadPhoto({
  tenantId: forTenant = tenantId,
  bytes = 1000,
}: { tenantId?: string; bytes?: number } = {}) {
  const key = newPhotoKey(forTenant);
  const { url, headers: putHeaders } = await storage.presignUpload(key);
  const res = await fetch(url, { method: 'PUT', headers: putHeaders, body: new Uint8Array(bytes) });
  if (!res.ok) throw new Error(`Falha ao enviar a foto de teste: ${res.status}`);
  return key;
}

async function countStatusEvents(workOrderId: string) {
  const rows = await owner.db
    .select()
    .from(schema.statusEvents)
    .where(eq(schema.statusEvents.workOrderId, workOrderId));
  return rows.length;
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  ({ tenantId, teamId, workOrderIds: wo } = seeded);
  agentId = seeded.agentId;
  const [row] = await owner.db
    .select({ citizenId: requests.citizenId, categoryId: requests.categoryId })
    .from(requests)
    .where(eq(requests.tenantId, tenantId))
    .limit(1);
  citizenId = row!.citizenId;
  categoryId = row!.categoryId;

  const [stranger] = await owner.db
    .insert(users)
    .values({ name: 'Sem equipe', email: 'sem.equipe@obras.dev', passwordHash: 'x' })
    .returning();
  outsiderId = stranger!.id;
  outsider = { tenantId, userId: outsiderId };

  const other = await seedTenant('outra', '0000099');
  otherTenantId = other.tenantId;
  otherTenantAgentId = other.agentId;
  otherTenantWorkOrder = other.workOrderId;

  app = await buildApp({ devRoutes: true, storage, database: appDb.db });
});

afterAll(async () => {
  await app?.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('work order actions', () => {
  it('starts and completes a work order', async () => {
    const started = await act(wo[0]!, start());
    expect(started.statusCode).toBe(200);
    const res = await act(wo[0]!, complete({ photoKeys: [await uploadPhoto()] }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'completed', duplicate: false });
    const [row] = await owner.db
      .select()
      .from(schema.workOrders)
      .where(eq(schema.workOrders.id, wo[0]!));
    expect(row?.completionNote).toBe('Buraco tapado com massa asfáltica');
    expect(row?.completedAt).toBeInstanceOf(Date);
    const events = await owner.db
      .select()
      .from(schema.statusEvents)
      .where(
        and(
          eq(schema.statusEvents.workOrderId, wo[0]!),
          eq(schema.statusEvents.toStatus, 'completed'),
        ),
      );
    expect(events[0]).toMatchObject({
      fromStatus: 'in_execution',
      actorUserId: agentId,
      connection,
    });
  });

  it('refuses complete on an assigned work order', async () => {
    const id = await freshWorkOrder();
    const res = await act(id, complete({ photoKeys: [await uploadPhoto()] }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'work_order_unavailable', status: 'assigned' });
  });

  it('replays a duplicate clientActionId', async () => {
    const action = start();
    await act(wo[1]!, action);
    const again = await act(wo[1]!, action);
    expect(again.json()).toMatchObject({ status: 'in_execution', duplicate: true });
    expect(await countStatusEvents(wo[1]!)).toBe(1);
  });

  it('answers the same stored response to concurrent duplicates', async () => {
    const id = await freshWorkOrder();
    const action = start();
    const [a, b] = await Promise.all([act(id, action), act(id, action)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().duplicate, b.json().duplicate].toSorted()).toEqual([false, true]);
    expect(a.json().status).toBe('in_execution');
    expect(b.json().status).toBe('in_execution');
    expect(await countStatusEvents(id)).toBe(1);
  });

  it('refuses a clientActionId reused for another work order', async () => {
    const [first, second] = [await freshWorkOrder(), await freshWorkOrder()];
    const action = start();
    expect((await act(first, action)).statusCode).toBe(200);
    const res = await act(second, action);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'client_action_conflict' });
    expect(await countStatusEvents(second)).toBe(0);
  });

  it('answers 409 (never 500) when one id races on two work orders', async () => {
    const [first, second] = [await freshWorkOrder(), await freshWorkOrder()];
    const action = start();
    const results = await Promise.all([act(first, action), act(second, action)]);
    expect(results.map((r) => r.statusCode).toSorted()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json()).toEqual({
      code: 'client_action_conflict',
    });
    expect((await countStatusEvents(first)) + (await countStatusEvents(second))).toBe(1);
  });

  it('refuses actions on a cancelled work order', async () => {
    await inject('POST', `/dev/work-orders/${wo[2]!}/cancel`);
    const action = start();
    const res = await act(wo[2]!, action);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'work_order_unavailable', status: 'cancelled' });
    // O conflito não é gravado: a mesma ação continua sendo avaliada de novo.
    const [stored] = await owner.db
      .select()
      .from(schema.clientActions)
      .where(eq(schema.clientActions.id, action.clientActionId));
    expect(stored).toBeUndefined();
  });

  it('rejects photo keys that are missing, foreign or too large', async () => {
    for (const key of [
      `${tenantId}/uploads/nada.jpg`,
      await uploadPhoto({ tenantId: otherTenantId }),
      await uploadPhoto({ bytes: 1_000_001 }),
    ]) {
      const id = await freshWorkOrder();
      await act(id, start());
      const res = await act(id, complete({ photoKeys: [key] }));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ code: 'photo_invalid', key });
      expect(await countStatusEvents(id)).toBe(1);
    }
  });

  it('validates the body', async () => {
    const id = await freshWorkOrder();
    expect((await act(id, { ...complete({ photoKeys: [] }) })).statusCode).toBe(400);
    expect((await act(id, { ...start(), photoKeys: ['x'] })).statusCode).toBe(400);
  });

  it('hides work orders of another tenant', async () =>
    expect((await act(otherTenantWorkOrder, start())).statusCode).toBe(404));

  it('hides work orders from people outside the team', async () => {
    const id = await freshWorkOrder();
    expect((await act(id, start(), outsider)).statusCode).toBe(404);
    // E de quem tem outra identidade de prefeitura.
    const cross = { tenantId: otherTenantId, userId: otherTenantAgentId };
    expect((await act(id, start(), cross)).statusCode).toBe(404);
  });

  it('answers 503 without a database', async () => {
    const bare = await buildApp({ devRoutes: true });
    const res = await bare.inject({ method: 'GET', url: '/dev/work-orders', headers: headers() });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'database_not_configured' });
    await bare.close();
  });
});

describe('GET /dev/work-orders', () => {
  it('lists only active work orders of the agent teams', async () => {
    const res = await inject('GET', '/dev/work-orders');
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBeGreaterThan(0);
    expect(
      list.every((w: { status: string }) => ['assigned', 'in_execution'].includes(w.status)),
    ).toBe(true);
    expect(list.map((w: { id: string }) => w.id)).not.toContain(otherTenantWorkOrder);
    expect(list.map((w: { id: string }) => w.id)).not.toContain(wo[0]);
    expect(list[0]).toMatchObject({
      categoryName: expect.any(String),
      protocol: expect.any(String),
      location: { lat: expect.any(Number), lng: expect.any(Number) },
    });
    expect(list[0].location.lat).toBeLessThan(-23);
    expect(list[0].location.lng).toBeLessThan(-46);
  });

  it('lists nothing for a person without teams', async () => {
    const res = await inject('GET', '/dev/work-orders', undefined, outsider);
    expect(res.json()).toEqual([]);
  });
});
