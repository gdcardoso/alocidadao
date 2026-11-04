import { describe, expect, it } from 'vitest';
import { createResendEmailSender } from './email.js';

describe('createResendEmailSender', () => {
  it('posts the message to Resend', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
    }) as typeof fetch;
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Alô Cidadão <nao-responda@alocidadao.com.br>',
      fetch: fakeFetch,
    });

    await sender.send({ to: 'maria@exemplo.com', subject: 'Assunto', text: 'Corpo' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('authorization')).toBe('Bearer re_test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: 'Alô Cidadão <nao-responda@alocidadao.com.br>',
      to: ['maria@exemplo.com'],
      subject: 'Assunto',
      text: 'Corpo',
    });
  });

  it('throws when Resend refuses the message', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ message: 'invalid' }), { status: 422 })) as typeof fetch;
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'x@y.com',
      fetch: fakeFetch,
    });
    await expect(sender.send({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toThrow(/422/);
  });

  it('sends html and the display name when the message has them', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Alô Cidadão <nao-responda@alocidadao.com.br>',
      fetch: fakeFetch,
    });
    await sender.send({
      to: 'a@b.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
      fromName: 'Alô Cidadão · Prefeitura de Goiânia',
    });
    await sender.send({ to: 'a@b.com', subject: 's', text: 't' });
    expect(bodies[0]).toMatchObject({
      from: 'Alô Cidadão · Prefeitura de Goiânia <nao-responda@alocidadao.com.br>',
      html: '<p>t</p>',
    });
    expect(bodies[1]!.from).toBe('Alô Cidadão <nao-responda@alocidadao.com.br>');
    expect(bodies[1]).not.toHaveProperty('html');
  });

  it('quotes a display name with special characters per RFC 5322', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Alô Cidadão <nao-responda@alocidadao.com.br>',
      fetch: fakeFetch,
    });
    await sender.send({
      to: 'a@b.com',
      subject: 's',
      text: 't',
      fromName: 'Alô Cidadão · Prefeitura de Silva, "Sul"',
    });
    expect(bodies[0]!.from).toBe(
      '"Alô Cidadão · Prefeitura de Silva, \\"Sul\\"" <nao-responda@alocidadao.com.br>',
    );
  });
});
