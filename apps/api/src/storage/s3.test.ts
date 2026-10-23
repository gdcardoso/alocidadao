import { describe, expect, it } from 'vitest';
import { createStorage, newPhotoKey } from './s3.js';
import { TENANT_ID, testStorageConfig } from './test-fixtures.js';

describe('storage (MinIO local)', () => {
  it('uploads through a presigned url and reads it back', async () => {
    const storage = createStorage(testStorageConfig);
    const key = newPhotoKey(TENANT_ID);
    const { url, headers } = await storage.presignUpload(key);
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(1234) });
    expect(res.ok).toBe(true);
    expect(await storage.head(key)).toEqual({ bytes: 1234, contentType: 'image/jpeg' });
  });

  it('returns null for a missing key', async () =>
    expect(
      await createStorage(testStorageConfig).head(`${TENANT_ID}/uploads/nada.jpg`),
    ).toBeNull());

  it('rethrows errors other than a missing key', async () => {
    const storage = createStorage({ ...testStorageConfig, secretAccessKey: 'senha-errada' });
    await expect(storage.head(`${TENANT_ID}/uploads/nada.jpg`)).rejects.toThrow();
  });

  it('signs device urls with the public endpoint', async () => {
    const storage = createStorage({ ...testStorageConfig, publicEndpoint: 'http://10.0.2.2:9000' });
    const { url, headers } = await storage.presignUpload(newPhotoKey(TENANT_ID));
    expect(url.startsWith('http://10.0.2.2:9000/alocidadao-dev/')).toBe(true);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('600');
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('prefixes keys with the tenant', () =>
    expect(newPhotoKey(TENANT_ID, new Date('2026-10-22T12:00:00Z'))).toMatch(
      new RegExp(`^${TENANT_ID}/uploads/2026/10/[0-9a-f-]{36}\\.jpg$`),
    ));
});
