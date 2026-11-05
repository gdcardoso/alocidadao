import { ApiError } from '@alocidadao/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelSession, type PanelSessionClient } from './panel-session';

function fakeClient(overrides: Partial<PanelSessionClient> = {}): PanelSessionClient {
  return {
    panelRefresh: vi.fn(async () => ({ accessToken: 'new', accessExpiresInSeconds: 900 })),
    panelLogout: vi.fn(async () => undefined),
    ...overrides,
  };
}

const expired = () => new ApiError(401, { code: 'session_expired' });

afterEach(() => {
  vi.useRealTimers();
});

describe('createPanelSession', () => {
  it('concurrent 401s trigger a single refresh', async () => {
    const client = fakeClient();
    const session = createPanelSession({ client });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    const call = vi.fn(async () => {
      if (session.getAccessToken() === 'old') throw new ApiError(401, { code: 'unauthorized' });
      return session.getAccessToken();
    });

    const results = await Promise.all([
      session.withAuth(call),
      session.withAuth(call),
      session.withAuth(call),
    ]);

    expect(results).toEqual(['new', 'new', 'new']);
    expect(client.panelRefresh).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ status: 'signed_in', expiredNotice: false });
  });

  it('failed refresh signs out with the expired notice', async () => {
    const onExpired = vi.fn();
    const client = fakeClient({ panelRefresh: vi.fn(async () => Promise.reject(expired())) });
    const session = createPanelSession({ client, onExpired });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await expect(
      session.withAuth(async () => Promise.reject(new ApiError(401, { code: 'unauthorized' }))),
    ).rejects.toBeInstanceOf(ApiError);

    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: true });
    expect(session.getAccessToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('restore without cookie ends signed out', async () => {
    const client = fakeClient({ panelRefresh: vi.fn(async () => Promise.reject(expired())) });
    const session = createPanelSession({ client });
    expect(session.getState().status).toBe('loading');

    await expect(session.restore()).resolves.toBe(false);

    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: false });
  });

  it('restore with cookie signs in', async () => {
    const session = createPanelSession({ client: fakeClient() });
    await expect(session.restore()).resolves.toBe(true);
    expect(session.getState().status).toBe('signed_in');
    expect(session.getAccessToken()).toBe('new');
  });

  it('refreshes 60 s before the access token expires', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const session = createPanelSession({ client });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await vi.advanceTimersByTimeAsync(839_000);
    expect(client.panelRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.panelRefresh).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBe('new');
  });

  it('scheduled refresh retries after a network failure', async () => {
    vi.useFakeTimers();
    const panelRefresh = vi
      .fn<PanelSessionClient['panelRefresh']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ accessToken: 'new', accessExpiresInSeconds: 900 });
    const session = createPanelSession({ client: fakeClient({ panelRefresh }) });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await vi.advanceTimersByTimeAsync(840_000);
    expect(panelRefresh).toHaveBeenCalledTimes(1);
    expect(session.getState().status).toBe('signed_in');
    expect(session.getAccessToken()).toBe('old');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(panelRefresh).toHaveBeenCalledTimes(2);
    expect(session.getAccessToken()).toBe('new');
    expect(session.getState()).toEqual({ status: 'signed_in', expiredNotice: false });
  });

  it.each([
    ['429', () => new ApiError(429, { code: 'rate_limited', retryAfterSeconds: 10 })],
    ['503', () => new ApiError(503, { code: 'unavailable' })],
    ['500', () => new ApiError(500, { code: 'internal' })],
  ])('refresh %s keeps the session and retries', async (_status, failure) => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    const panelRefresh = vi
      .fn<PanelSessionClient['panelRefresh']>()
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce({ accessToken: 'new', accessExpiresInSeconds: 900 });
    const session = createPanelSession({ client: fakeClient({ panelRefresh }), onExpired });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await vi.advanceTimersByTimeAsync(840_000);
    expect(panelRefresh).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ status: 'signed_in', expiredNotice: false });
    expect(session.getAccessToken()).toBe('old');
    expect(onExpired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(panelRefresh).toHaveBeenCalledTimes(2);
    expect(session.getAccessToken()).toBe('new');
  });

  it('refresh failing with 503 inside a call keeps the session and fails the call', async () => {
    const onExpired = vi.fn();
    const unavailable = new ApiError(503, { code: 'unavailable' });
    const client = fakeClient({ panelRefresh: vi.fn(async () => Promise.reject(unavailable)) });
    const session = createPanelSession({ client, onExpired });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await expect(
      session.withAuth(async () => Promise.reject(new ApiError(401, { code: 'unauthorized' }))),
    ).rejects.toBe(unavailable);

    expect(session.getState()).toEqual({ status: 'signed_in', expiredNotice: false });
    expect(session.getAccessToken()).toBe('old');
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('only 401 signs out with the expired notice', async () => {
    const onExpired = vi.fn();
    const panelRefresh = vi
      .fn<PanelSessionClient['panelRefresh']>()
      .mockRejectedValueOnce(new ApiError(429, { code: 'rate_limited', retryAfterSeconds: 10 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(expired());
    const session = createPanelSession({ client: fakeClient({ panelRefresh }), onExpired });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });
    const unauthorizedCall = async () =>
      Promise.reject(new ApiError(401, { code: 'unauthorized' }));

    await expect(session.withAuth(unauthorizedCall)).rejects.toBeInstanceOf(ApiError);
    await expect(session.withAuth(unauthorizedCall)).rejects.toBeInstanceOf(TypeError);
    expect(session.getState()).toEqual({ status: 'signed_in', expiredNotice: false });
    expect(onExpired).not.toHaveBeenCalled();

    await expect(session.withAuth(unauthorizedCall)).rejects.toBeInstanceOf(ApiError);
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: true });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('scheduled refresh with an expired cookie signs out with the notice', async () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    const client = fakeClient({ panelRefresh: vi.fn(async () => Promise.reject(expired())) });
    const session = createPanelSession({ client, onExpired });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await vi.advanceTimersByTimeAsync(840_000);
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: true });
    expect(onExpired).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.panelRefresh).toHaveBeenCalledTimes(1);
  });

  it('sign out clears the token and calls logout', async () => {
    const client = fakeClient();
    const session = createPanelSession({ client });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await session.signOut();

    expect(client.panelLogout).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: false });
  });

  it('sign out for lack of use ends the server session and shows the notice', async () => {
    const client = fakeClient();
    const session = createPanelSession({ client });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await session.signOut({ expired: true });

    expect(client.panelLogout).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: true });
  });
});
