import type { PhoneCodeSender } from './phone-code.js';

export interface MetaWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  graphApiVersion: string;
}

/**
 * Envio pela API de nuvem da Meta, com um template de autenticação
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates).
 * Nem o código nem o token entram em log ou em mensagem de erro.
 */
export function createMetaPhoneCodeSender(
  config: MetaWhatsAppConfig,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): PhoneCodeSender {
  const fetchFn = opts.fetch ?? fetch;
  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  return {
    send: async (phone, code) => {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: config.templateName,
            language: { code: config.templateLanguage },
            // O template de autenticação leva o código no corpo e no botão de copiar.
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: code }],
              },
            ],
          },
        }),
      });
      if (!response.ok) {
        // Só o código de erro da Meta: o texto da resposta pode repetir o código ou o token.
        const body: unknown = await response.json().catch(() => undefined);
        const errorCode = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
        const detail = typeof errorCode === 'number' ? ` (${errorCode})` : '';
        throw new Error(`WhatsApp (Meta) recusou o envio: ${response.status}${detail}`);
      }
    },
  };
}
