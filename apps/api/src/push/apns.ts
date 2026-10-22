import { importPKCS8, SignJWT } from 'jose';
import { createHttp2Request, type Http2Request } from './http2.js';
import type { PushMessage, PushResult, PushSender } from './types.js';

export type { Http2Request } from './http2.js';

export interface ApnsSenderOptions {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  production: boolean;
  request?: Http2Request;
  /** Relógio em milissegundos; injetável nos testes. */
  now?: () => number;
}

const TOKEN_TTL_MS = 50 * 60_000;

function apnsReason(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { reason?: string }).reason;
  } catch {
    return undefined;
  }
}

export function createApnsSender({
  teamId,
  keyId,
  privateKeyPem,
  bundleId,
  production,
  request = createHttp2Request(),
  now = Date.now,
}: ApnsSenderOptions): PushSender {
  const origin = production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  let cached: { jwt: string; signedAt: number } | undefined;

  async function authToken(): Promise<string> {
    const current = now();
    if (cached && current - cached.signedAt < TOKEN_TTL_MS) return cached.jwt;
    const key = await importPKCS8(privateKeyPem, 'ES256');
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(Math.floor(current / 1000))
      .sign(key);
    cached = { jwt, signedAt: current };
    return jwt;
  }

  return {
    async send(token: string, message: PushMessage): Promise<PushResult> {
      let jwt: string;
      try {
        jwt = await authToken();
      } catch {
        return { kind: 'retry', reason: 'auth' };
      }

      let response: { status: number; body: string };
      try {
        response = await request(
          `${origin}/3/device/${token}`,
          {
            authorization: `bearer ${jwt}`,
            'apns-topic': bundleId,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'content-type': 'application/json',
          },
          JSON.stringify({
            aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
            ...message.data,
          }),
        );
      } catch {
        return { kind: 'retry', reason: 'network' };
      }

      const { status } = response;
      if (status === 200) return { kind: 'sent' };
      const reason = apnsReason(response.body);
      if (status === 410) return { kind: 'invalid_token' };
      if (status === 400 && (reason === 'BadDeviceToken' || reason === 'Unregistered')) {
        return { kind: 'invalid_token' };
      }
      if (status === 429) return { kind: 'retry', reason: 'rate_limited' };
      if (status >= 500) return { kind: 'retry', reason: `server_error_${status}` };
      return { kind: 'retry', reason: String(status) };
    },
  };
}
