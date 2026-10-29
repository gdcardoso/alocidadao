import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (response: unknown) => void;
const fake = vi.hoisted(() => ({
  listeners: [] as ((response: unknown) => void)[],
  last: null as unknown,
  removed: 0,
}));

vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  addNotificationResponseReceivedListener: (listener: Listener) => {
    fake.listeners.push(listener);
    return { remove: () => fake.removed++ };
  },
  getLastNotificationResponseAsync: async () => fake.last,
  clearLastNotificationResponseAsync: async () => {
    fake.last = null;
  },
}));

const { createNotificationTaps, resetHandledNotifications } = await import('./notification-taps');

const REQUEST = '88888888-8888-4888-8888-888888888888';
const ROUTE = { href: `/solicitacao/${REQUEST}`, agent: false };

function response(id: string, data: Record<string, unknown>) {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: { request: { identifier: id, content: { data } } },
  };
}

const citizenData = { kind: 'request_rejected', tenantId: 't', requestId: REQUEST };
const tap = (r: unknown) => fake.listeners.forEach((l) => l(r));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fake.listeners = [];
  fake.last = null;
  fake.removed = 0;
  resetHandledNotifications();
});

describe('createNotificationTaps', () => {
  it('a tapped notification navigates after the session is ready', async () => {
    const open = vi.fn();
    const taps = createNotificationTaps(open);
    await flush();
    tap(response('n1', citizenData));
    expect(open).not.toHaveBeenCalled();
    taps.setSession('loading');
    expect(open).not.toHaveBeenCalled();
    taps.setSession('ready');
    expect(open).toHaveBeenCalledExactlyOnceWith(ROUTE);
    // Já pronta, o toque seguinte abre na hora.
    tap(response('n2', citizenData));
    expect(open).toHaveBeenCalledTimes(2);
    taps.stop();
    expect(fake.removed).toBe(1);
  });

  it('cold start uses the last notification response', async () => {
    fake.last = response('cold', citizenData);
    const open = vi.fn();
    const taps = createNotificationTaps(open);
    await flush();
    // O mesmo toque chegando também pelo ouvinte não abre duas vezes.
    tap(response('cold', citizenData));
    taps.setSession('ready');
    expect(open).toHaveBeenCalledExactlyOnceWith(ROUTE);
    // Remontado (ex.: sair e entrar), a resposta já tratada não volta.
    taps.stop();
    fake.last = response('cold', citizenData);
    const again = vi.fn();
    const next = createNotificationTaps(again);
    next.setSession('ready');
    await flush();
    expect(again).not.toHaveBeenCalled();
  });

  it('drops the pending tap when signed out', async () => {
    const open = vi.fn();
    const taps = createNotificationTaps(open);
    tap(response('n1', citizenData));
    taps.setSession('signedOut');
    taps.setSession('ready');
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores notifications without a known route', async () => {
    const open = vi.fn();
    const taps = createNotificationTaps(open);
    taps.setSession('ready');
    tap(response('n1', { kind: 'occurrence_new' }));
    tap({ ...response('n2', citizenData), actionIdentifier: 'other' });
    expect(open).not.toHaveBeenCalled();
  });
});
