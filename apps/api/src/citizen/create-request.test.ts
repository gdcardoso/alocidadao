import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { DEMO_UNSERVED_CENTER, seedDev } from '@alocidadao/db/seed';
import type {
  ConnectionContext,
  CreateRequestInput,
  CreateRequestResponse,
  GeoPoint,
  OccurrenceStatus,
} from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage, newRequestPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  users,
  tenants,
  departments,
  categories,
  occurrences,
  requests,
  photos,
  statusEvents,
  clientActions,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);

/** Centro da prefeitura demo (o mesmo do seed). */
const DEMO_CENTER: GeoPoint = { lat: -23.5505, lng: -46.6333 };

const connection: ConnectionContext = {
  networkType: 'cellular',
  cellularGeneration: '4g',
  apiLatencyMs: 120,
  uploadDurationMs: 800,
  sentOffline: false,
};

let app: Awaited<ReturnType<typeof buildApp>>;
let demoTenantId: string;
let categoryId: string;
let citizenId: string;
let headers: Record<string, string>;

const newPhone = () => `+55319${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function createCitizen() {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Cidadã de teste', phone: newPhone() })
    .returning({ id: users.id });
  return user!.id;
}

/** Envia uma foto de teste ao MinIO no prefixo do usuário e devolve a chave. */
async function uploadPhoto(userId = citizenId) {
  const key = newRequestPhotoKey(userId);
  const { url, headers: putHeaders } = await storage.presignUpload(key);
  const res = await fetch(url, { method: 'PUT', headers: putHeaders, body: new Uint8Array(500) });
  if (!res.ok) throw new Error(`Falha ao enviar a foto de teste: ${res.status}`);
  return key;
}

/** Ponto aleatório dentro da prefeitura demo, longe do centro, para não cruzar com o seed. */
function randomDemoPoint(): GeoPoint {
  return {
    lat: DEMO_CENTER.lat - 0.03 + randomInt(0, 1000) / 100_000,
    lng: DEMO_CENTER.lng - 0.03 + randomInt(0, 1000) / 100_000,
  };
}

async function body(overrides: Partial<CreateRequestInput> = {}): Promise<CreateRequestInput> {
  const point = overrides.location ?? randomDemoPoint();
  return {
    clientActionId: randomUUID(),
    categoryId,
    description: 'Buraco grande na frente do número 120',
    occurredAt: '2026-10-20T13:45:00.000Z',
    gpsLocation: { lat: point.lat + 0.0002, lng: point.lng },
    location: point,
    address: 'Rua das Flores, 120',
    photoKeys: overrides.photoKeys ?? [await uploadPhoto()],
    connection,
    ...overrides,
  };
}

const post = (payload: object, as: Record<string, string> = headers) =>
  app.inject({ method: 'POST', url: '/citizen/requests', headers: as, payload });

/** Cria uma ocorrência com o status pedido na prefeitura demo (dono: ignora o RLS). */
async function createOccurrence(status: OccurrenceStatus, point = randomDemoPoint()) {
  return withContext(owner.db, { tenantId: demoTenantId }, async (tx) => {
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId: demoTenantId, categoryId, location: geoPoint(point), status })
      .returning({ id: occurrences.id });
    return occurrence!.id;
  });
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  demoTenantId = seeded.tenantId;
  const [category] = await owner.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, demoTenantId), eq(categories.name, 'Buraco na via')));
  categoryId = category!.id;
  citizenId = await createCitizen();
  headers = await appAuthHeader(appDb.db, citizenId);
  app = await buildApp({
    storage: createStorage(testStorageConfig),
    database: appDb.db,
    auth: testAuthOptions,
  });
});

afterAll(async () => {
  await app.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('POST /citizen/requests', () => {
  it('creates request and a new triage occurrence', async () => {
    const input = await body();
    const res = await post(input);
    expect(res.statusCode).toBe(201);
    const created = res.json<CreateRequestResponse>();
    expect(created.protocol).toMatch(/^[0-9]{4}-[0-9]{6}$/);
    expect(created.status).toBe('open');
    expect(created.duplicate).toBe(false);

    const [request] = await owner.db
      .select()
      .from(requests)
      .where(eq(requests.id, created.requestId));
    expect(request).toMatchObject({
      tenantId: demoTenantId,
      citizenId,
      categoryId,
      status: 'open',
      protocol: created.protocol,
      description: input.description,
      address: input.address,
    });
    expect(request!.location).toEqual({ x: input.location.lng, y: input.location.lat });
    expect(request!.gpsLocation).toEqual({ x: input.gpsLocation.lng, y: input.gpsLocation.lat });
    expect(request!.createdAt.toISOString()).toBe(input.occurredAt);
    expect(request!.statusChangedAt.toISOString()).toBe(input.occurredAt);

    const [occurrence] = await owner.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, request!.occurrenceId));
    expect(occurrence).toMatchObject({ status: 'triage', categoryId, tenantId: demoTenantId });
    expect(occurrence!.location).toEqual({ x: input.location.lng, y: input.location.lat });

    const stored = await owner.db
      .select()
      .from(photos)
      .where(eq(photos.requestId, created.requestId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      storageKey: input.photoKeys[0],
      uploadedBy: citizenId,
      review: null,
      purpose: 'report',
    });

    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.requestId, created.requestId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      occurrenceId: request!.occurrenceId,
      toStatus: 'open',
      actorUserId: citizenId,
      connection,
    });

    const [action] = await owner.db
      .select()
      .from(clientActions)
      .where(eq(clientActions.id, input.clientActionId));
    expect(action).toMatchObject({
      tenantId: demoTenantId,
      userId: citizenId,
      kind: 'create_request',
      targetId: created.requestId,
    });
  });

  it('supporting an in_progress occurrence starts in_progress', async () => {
    const point = randomDemoPoint();
    const occurrenceId = await createOccurrence('in_progress', point);
    const res = await post(await body({ location: point, occurrenceId }));
    expect(res.statusCode).toBe(201);
    const created = res.json<CreateRequestResponse>();
    expect(created.status).toBe('in_progress');

    const [request] = await owner.db
      .select()
      .from(requests)
      .where(eq(requests.id, created.requestId));
    expect(request!.occurrenceId).toBe(occurrenceId);
    expect(request!.status).toBe('in_progress');
    const [occurrence] = await owner.db
      .select({ status: occurrences.status })
      .from(occurrences)
      .where(eq(occurrences.id, occurrenceId));
    expect(occurrence!.status).toBe('in_progress');
  });

  it('supporting a triage occurrence starts open', async () => {
    const occurrenceId = await createOccurrence('triage');
    const res = await post(await body({ occurrenceId }));
    expect(res.statusCode).toBe(201);
    expect(res.json<CreateRequestResponse>().status).toBe('open');
  });

  it('supporting a closed occurrence is 409', async () => {
    const occurrenceId = await createOccurrence('completed');
    const input = await body({ occurrenceId });
    const res = await post(input);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'occurrence_unavailable' });
    const rows = await owner.db
      .select()
      .from(clientActions)
      .where(eq(clientActions.id, input.clientActionId));
    expect(rows).toHaveLength(0);
  });

  it('supporting an occurrence of another category is 409', async () => {
    const occurrenceId = await createOccurrence('triage');
    const [other] = await owner.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, demoTenantId), eq(categories.name, 'Iluminação')));
    const res = await post(await body({ occurrenceId, categoryId: other!.id }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'occurrence_unavailable' });
  });

  it('resending the same clientActionId returns the first request', async () => {
    const input = await body();
    const first = await post(input);
    expect(first.statusCode).toBe(201);
    const second = await post(input);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ...first.json(), duplicate: true });

    const rows = await owner.db
      .select()
      .from(requests)
      .where(eq(requests.id, first.json<CreateRequestResponse>().requestId));
    expect(rows).toHaveLength(1);
    const actions = await owner.db
      .select()
      .from(clientActions)
      .where(eq(clientActions.id, input.clientActionId));
    expect(actions).toHaveLength(1);
  });

  it('replay wins even when the category was deactivated since', async () => {
    const [department] = await owner.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.tenantId, demoTenantId))
      .limit(1);
    const [temporary] = await owner.db
      .insert(categories)
      .values({
        tenantId: demoTenantId,
        departmentId: department!.id,
        name: `Temporária ${randomUUID()}`,
      })
      .returning({ id: categories.id });
    const input = await body({ categoryId: temporary!.id });
    const first = await post(input);
    expect(first.statusCode).toBe(201);
    await owner.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.id, temporary!.id));
    const second = await post(input);
    expect(second.statusCode).toBe(200);
    expect(second.json<CreateRequestResponse>().duplicate).toBe(true);
  });

  it('same clientActionId from another user is 409 client_action_conflict', async () => {
    const input = await body();
    expect((await post(input)).statusCode).toBe(201);
    const otherId = await createCitizen();
    const otherHeaders = await appAuthHeader(appDb.db, otherId);
    const res = await post({ ...input, photoKeys: [await uploadPhoto(otherId)] }, otherHeaders);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'client_action_conflict' });
  });

  it('photo key already used is 409 photo_already_used', async () => {
    const input = await body();
    expect((await post(input)).statusCode).toBe(201);
    const res = await post(await body({ photoKeys: input.photoKeys }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'photo_already_used' });
  });

  it('create request outside served tenants is 422 municipality_not_served', async () => {
    const res = await post(await body({ location: DEMO_UNSERVED_CENTER }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'municipality_not_served',
      municipality: { ibgeCode: '9999902', name: 'Vila Sem Adesão', state: 'SP' },
    });
  });

  it('category from another tenant is 422 category_unavailable', async () => {
    const [tenant] = await owner.db
      .insert(tenants)
      .values({
        name: 'Município Outro',
        displayName: 'Prefeitura Outra',
        city: 'Outra',
        state: 'MG',
        ibgeCode: `98${String(randomInt(0, 100_000)).padStart(5, '0')}`,
        status: 'active',
      })
      .returning({ id: tenants.id });
    const [department] = await owner.db
      .insert(departments)
      .values({ tenantId: tenant!.id, name: 'Obras' })
      .returning({ id: departments.id });
    const [foreign] = await owner.db
      .insert(categories)
      .values({ tenantId: tenant!.id, departmentId: department!.id, name: 'Buraco na via' })
      .returning({ id: categories.id });

    const res = await post(await body({ categoryId: foreign!.id }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'category_unavailable' });
  });

  it('photo key of another user is 422 photo_missing', async () => {
    const otherId = await createCitizen();
    const res = await post(await body({ photoKeys: [await uploadPhoto(otherId)] }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'photo_missing' });
  });

  it('photo key not uploaded is 422 photo_missing', async () => {
    const res = await post(await body({ photoKeys: [newRequestPhotoKey(citizenId)] }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'photo_missing' });
  });

  it('location more than 200 m from GPS is 400', async () => {
    const point = randomDemoPoint();
    const res = await post(
      await body({ location: point, gpsLocation: { lat: point.lat + 0.003, lng: point.lng } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('empty description is stored as empty text', async () => {
    const input = await body();
    delete input.description;
    const res = await post(input);
    expect(res.statusCode).toBe(201);
    const [request] = await owner.db
      .select({ description: requests.description })
      .from(requests)
      .where(eq(requests.id, res.json<CreateRequestResponse>().requestId));
    expect(request!.description).toBe('');
  });

  it('responds 503 when storage is not configured', async () => {
    const bare = await buildApp({ database: appDb.db, auth: testAuthOptions });
    const res = await bare.inject({
      method: 'POST',
      url: '/citizen/requests',
      headers,
      payload: await body(),
    });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
  });
});
