import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  signSignupToken,
  verifyAccessToken,
  verifySignupToken,
} from './tokens.js';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres';
const device = { installationId: randomUUID(), platform: 'android' as const, appVersion: '1.0.0' };

afterEach(() => {
  vi.useRealTimers();
});

describe('access token', () => {
  it('round trips sub, sid and aud', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const token = await signAccessToken(secret, { userId, sessionId, audience: 'panel' });
    expect(await verifyAccessToken(secret, token)).toEqual({
      userId,
      sessionId,
      audience: 'panel',
    });
  });

  it('refuses an expired token or one signed with another secret', async () => {
    const claims = { userId: randomUUID(), sessionId: randomUUID(), audience: 'app' as const };
    const token = await signAccessToken(secret, claims);
    expect(await verifyAccessToken('outro-segredo-com-mais-de-32-caracteres', token)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    expect(await verifyAccessToken(secret, token)).toBeNull();
  });

  it('does not accept a signup token as an access token', async () => {
    const token = await signSignupToken(secret, {
      phone: '+5511999998888',
      device,
      freezeUserId: null,
    });
    expect(await verifyAccessToken(secret, token)).toBeNull();
    expect(await verifySignupToken(secret, token)).toEqual({
      phone: '+5511999998888',
      device,
      freezeUserId: null,
    });
  });
});

describe('refresh token', () => {
  it('stores only the sha256 of a random token', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
