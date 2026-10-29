import { describe, expect, it } from 'vitest';
import { createFcmSender } from './fcm.js';
import { notificationPushMessage } from './message.js';

const message = notificationPushMessage('request_in_progress', '2026-000123', {
  tenantId: 't-1',
  requestId: 'r-1',
});

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

  it('fcm treats INVALID_ARGUMENT without token detail as retry, not invalid token', async () => {
    const { fn } = fakeFetch(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'Invalid value at message.data',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'INVALID_ARGUMENT',
          },
        ],
      },
    });
    expect(await sender(fn).send('t', message)).toEqual({
      kind: 'retry',
      reason: 'invalid_argument',
    });
  });

  it('fcm treats UNREGISTERED and invalid registration token as invalid token', async () => {
    const unregistered = fakeFetch(400, {
      error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
    });
    expect((await sender(unregistered.fn).send('t', message)).kind).toBe('invalid_token');
    const byMessage = fakeFetch(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'The registration token is not a valid FCM registration token',
      },
    });
    expect((await sender(byMessage.fn).send('t', message)).kind).toBe('invalid_token');
    const byField = fakeFetch(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'Request contains an invalid argument.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'message.token', description: 'bad' }],
          },
        ],
      },
    });
    expect((await sender(byField.fn).send('t', message)).kind).toBe('invalid_token');
  });
});
