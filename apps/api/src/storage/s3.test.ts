import { describe, expect, it } from 'vitest';
import { createStorage, isOwnRequestPhotoKey, newPhotoKey, newRequestPhotoKey } from './s3.js';
import { TENANT_ID, testStorageConfig } from './test-fixtures.js';

const SECRET = 'segredo-de-teste-das-fotos-com-mais-de-32-caracteres';

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

  it('seals request photo keys without the user id in the path', () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const key = newRequestPhotoKey(SECRET, userId, new Date('2026-10-22T12:00:00Z'));
    expect(key).toMatch(/^requests\/2026\/[0-9a-f-]{36}-[0-9a-f]{16}\.jpg$/);
    expect(key).not.toContain(userId);
    expect(isOwnRequestPhotoKey(SECRET, userId, key)).toBe(true);
  });

  it("refuses another user's, tampered or foreign request photo keys", () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const otherId = '33333333-3333-4333-8333-333333333333';
    const key = newRequestPhotoKey(SECRET, userId);
    expect(isOwnRequestPhotoKey(SECRET, otherId, key)).toBe(false);
    expect(isOwnRequestPhotoKey('outro-segredo-com-mais-de-32-caracteres!!', userId, key)).toBe(
      false,
    );
    const tampered = key.replace(
      /-([0-9a-f])([0-9a-f]{15})\.jpg$/,
      (_, first: string, rest: string) => `-${first === '0' ? '1' : '0'}${rest}.jpg`,
    );
    expect(isOwnRequestPhotoKey(SECRET, userId, tampered)).toBe(false);
    expect(isOwnRequestPhotoKey(SECRET, userId, `requests/${userId}/2026/x.jpg`)).toBe(false);
    expect(isOwnRequestPhotoKey(SECRET, userId, newPhotoKey(TENANT_ID))).toBe(false);
  });

  it('reads an uploaded object through a presigned get url', async () => {
    const storage = createStorage(testStorageConfig);
    const key = newRequestPhotoKey(SECRET, '22222222-2222-4222-8222-222222222222');
    const { url, headers } = await storage.presignUpload(key);
    expect((await fetch(url, { method: 'PUT', headers, body: new Uint8Array(42) })).ok).toBe(true);
    const getUrl = await storage.presignGet(key, 120);
    expect(new URL(getUrl).searchParams.get('X-Amz-Expires')).toBe('120');
    const res = await fetch(getUrl);
    expect(res.ok).toBe(true);
    expect((await res.arrayBuffer()).byteLength).toBe(42);
  });
});
