import { randomUUID } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import type { ConnectionContext } from '@alocidadao/shared';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage, newPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  tenants,
  users,
  memberships,
  departments,
  teams,
  teamMembers,
  categories,
  occurrences,
  requests,
  photos,
  statusEvents,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);
// Cliente direto do MinIO, para gravar um objeto com outro tipo de conteúdo.
const s3 = new S3Client({
  endpoint: testStorageConfig.endpoint,
  region: testStorageConfig.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: testStorageConfig.accessKeyId,
    secretAccessKey: testStorageConfig.secretAccessKey,
  },
});

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
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const [agent] = await owner.db
    .insert(users)
    .values({ name: `Agente ${label}`, phone: '+5511980000001' })
    .returning();
  const [citizen] = await owner.db
    .insert(users)
    .values({ name: `Cidadão ${label}`, phone: '+5511980000002' })
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

/** Cria ocorrência, a solicitação dela e a atividade atribuída à equipe. */
async function newWorkOrder(tid: string, teamIdArg: string, citizen: string, category: string) {
  // O protocolo sai de next_request_protocol(), que lê a prefeitura do contexto.
  return withContext(owner.db, { tenantId: tid }, async (tx) => {
    const location = geoPoint({ lat: -23.55, lng: -46.63 });
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId: tid, categoryId: category, location, status: 'in_progress' })
      .returning();
    await tx.insert(requests).values({
      tenantId: tid,
      citizenId: citizen,
      categoryId: category,
      occurrenceId: occurrence!.id,
      status: 'in_progress',
      description: 'Buraco na via, teste de atividade',
      location,
      gpsLocation: location,
    });
    const [order] = await tx
      .insert(schema.workOrders)
      .values({ tenantId: tid, occurrenceId: occurrence!.id, teamId: teamIdArg })
      .returning();
    return order!.id;
  });
}

const freshWorkOrder = () => newWorkOrder(tenantId, teamId, citizenId, categoryId);

// Cada pessoa abre uma sessão de verdade; o cabeçalho é montado uma vez por pessoa.
const authHeaders = new Map<string, Record<string, string>>();

async function headersFor(as: { tenantId: string; userId: string }) {
  const key = `${as.tenantId}:${as.userId}`;
  let found = authHeaders.get(key);
  if (!found) {
    found = { ...(await appAuthHeader(appDb.db, as.userId)), 'x-tenant-id': as.tenantId };
    authHeaders.set(key, found);
  }
  return found;
}

async function headers(as: { tenantId: string; userId: string } = { tenantId, userId: agentId }) {
  return headersFor(as);
}

async function inject(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  as?: typeof outsider,
) {
  return app.inject({ method, url, headers: await headers(as), payload: payload as never });
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
    .from(statusEvents)
    .where(eq(statusEvents.workOrderId, workOrderId));
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
    .values({ name: 'Sem equipe', phone: '+5511980000003' })
    .returning();
  outsiderId = stranger!.id;
  outsider = { tenantId, userId: outsiderId };
  // Agente da prefeitura, mas fora da equipe da atividade.
  await owner.db
    .insert(memberships)
    .values({ tenantId, userId: outsiderId, role: 'field_agent', status: 'active' });

  const other = await seedTenant('outra', '0000099');
  otherTenantId = other.tenantId;
  otherTenantAgentId = other.agentId;
  otherTenantWorkOrder = other.workOrderId;

  app = await buildApp({
    devRoutes: true,
    storage,
    database: appDb.db,
    auth: testAuthOptions,
  });
});

