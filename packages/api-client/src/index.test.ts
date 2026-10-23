import { describe, expect, it } from 'vitest';
import { ApiTimeoutError, createApiClient } from './index.js';

/** fetch que nunca responde, mas respeita o AbortSignal. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('api client', () => {
  it('request times out', async () => {
    const api = createApiClient({ baseUrl: 'http://api', fetch: hangingFetch, timeoutMs: 20 });
    await expect(api.refresh('token')).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  it('logout sends the explicit token', async () => {
    let auth: string | null = null;
    const fakeFetch: typeof fetch = async (_input, init) => {
      auth = new Headers(init?.headers).get('Authorization');
      return new Response(null, { status: 204 });
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.logout('access-1');
    expect(auth).toBe('Bearer access-1');
  });
});
