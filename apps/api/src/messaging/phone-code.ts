import type { FastifyBaseLogger } from 'fastify';

/** Envio do código de entrada pelo celular; quem chama não sabe qual provedor está por trás. */
export interface PhoneCodeSender {
  /** `phone` no formato `+55…` (o mesmo de `phoneSchema`). */
  send(phone: string, code: string): Promise<void>;
}

/** Só fora de produção (ou na homologação): o código sai no log da API. */
export function createLogPhoneCodeSender(log: FastifyBaseLogger): PhoneCodeSender {
  return {
    send: async (phone, code) => {
      log.info({ phone, code }, 'Código pelo celular (log, sem provedor)');
    },
  };
}

/** `+5562982089667` vira `+55 62 9****-9667`, para o número não ir inteiro para o log. */
export function maskPhone(phone: string): string {
  const match = /^\+55(\d{2})(\d)\d*(\d{4})$/.exec(phone);
  return match ? `+55 ${match[1]} ${match[2]}****-${match[3]}` : '****';
}
