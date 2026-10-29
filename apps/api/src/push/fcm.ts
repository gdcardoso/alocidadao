import type { PushMessage, PushResult, PushSender } from './types.js';

export interface FcmSenderOptions {
  projectId: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: { errorCode?: string; fieldViolations?: { field?: string }[] }[];
  };
}

function parseError(body: string): { codes: string[]; tokenInvalid: boolean } {
  try {
    const error = (JSON.parse(body) as FcmErrorBody).error;
    const details = error?.details ?? [];
    const codes = details.flatMap((d) => (d.errorCode ? [d.errorCode] : []));
    if (error?.status) codes.push(error.status);
    // INVALID_ARGUMENT também vem de payload ruim: só conta como token inválido se apontar o token.
    const tokenInvalid =
      /registration token/i.test(error?.message ?? '') ||
      details.some((d) => (d.fieldViolations ?? []).some((v) => v.field === 'message.token'));
    return { codes, tokenInvalid };
  } catch {
    return { codes: [], tokenInvalid: false };
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
      const { codes, tokenInvalid } = parseError(text);
      if (codes.includes('UNREGISTERED')) return { kind: 'invalid_token' };
      // 404 sem UNREGISTERED vem de configuração errada (FCM_PROJECT_ID, por exemplo), não do
      // token: apagá-lo tiraria o push de quem ainda tem o app.
      if (status === 404) return { kind: 'retry', reason: 'not_found' };
      if (status === 400 && codes.includes('INVALID_ARGUMENT')) {
        return tokenInvalid
          ? { kind: 'invalid_token' }
          : { kind: 'retry', reason: 'invalid_argument' };
      }
      if (status === 429) return { kind: 'retry', reason: 'rate_limited' };
      if (status >= 500) return { kind: 'retry', reason: `server_error_${status}` };
      return { kind: 'retry', reason: String(status) };
    },
  };
}
