import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage } from '../storage/s3.js';
import { TENANT_ID, testStorageConfig } from '../storage/test-fixtures.js';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const devHeaders = { 'x-dev-user-id': USER_ID, 'x-dev-tenant-id': TENANT_ID };

describe('POST /dev/uploads', () => {
  it('responds 401 without the dev headers', async () => {
    const app = await buildApp({
      devRoutes: true,
      storage: createStorage(testStorageConfig),
    });
    const res = await app.inject({ method: 'POST', url: '/dev/uploads' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'dev_identity_required' });
    await app.close();
  });

  it('responds 401 when a header is not a uuid', async () => {
    const app = await buildApp({ devRoutes: true, storage: createStorage(testStorageConfig) });
    const res = await app.inject({
      method: 'POST',
      url: '/dev/uploads',
      headers: { ...devHeaders, 'x-dev-tenant-id': 'abc' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns key, url and headers for the tenant', async () => {
    const app = await buildApp({ devRoutes: true, storage: createStorage(testStorageConfig) });
    const res = await app.inject({ method: 'POST', url: '/dev/uploads', headers: devHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.key.startsWith(`${TENANT_ID}/`)).toBe(true);
    expect(body.url).toContain(body.key);
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    await app.close();
  });

  it('responds 503 when storage is not configured', async () => {
    const app = await buildApp({ devRoutes: true });
    const res = await app.inject({ method: 'POST', url: '/dev/uploads', headers: devHeaders });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
    await app.close();
  });

  it('does not register /dev routes by default', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/dev/uploads', headers: devHeaders });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
