import type { PushMessage, PushResult, PushSender } from './types.js';

export interface FcmSenderOptions {
  projectId: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

interface FcmErrorBody {
  error?: { status?: string; details?: { errorCode?: string }[] };
}

function errorCodes(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as FcmErrorBody;
    const codes = (parsed.error?.details ?? []).flatMap((d) => (d.errorCode ? [d.errorCode] : []));
    if (parsed.error?.status) codes.push(parsed.error.status);
    return codes;
  } catch {
    return [];
  }
}

export function createFcmSender({
  projectId,
  getAccessToken,
  fetch: fetchImpl = fetch,
}: FcmSenderOptions): PushSender {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  return {
    async send(token: string, message: PushMessage): Promise<PushResult> {
      let accessToken: string;
      try {
        accessToken = await getAccessToken();
      } catch {
        return { kind: 'retry', reason: 'auth' };
      }

      let status: number;
      let text: string;
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'high', notification: { channel_id: 'status' } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        status = response.status;
        text = await response.text();
      } catch {
        return { kind: 'retry', reason: 'network' };
      }

      if (status === 200) return { kind: 'sent' };
      const codes = errorCodes(text);
      if (status === 404 || codes.includes('UNREGISTERED')) return { kind: 'invalid_token' };
      // No spike, todo 400 INVALID_ARGUMENT conta como erro de token.
      if (status === 400 && codes.includes('INVALID_ARGUMENT')) return { kind: 'invalid_token' };
      if (status === 429) return { kind: 'retry', reason: 'rate_limited' };
      if (status >= 500) return { kind: 'retry', reason: `server_error_${status}` };
      return { kind: 'retry', reason: String(status) };
    },
  };
}
