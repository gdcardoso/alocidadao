import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_CONTACT } from '@alocidadao/shared';
import { FALLBACK_WARNING, loadBuildContact } from './load-contact.js';

const API = 'https://api.alocidadao.com.br';
const CUSTOM = {
  whatsapp: '+5562999990000',
  email: 'contato@alocidadao.com.br',
  responseNote: 'Resposta em até 1 dia útil',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('loadBuildContact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the defaults and warns when there is no API address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn<typeof fetch>();
    await expect(loadBuildContact(undefined, fetchFn)).resolves.toEqual(DEFAULT_SITE_CONTACT);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(FALLBACK_WARNING);
    expect(FALLBACK_WARNING).toBe(
      'Aviso: contato do site com os valores iniciais (API indisponível).',
    );
  });

  it('returns the contact from the public route', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(CUSTOM));
    await expect(loadBuildContact(`${API}/`, fetchFn)).resolves.toEqual(CUSTOM);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`${API}/public/site-contact`);
  });

  it('falls back when the API takes longer than 3 seconds', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(jsonResponse(CUSTOM)), 4000);
        }),
    );
    const pending = loadBuildContact(API, fetchFn);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toEqual(DEFAULT_SITE_CONTACT);
    expect(warn).toHaveBeenCalledWith(FALLBACK_WARNING);
  });

  it('falls back when the response is invalid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ whatsapp: '+5562982089667', email: 'x' }));
    await expect(loadBuildContact(API, fetchFn)).resolves.toEqual(DEFAULT_SITE_CONTACT);
    expect(warn).toHaveBeenCalledWith(FALLBACK_WARNING);
  });

  it('falls back when the API answers with an error or the network fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code: 'x' }, 500));
    await expect(loadBuildContact(API, failing)).resolves.toEqual(DEFAULT_SITE_CONTACT);
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(loadBuildContact(API, offline)).resolves.toEqual(DEFAULT_SITE_CONTACT);
  });
});
