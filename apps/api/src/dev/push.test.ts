import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { PushMessage, PushResult, PushSender } from '../push/types.js';

function fakeSender(result: PushResult) {
  const calls: { token: string; message: PushMessage }[] = [];
  const sender: PushSender = {
    async send(token, message) {
      calls.push({ token, message });
      return result;
    },
  };
  return { sender, calls };
}

const body = {
  platform: 'android',
  token: 'tok',
  kind: 'request_in_progress',
  protocol: '2026-000123',
};

describe('POST /dev/push', () => {
  it('responds 503 when the platform sender is not configured', async () => {
    const { sender } = fakeSender({ kind: 'sent' });
    const app = await buildApp({ devRoutes: true, push: { ios: sender } });
    const res = await app.inject({ method: 'POST', url: '/dev/push', payload: body });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'push_not_configured' });
    await app.close();
  });

  it('responds 503 when the platform only has the log sender', async () => {
    const { sender, calls } = fakeSender({ kind: 'sent' });
    const app = await buildApp({
      devRoutes: true,
      push: { android: sender, configured: { android: false, ios: false } },
    });
    const res = await app.inject({ method: 'POST', url: '/dev/push', payload: body });
    expect(res.statusCode).toBe(503);
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it('sends the notification message and returns the result', async () => {
    const { sender, calls } = fakeSender({ kind: 'retry', reason: 'network' });
    const app = await buildApp({ devRoutes: true, push: { android: sender } });
    const res = await app.inject({ method: 'POST', url: '/dev/push', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'retry', reason: 'network' });
    expect(calls).toEqual([
      {
        token: 'tok',
        message: {
          title: 'Alô Cidadão',
          body: 'Solicitação 2026-000123: em atendimento',
          data: {
            kind: 'request_in_progress',
            tenantId: 'dev',
            requestId: 'dev',
            workOrderId: 'dev',
          },
        },
      },
    ]);
    await app.close();
  });

  it('routes ios to the ios sender', async () => {
    const android = fakeSender({ kind: 'sent' });
    const ios = fakeSender({ kind: 'invalid_token' });
    const app = await buildApp({
      devRoutes: true,
      push: { android: android.sender, ios: ios.sender },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/dev/push',
      payload: { ...body, platform: 'ios' },
    });
    expect(res.json()).toEqual({ kind: 'invalid_token' });
    expect(android.calls).toHaveLength(0);
    expect(ios.calls).toHaveLength(1);
    await app.close();
  });

  it('responds 400 on an invalid body', async () => {
    const { sender } = fakeSender({ kind: 'sent' });
    const app = await buildApp({ devRoutes: true, push: { android: sender } });
    const res = await app.inject({
      method: 'POST',
      url: '/dev/push',
      payload: { ...body, kind: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('does not register the route without devRoutes', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/dev/push', payload: body });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
