import { createDatabase } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let tenantId: string;
let headers: Record<string, string>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  tenantId = seeded.tenantId;
  headers = { ...(await appAuthHeader(appDb.db, seeded.agentId)), 'x-tenant-id': tenantId };
  app = await buildApp({
    devRoutes: true,
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

describe('POST /dev/uploads', () => {
  it('responds 401 without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/dev/uploads' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });

  it('responds 400 without the tenant header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev/uploads',
      headers: { authorization: headers.authorization! },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('responds 403 when the tenant header is not a uuid of a membership', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev/uploads',
      headers: { ...headers, 'x-tenant-id': '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns key, url and headers for the tenant', async () => {
    const res = await app.inject({ method: 'POST', url: '/dev/uploads', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.key.startsWith(`${tenantId}/`)).toBe(true);
    expect(body.url).toContain(body.key);
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('responds 503 when storage is not configured', async () => {
    const bare = await buildApp({ devRoutes: true, database: appDb.db, auth: testAuthOptions });
    const res = await bare.inject({ method: 'POST', url: '/dev/uploads', headers });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
  });

  it('does not register the route without auth configured', async () => {
    const bare = await buildApp({ devRoutes: true, storage: createStorage(testStorageConfig) });
    const res = await bare.inject({ method: 'POST', url: '/dev/uploads', headers });
    await bare.close();
    expect(res.statusCode).toBe(404);
  });

  it('does not register /dev routes by default', async () => {
    const bare = await buildApp();
    const res = await bare.inject({ method: 'POST', url: '/dev/uploads', headers });
    await bare.close();
    expect(res.statusCode).toBe(404);
  });
});
