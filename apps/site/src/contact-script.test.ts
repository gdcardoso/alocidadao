import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DEFAULT_SITE_CONTACT } from '@alocidadao/shared';
import { renderHome } from './render.js';
import { contactScript } from './contact-script.js';

const API = 'https://api.alocidadao.com.br';

/** Página da build num DOM de teste, com o `fetch` trocado e o script inline rodado. */
async function runScript(fetchImpl: (url: string) => Promise<unknown>) {
  const dom = new JSDOM(renderHome(DEFAULT_SITE_CONTACT), { runScripts: 'outside-only' });
  const errors: unknown[] = [];
  dom.window.addEventListener('error', (event) => errors.push(event.error));
  dom.window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));
  const fetchMock = vi.fn(fetchImpl);
  Object.assign(dom.window, { fetch: fetchMock });
  dom.window.eval(contactScript(API));
  // deixa as promessas do script terminarem
  await new Promise((resolve) => setTimeout(resolve, 20));
  const doc = dom.window.document;
  const point = (name: string) => doc.querySelector(`[data-contact="${name}"]`);
  return { doc, point, errors, fetchMock };
}

function okJson(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function snapshot(point: (name: string) => Element | null) {
  return {
    waHref: point('whatsapp-link')?.getAttribute('href'),
    waLabel: point('whatsapp-label')?.textContent,
    note: point('response-note')?.textContent,
    mailHref: point('email-link')?.getAttribute('href'),
    mailLabel: point('email-label')?.textContent,
  };
}

const BUILD_VALUES = {
  waHref: 'https://wa.me/5562982089667',
  waLabel: '(62) 98208-9667',
  note: 'Resposta no mesmo dia',
  mailHref: 'mailto:gdcardoso@gmail.com',
  mailLabel: 'gdcardoso@gmail.com',
};

describe('contact script', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the public route and swaps the five contact points', async () => {
    const { point, fetchMock, errors } = await runScript(() =>
      okJson({
        whatsapp: '+5511912345678',
        email: 'Contato@AloCidadao.com.br',
        responseNote: 'Resposta em até 1 dia útil',
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/public/site-contact`);
    expect(snapshot(point)).toEqual({
      waHref: 'https://wa.me/5511912345678',
      waLabel: '(11) 91234-5678',
      note: 'Resposta em até 1 dia útil',
      mailHref: 'mailto:contato@alocidadao.com.br',
      mailLabel: 'contato@alocidadao.com.br',
    });
    expect(errors).toEqual([]);
  });

  it('changes nothing when a field is missing', async () => {
    const { point, errors } = await runScript(() =>
      okJson({ whatsapp: '+5511912345678', email: 'contato@alocidadao.com.br' }),
    );
    expect(snapshot(point)).toEqual(BUILD_VALUES);
    expect(errors).toEqual([]);
  });

  it('changes nothing when the WhatsApp is not a Brazilian mobile', async () => {
    const { point } = await runScript(() =>
      okJson({ ...DEFAULT_SITE_CONTACT, whatsapp: 'javascript:alert(1)' }),
    );
    expect(snapshot(point)).toEqual(BUILD_VALUES);
  });

  it('changes nothing and throws nothing when the network fails', async () => {
    const { point, errors } = await runScript(() => Promise.reject(new TypeError('offline')));
    expect(snapshot(point)).toEqual(BUILD_VALUES);
    expect(errors).toEqual([]);
  });

  it('changes nothing when the API answers with an error', async () => {
    const { point, errors } = await runScript(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ code: 'internal' }) }),
    );
    expect(snapshot(point)).toEqual(BUILD_VALUES);
    expect(errors).toEqual([]);
  });

  it('inserts HTML from the API as plain text', async () => {
    const { point, doc } = await runScript(() =>
      okJson({ ...DEFAULT_SITE_CONTACT, responseNote: '<b>Rápido</b>' }),
    );
    expect(point('response-note')?.textContent).toBe('<b>Rápido</b>');
    expect(point('response-note')?.querySelector('b')).toBeNull();
    expect(doc.querySelectorAll('[data-contact] b')).toHaveLength(0);
  });
});
