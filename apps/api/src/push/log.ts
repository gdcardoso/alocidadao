import type { PushMessage, PushSender } from './types.js';

/** Sem FCM/APNs: o push sai no log da API, só com os 8 últimos caracteres do token. */
export function createLogPushSender(
  log: { info: (obj: object, msg: string) => void },
  platform?: string,
): PushSender {
  return {
    async send(token: string, message: PushMessage) {
      log.info(
        {
          platform,
          kind: message.data.kind,
          // O texto já traz o protocolo (e nada além dele).
          body: message.body,
          token: `…${token.slice(-8)}`,
        },
        'Push (log, sem provedor)',
      );
      return { kind: 'sent' as const };
    },
  };
}
