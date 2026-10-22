import { describe, expect, it } from 'vitest';
import { createFcmSender } from './fcm.js';
import { statusPushMessage } from './message.js';

const message = statusPushMessage('2026-000123', 'in_progress');

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body === null ? '' : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

function sender(f: typeof fetch) {
  return createFcmSender({ projectId: 'proj-1', getAccessToken: async () => 'tok-abc', fetch: f });
}

describe('fcm sender', () => {
  it('sends the v1 request', async () => {
    const { fn, calls } = fakeFetch(200, { name: 'projects/proj-1/messages/1' });
    const result = await sender(fn).send('device-token', message);
    expect(result).toEqual({ kind: 'sent' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/proj-1/messages:send');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      message: {
        token: 'device-token',
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channel_id: 'status' } },
      },
    });
  });

  it.each([
    [404, 'UNREGISTERED', 'invalid_token'],
    [503, 'UNAVAILABLE', 'retry'],
    [200, null, 'sent'],
  ])('maps %i %s to %s', async (status, code, kind) => {
    const body =
      code === null
        ? { name: 'x' }
        : {
            error: {
              status: code,
              details: [
                { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code },
              ],
            },
          };
    const { fn } = fakeFetch(status, body);
    const result = await sender(fn).send('t', message);
    expect(result.kind).toBe(kind);
  });

  it('maps errorCode UNREGISTERED to invalid_token regardless of status', async () => {
    const { fn } = fakeFetch(400, {
      error: {
        status: 'NOT_FOUND',
        details: [{ '@type': 'x.FcmError', errorCode: 'UNREGISTERED' }],
      },
    });
    expect(await sender(fn).send('t', message)).toEqual({ kind: 'invalid_token' });
  });

  it('maps 400 INVALID_ARGUMENT to invalid_token', async () => {
    const { fn } = fakeFetch(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        details: [{ '@type': 'x.FcmError', errorCode: 'INVALID_ARGUMENT' }],
      },
    });
    expect(await sender(fn).send('t', message)).toEqual({ kind: 'invalid_token' });
  });

  it('maps 429 to retry with a reason', async () => {
    const { fn } = fakeFetch(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    const result = await sender(fn).send('t', message);
    expect(result.kind).toBe('retry');
  });

  it('maps unknown statuses to retry with the status as reason', async () => {
    const { fn } = fakeFetch(401, 'nope');
    expect(await sender(fn).send('t', message)).toEqual({ kind: 'retry', reason: '401' });
  });

  it('maps a network failure to retry', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await sender(f).send('t', message)).toEqual({ kind: 'retry', reason: 'network' });
  });

  it('maps an access token failure to retry without throwing', async () => {
    const { fn } = fakeFetch(200, {});
    const s = createFcmSender({
      projectId: 'p',
      getAccessToken: async () => {
        throw new Error('no creds');
      },
      fetch: fn,
    });
    expect(await s.send('t', message)).toEqual({ kind: 'retry', reason: 'auth' });
  });
});
