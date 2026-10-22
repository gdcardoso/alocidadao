import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApnsSender, type Http2Request } from './apns.js';
import { statusPushMessage } from './message.js';

const KEY_ID = 'ABC123DEFG';
const TEAM_ID = 'TEAM123456';
const message = statusPushMessage('2026-000123', 'in_progress');

let privateKeyPem: string;
beforeAll(async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
});

function fakeRequest(status: number, body: string) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const request: Http2Request = async (url, headers, reqBody) => {
    calls.push({ url, headers, body: reqBody });
    return { status, body };
  };
  return { request, calls };
}

function sender(request: Http2Request, extra: { now?: () => number; production?: boolean } = {}) {
  return createApnsSender({
    teamId: TEAM_ID,
    keyId: KEY_ID,
    privateKeyPem,
    bundleId: 'br.com.alocidadao.app',
    production: extra.production ?? false,
    request,
    now: extra.now,
  });
}

describe('apns sender', () => {
  it('signs an ES256 token with kid and team', async () => {
    const { request, calls } = fakeRequest(200, '');
    await sender(request, { now: () => 1_700_000_000_000 }).send('dev-token', message);
    const auth = calls[0]!.headers.authorization!;
    expect(auth.startsWith('bearer ')).toBe(true);
    const jwt = auth.slice('bearer '.length);
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: KEY_ID });
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe(TEAM_ID);
    expect(claims.iat).toBe(1_700_000_000);
  });

  it('uses the sandbox host, topic and body', async () => {
    const { request, calls } = fakeRequest(200, '');
    const result = await sender(request).send('dev-token', message);
    expect(result).toEqual({ kind: 'sent' });
    expect(calls[0]!.url.startsWith('https://api.sandbox.push.apple.com/3/device/')).toBe(true);
    expect(calls[0]!.url.endsWith('/dev-token')).toBe(true);
    expect(calls[0]!.headers['apns-topic']).toBe('br.com.alocidadao.app');
    expect(calls[0]!.headers['apns-push-type']).toBe('alert');
    expect(calls[0]!.headers['apns-priority']).toBe('10');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
      protocol: '2026-000123',
      status: 'in_progress',
    });
  });

  it('uses the production host when production is true', async () => {
    const { request, calls } = fakeRequest(200, '');
    await sender(request, { production: true }).send('dev-token', message);
    expect(calls[0]!.url.startsWith('https://api.push.apple.com/3/device/')).toBe(true);
  });

  it.each([
    [410, 'Unregistered', 'invalid_token'],
    [400, 'BadDeviceToken', 'invalid_token'],
    [400, 'Unregistered', 'invalid_token'],
    [429, 'TooManyRequests', 'retry'],
    [503, 'ServiceUnavailable', 'retry'],
  ])('maps %i %s to %s', async (status, reason, kind) => {
    const { request } = fakeRequest(status, JSON.stringify({ reason }));
    const result = await sender(request).send('t', message);
    expect(result.kind).toBe(kind);
  });

  it('maps unknown statuses to retry with the status as reason', async () => {
    const { request } = fakeRequest(403, JSON.stringify({ reason: 'InvalidProviderToken' }));
    expect(await sender(request).send('t', message)).toEqual({ kind: 'retry', reason: '403' });
  });

  it('maps a network failure to retry', async () => {
    const request: Http2Request = async () => {
      throw new Error('socket hang up');
    };
    expect(await sender(request).send('t', message)).toEqual({ kind: 'retry', reason: 'network' });
  });

  it('reuses the token within 50 minutes and signs a new one after', async () => {
    const { request, calls } = fakeRequest(200, '');
    let now = 1_700_000_000_000;
    const s = sender(request, { now: () => now });
    await s.send('t', message);
    now += 49 * 60_000;
    await s.send('t', message);
    now += 2 * 60_000; // 51 min after the first
    await s.send('t', message);
    const [a, b, c] = calls.map((x) => x.headers.authorization);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});
