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

  it('sign out clears the token and calls logout', async () => {
    const client = fakeClient();
    const session = createPanelSession({ client });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });

    await session.signOut();

    expect(client.panelLogout).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: false });
  });
});
