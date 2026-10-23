import { ApiError, ApiTimeoutError } from '@alocidadao/api-client';
import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../lib/installation-id';
import { NetworkError } from '../offline/outbox';
import { createSessionManager, type SessionApi } from './session';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
}

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresInSeconds: 900 };

function setup() {
  const store = memoryStore();
  let clock = 1_000_000;
  const api = {
    refresh: vi.fn<SessionApi['refresh']>(),
    logout: vi.fn<SessionApi['logout']>(async () => undefined),
  };
  const session = createSessionManager({
    store,
    api,
    now: () => clock,
    signOutTimeoutMs: 20,
  });
  return {
    store,
    api,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('session manager', () => {
  it('getAccessToken refreshes when close to expiry', async () => {
    const { api, session, advance } = setup();
    api.refresh.mockResolvedValue({ accessToken: 'access-2', accessExpiresInSeconds: 900 });
    await session.signIn(TOKENS);

    advance(800_000);
    expect(await session.getAccessToken()).toBe('access-1');
    expect(api.refresh).not.toHaveBeenCalled();

    // Faltam menos de 30 s para vencer.
    advance(80_000);
    expect(await session.getAccessToken()).toBe('access-2');
    expect(api.refresh).toHaveBeenCalledWith('refresh-1');
  });

  it('refreshes when there is no access token in memory', async () => {
    const { store, api } = setup();
    store.data.set('refresh-token', 'stored');
    api.refresh.mockResolvedValue({ accessToken: 'access-9', accessExpiresInSeconds: 900 });
    const fresh = createSessionManager({ store, api, now: () => 0 });
    expect(await fresh.getAccessToken()).toBe('access-9');
    expect(api.refresh).toHaveBeenCalledWith('stored');
  });

  it('returns null when signed out', async () => {
    const { api, session } = setup();
    expect(await session.getAccessToken()).toBeNull();
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('concurrent refreshes share one request', async () => {
    const { api, session, advance } = setup();
    let resolve!: (value: { accessToken: string; accessExpiresInSeconds: number }) => void;
    api.refresh.mockReturnValue(new Promise((r) => (resolve = r)));
    await session.signIn(TOKENS);
    advance(900_000);

    const pending = Promise.all([session.getAccessToken(), session.getAccessToken()]);
    resolve({ accessToken: 'access-2', accessExpiresInSeconds: 900 });
    expect(await pending).toEqual(['access-2', 'access-2']);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh 401 signs out', async () => {
    const { store, api, session, advance } = setup();
    api.refresh.mockRejectedValue(new ApiError(401, { code: 'session_expired' }));
    await session.signIn(TOKENS);
    advance(900_000);

    expect(await session.getAccessToken()).toBeNull();
    expect(await session.isSignedIn()).toBe(false);
    expect(store.data.has('refresh-token')).toBe(false);
  });

  it('network error during refresh keeps the session', async () => {
    const { api, session, advance } = setup();
    api.refresh.mockRejectedValue(new TypeError('Network request failed'));
    await session.signIn(TOKENS);
    advance(900_000);

    await expect(session.getAccessToken()).rejects.toBeInstanceOf(NetworkError);
    expect(await session.isSignedIn()).toBe(true);
  });

  it('signOut clears even when logout fails on network', async () => {
    const { store, api, session } = setup();
    api.logout.mockRejectedValue(new TypeError('Network request failed'));
    await session.signIn(TOKENS);

    await session.signOut();
    expect(api.logout).toHaveBeenCalledWith('access-1');
    expect(await session.isSignedIn()).toBe(false);
    expect(store.data.has('refresh-token')).toBe(false);
    expect(await session.getAccessToken()).toBeNull();
  });

  it('refresh timeout keeps the session', async () => {
    const { api, session, advance } = setup();
    api.refresh.mockRejectedValueOnce(new ApiTimeoutError());
    await session.signIn(TOKENS);
    advance(900_000);

    await expect(session.getAccessToken()).rejects.toBeInstanceOf(NetworkError);
    expect(await session.isSignedIn()).toBe(true);

    api.refresh.mockResolvedValueOnce({ accessToken: 'access-2', accessExpiresInSeconds: 900 });
    expect(await session.getAccessToken()).toBe('access-2');
    expect(api.refresh).toHaveBeenCalledTimes(2);
  });

  it('signOut completes when logout hangs', async () => {
    const { store, api, session } = setup();
    api.logout.mockReturnValue(new Promise(() => undefined));
    await session.signIn(TOKENS);

    await session.signOut();
    expect(await session.isSignedIn()).toBe(false);
    expect(store.data.has('refresh-token')).toBe(false);
  });

  it('signOut completes when the refresh before logout hangs', async () => {
    const { store, api } = setup();
    store.data.set('refresh-token', 'stored');
    api.refresh.mockReturnValue(new Promise(() => undefined));
    const fresh = createSessionManager({ store, api, now: () => 0, signOutTimeoutMs: 20 });

    await fresh.signOut();
    expect(await fresh.isSignedIn()).toBe(false);
    expect(api.logout).not.toHaveBeenCalled();
  });
});
