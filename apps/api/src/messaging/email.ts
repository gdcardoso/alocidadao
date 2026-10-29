import { completionEmail } from '@alocidadao/shared';
import type { FastifyBaseLogger } from 'fastify';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** Só fora de produção: a mensagem (com o código) sai no log da API. */
export function createLogEmailSender(log: FastifyBaseLogger): EmailSender {
  return {
    send: async (msg) => {
      log.info(msg, 'E-mail (log, sem provedor)');
    },
  };
}

/** Envio pelo Resend (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendEmailSender({
  apiKey,
  from,
  fetch: fetchFn = fetch,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): EmailSender {
  return {
    send: async ({ to, subject, text }) => {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Resend recusou o e-mail: ${response.status} ${detail}`);
      }
    },
  };
}

export function codeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: 'Seu código do Alô Cidadão',
    text: `Seu código é ${code}. Ele vale por 10 minutos. Se você não pediu este código, ignore este e-mail.`,
  };
}

/** Aviso da conclusão ao cidadão: a prefeitura concluiu e ele confere as fotos no app. */
export function completionEmailMessage(to: string, protocol: string): EmailMessage {
  return { to, ...completionEmail(protocol) };
}