afterAll(async () => {
  s3.destroy();
  await app?.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('work order actions', () => {
  it('complete moves the work order to awaiting_review and keeps it in the list', async () => {
    expect((await act(wo[0]!, start())).statusCode).toBe(200);
    const res = await act(wo[0]!, complete({ photoKeys: [await uploadPhoto()] }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workOrderId: wo[0], status: 'awaiting_review', duplicate: false });
    const list = (await inject('GET', '/agent/work-orders')).json();
    expect(list.find((w: { id: string }) => w.id === wo[0])).toMatchObject({
      status: 'awaiting_review',
    });
  });

  it('stores the agent note, completedAt equal to occurredAt and one pending photo per key', async () => {
    const id = await freshWorkOrder();
    await act(id, start());
    const keys = [await uploadPhoto(), await uploadPhoto()];
    const body = complete({ photoKeys: keys });
    expect((await act(id, body)).statusCode).toBe(200);
    const [row] = await owner.db
      .select()
      .from(schema.workOrders)
      .where(eq(schema.workOrders.id, id));
    expect(row?.agentNote).toBe('Buraco tapado com massa asfáltica');
    expect(row?.completedAt?.toISOString()).toBe(body.occurredAt);
    const stored = await owner.db.select().from(photos).where(eq(photos.workOrderId, id));
    expect(stored.map((p) => p.storageKey).toSorted()).toEqual(keys.toSorted());
    for (const photo of stored) {
      expect(photo).toMatchObject({
        tenantId,
        requestId: null,
        review: 'pending',
        uploadedBy: agentId,
        purpose: 'completion',
      });
    }
  });

  it('records exactly one status event per action, linked to the occurrence', async () => {
    const id = await freshWorkOrder();
    const [order] = await owner.db
      .select({ occurrenceId: schema.workOrders.occurrenceId })
      .from(schema.workOrders)
      .where(eq(schema.workOrders.id, id));
    await act(id, start());
    await act(id, complete({ photoKeys: [await uploadPhoto()] }));
    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.workOrderId, id))
      .orderBy(asc(statusEvents.createdAt));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      occurrenceId: order!.occurrenceId,
      requestId: null,
      fromStatus: 'assigned',
      toStatus: 'in_execution',
      actorUserId: agentId,
      comment: null,
      connection,
    });
    expect(events[1]).toMatchObject({
      occurrenceId: order!.occurrenceId,
      fromStatus: 'in_execution',
      toStatus: 'awaiting_review',
      actorUserId: agentId,
      comment: 'Buraco tapado com massa asfáltica',
    });
  });

  it('responds 503 storage_not_configured when completing without storage', async () => {
    const bare = await buildApp({
      devRoutes: true,
      database: appDb.db,
      auth: testAuthOptions,
    });
    const id = await freshWorkOrder();
    await act(id, start());
    const res = await bare.inject({
      method: 'POST',
      url: `/dev/work-orders/${id}/actions`,
      headers: await headers(),
      payload: complete({ photoKeys: [newPhotoKey(tenantId)] }),
    });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
    expect(await countStatusEvents(id)).toBe(1);
  });

  it('rejects a photo whose content type is not image/jpeg', async () => {
    const key = newPhotoKey(tenantId);
    await s3.send(
      new PutObjectCommand({
        Bucket: testStorageConfig.bucket,
        Key: key,
        Body: new Uint8Array(1000),
        ContentType: 'image/png',
      }),
    );
    const id = await freshWorkOrder();
    await act(id, start());
    const res = await act(id, complete({ photoKeys: [key] }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'photo_invalid', key });
    expect(await countStatusEvents(id)).toBe(1);
  });

  it('cancelling an already cancelled work order is idempotent', async () => {
    const id = await freshWorkOrder();
    const first = await inject('POST', `/dev/work-orders/${id}/cancel`);
    expect(first.statusCode).toBe(200);
    const events = await countStatusEvents(id);
    const second = await inject('POST', `/dev/work-orders/${id}/cancel`);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(second.json()).toEqual({ workOrderId: id, status: 'cancelled' });
    expect(await countStatusEvents(id)).toBe(events);
  });

  it('replays a completed action even after a photo left the storage', async () => {
    const id = await freshWorkOrder();
    await act(id, start());
    const key = await uploadPhoto();
    const body = complete({ photoKeys: [key] });
    expect((await act(id, body)).statusCode).toBe(200);
    await s3.send(new DeleteObjectCommand({ Bucket: testStorageConfig.bucket, Key: key }));
    const again = await act(id, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ workOrderId: id, status: 'awaiting_review', duplicate: true });
    expect(await countStatusEvents(id)).toBe(2);
  });

  it('refuses complete on an assigned work order', async () => {
    const id = await freshWorkOrder();
    const res = await act(id, complete({ photoKeys: [await uploadPhoto()] }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'work_order_unavailable', status: 'assigned' });
  });

  it('replays a duplicate clientActionId', async () => {
    const action = start();
    // A atividade da demo já tem o evento da atribuição feita pelo gestor.
    const before = await countStatusEvents(wo[1]!);
    await act(wo[1]!, action);
    const again = await act(wo[1]!, action);
    expect(again.json()).toMatchObject({ status: 'in_execution', duplicate: true });
    expect(await countStatusEvents(wo[1]!)).toBe(before + 1);
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
  });

  it('refuses an agent of another tenant with 403', async () => {
    const id = await freshWorkOrder();
    const cross = { tenantId, userId: otherTenantAgentId };
    const res = await act(id, start(), cross);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_a_member' });
  });

  it('missing token is 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dev/work-orders/${wo[1]!}/actions`,
      payload: start(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });

  it('missing tenant header is 400', async () => {
    const { authorization } = await headers();
    const res = await app.inject({
      method: 'POST',
      url: `/dev/work-orders/${wo[1]!}/actions`,
      headers: { authorization: authorization! },
      payload: start(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('answers 503 without a database', async () => {
    const bare = await buildApp({ devRoutes: true, auth: testAuthOptions });
    const res = await bare.inject({
      method: 'POST',
      url: `/dev/work-orders/${wo[1]!}/actions`,
      headers: await headers(),
      payload: start(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'database_not_configured' });
    await bare.close();
  });
});
