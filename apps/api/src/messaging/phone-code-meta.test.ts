import { describe, expect, it } from 'vitest';
import { createMetaPhoneCodeSender } from './phone-code-meta.js';

const config = {
  phoneNumberId: 'PNID',
  accessToken: 'TOKEN',
  templateName: 'codigo_entrada',
  templateLanguage: 'pt_BR',
  graphApiVersion: 'v23.0',
};

describe('createMetaPhoneCodeSender', () => {
  it('posts the authentication template', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await createMetaPhoneCodeSender(config, { fetch: fakeFetch }).send('+5562982089667', '123456');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/PNID/messages');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '5562982089667',
      type: 'template',
      template: {
        name: 'codigo_entrada',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '123456' }],
          },
        ],
      },
    });
  });

  it('rejected send throws without code or token', async () => {
    const fakeFetch = (async () =>
      new Response('{"error":{"message":"bad 123456 TOKEN","code":131030}}', {
        status: 400,
      })) as unknown as typeof fetch;
    const error = await createMetaPhoneCodeSender(config, { fetch: fakeFetch })
      .send('+5562982089667', '123456')
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('400');
    expect(message).toContain('131030');
    expect(message).not.toContain('123456');
    expect(message).not.toContain('TOKEN');
  });

  it('gives up after the timeout', async () => {
    const hangingFetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(
      createMetaPhoneCodeSender(config, { fetch: hangingFetch, timeoutMs: 20 }).send(
        '+5562982089667',
        '123456',
      ),
    ).rejects.toThrow();
  });
});
