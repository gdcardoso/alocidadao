import type { FastifyBaseLogger } from 'fastify';

/** Envio de SMS. Ainda não há provedor escolhido (spec 11). */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Só fora de produção: o texto (com o código) sai no log da API. */
export function createLogSmsSender(log: FastifyBaseLogger): SmsSender {
  return {
    send: async (phone, text) => {
      log.info({ phone, text }, 'SMS (log, sem provedor)');
    },
  };
}

export function smsCodeText(code: string): string {
  return `Alô Cidadão: seu código é ${code}. Não compartilhe com ninguém.`;
}
