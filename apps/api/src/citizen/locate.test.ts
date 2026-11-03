import { randomInt } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { DEMO_UNSERVED_CENTER, seedDev } from '@alocidadao/db/seed';
import type {
  GeoPoint,
  LocateResponse,
  SimilarOccurrence,
  UploadResponse,
} from '@alocidadao/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { startSession } from '../auth/session.js';
import { createStorage, isOwnRequestPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, TEST_AUTH_SECRET, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { users, tenants, categories, departments, occurrences, requests, cityInterest } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

/** Centro da prefeitura demo (o mesmo do seed). */
const DEMO_CENTER: GeoPoint = { lat: -16.6799, lng: -49.255 };

let app: Awaited<ReturnType<typeof buildApp>>;
let demoTenantId: string;
let citizenId: string;
let headers: Record<string, string>;

const newPhone = () => `+55319${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function createCitizen(values: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Cidadã de teste', phone: newPhone(), ...values })
    .returning({ id: users.id });
  return user!.id;
}

/** Quadrado de 0,02 grau em torno do ponto, como MultiPolygon 4326. */
function squareAround({ lat, lng }: GeoPoint) {
  return sql`ST_Multi(ST_MakeEnvelope(${lng - 0.01}, ${lat - 0.01}, ${lng + 0.01}, ${lat + 0.01}, 4326))`;
}

const query = (point: GeoPoint, extra: Record<string, string> = {}) =>
  new URLSearchParams({ lat: String(point.lat), lng: String(point.lng), ...extra }).toString();

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  demoTenantId = seeded.tenantId;
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

describe('GET /citizen/locate', () => {
  it('locate inside the demo tenant returns served with active categories', async () => {
    const [department] = await owner.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.tenantId, demoTenantId))
      .limit(1);
    await owner.db
      .insert(categories)
      .values({
        tenantId: demoTenantId,
        departmentId: department!.id,
        name: 'Categoria desativada',
        active: false,
      })
      .onConflictDoNothing();

    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query(DEMO_CENTER)}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<LocateResponse>();
    if (body.status !== 'served') throw new Error(`status ${body.status}`);
    expect(body.tenant).toEqual({
      id: demoTenantId,
      displayName: 'Prefeitura de Goiânia',
      city: 'Goiânia',
      state: 'GO',
      centralPhone: null,
    });
    const names = body.categories.map((c) => c.name);
    expect(names).not.toContain('Categoria desativada');
    expect(names).toEqual(names.toSorted((a, b) => a.localeCompare(b, 'pt-BR')));
    expect(body.categories).toContainEqual(
      expect.objectContaining({
        name: 'Buraco na via',
        icon: 'construction',
        iconGroup: 'infrastructure',
      }),
    );
    expect(names).toHaveLength(9);
  });

  it('locate in a municipality without tenant returns not_served with its name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query(DEMO_UNSERVED_CENTER)}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'not_served',
      municipality: { ibgeCode: '5220454', name: 'Senador Canedo', state: 'GO' },
    });
  });

  it('locate outside every municipality returns not_served with null', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query({ lat: 10, lng: 10 })}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'not_served', municipality: null });
  });

  it('suspended tenant counts as not served', async () => {
    const center = { lat: -12.5, lng: -41.5 };
    await owner.db.insert(tenants).values({
      name: 'Município Suspenso',
      displayName: 'Prefeitura Suspensa',
      city: 'Suspensa',
      state: 'BA',
      ibgeCode: '9999981',
      status: 'suspended',
      boundary: squareAround(center),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query(center)}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'not_served', municipality: null });
  });

  it('rejects invalid coordinates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query({ lat: 91, lng: 0 })}`,
      headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /citizen/similar', () => {
  it('similar returns nearby open occurrences without citizen data', async () => {
    const [category] = await owner.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, demoTenantId), eq(categories.name, 'Iluminação')));
    // Longe das ocorrências do seed, para não depender delas.
    const spot = { lat: DEMO_CENTER.lat + 0.02, lng: DEMO_CENTER.lng + 0.02 };
    const occurrenceId = await withContext(owner.db, { tenantId: demoTenantId }, async (tx) => {
      const location = geoPoint(spot);
      const [occurrence] = await tx
        .insert(occurrences)
        .values({ tenantId: demoTenantId, categoryId: category!.id, location, status: 'triage' })
        .returning({ id: occurrences.id });
      await tx.insert(requests).values({
        tenantId: demoTenantId,
        citizenId: await createCitizen({ name: 'Outro Morador' }),
        categoryId: category!.id,
        occurrenceId: occurrence!.id,
        status: 'open',
        description: 'Poste apagado',
        location,
        gpsLocation: location,
      });
      return occurrence!.id;
    });

    const near = { lat: spot.lat + 0.0001, lng: spot.lng };
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/similar?${query(near, { categoryId: category!.id })}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SimilarOccurrence[]>();
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      occurrenceId,
      categoryName: 'Iluminação',
      icon: 'lightbulb',
      iconGroup: 'infrastructure',
      distanceM: expect.any(Number),
      reportCount: 1,
      status: 'triage',
    });
    expect(body[0]!.distanceM).toBeGreaterThan(5);
    expect(body[0]!.distanceM).toBeLessThan(25);
    // categoryName é o nome da categoria; nenhuma outra chave fala de cidadão, nome ou foto.
    for (const key of Object.keys(body[0]!).filter((k) => k !== 'categoryName')) {
      expect(key).not.toMatch(/citizen|name|photo/i);
    }
    expect(res.body).not.toContain('Outro Morador');
  });

  it('similar outside served tenants is 422', async () => {
    const [category] = await owner.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.tenantId, demoTenantId))
      .limit(1);
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/similar?${query(DEMO_UNSERVED_CENTER, { categoryId: category!.id })}`,
      headers,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'municipality_not_served' });
  });
});

describe('POST /citizen/uploads', () => {
  it('uploads returns a sealed key without the user id', async () => {
    const res = await app.inject({ method: 'POST', url: '/citizen/uploads', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json<UploadResponse>();
    const year = new Date().getUTCFullYear();
    expect(body.key).toMatch(new RegExp(`^requests/${year}/[0-9a-f-]{36}-[0-9a-f]{16}\\.jpg$`));
    expect(body.key).not.toContain(citizenId);
    expect(isOwnRequestPhotoKey(TEST_AUTH_SECRET, citizenId, body.key)).toBe(true);
    expect(body.url).toContain(body.key);
    expect(new URL(body.url).searchParams.get('X-Amz-Expires')).toBe('600');
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('responds 503 when storage is not configured', async () => {
    const bare = await buildApp({ database: appDb.db, auth: testAuthOptions });
    const res = await bare.inject({ method: 'POST', url: '/citizen/uploads', headers });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
  });
});

describe('POST /citizen/city-interest', () => {
  it('city interest is idempotent and 404 for unknown code', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/citizen/city-interest',
        headers,
        payload: { ibgeCode: '5220454' },
      });
      expect(res.statusCode).toBe(204);
    }
    const rows = await owner.db
      .select()
      .from(cityInterest)
      .where(and(eq(cityInterest.userId, citizenId), eq(cityInterest.ibgeCode, '5220454')));
    expect(rows).toHaveLength(1);

    const unknown = await app.inject({
      method: 'POST',
      url: '/citizen/city-interest',
      headers,
      payload: { ibgeCode: '1234567' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ code: 'municipality_not_found' });
  });
});

describe('citizen access', () => {
  it('panel token is refused', async () => {
    const session = await withContext(appDb.db, { userId: citizenId }, (tx) =>
      startSession(tx, { secret: TEST_AUTH_SECRET, userId: citizenId, audience: 'panel' }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/citizen/locate?${query(DEMO_CENTER)}`,
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });

  it('frozen account is refused', async () => {
    const frozenId = await createCitizen();
    const frozenHeaders = await appAuthHeader(appDb.db, frozenId);
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenId));
    const res = await app.inject({
      method: 'POST',
      url: '/citizen/city-interest',
      headers: frozenHeaders,
      payload: { ibgeCode: '5220454' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });
});
