import { healthResponseSchema } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('returns ok with the shared response shape', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
    await app.close();
  });
});

describe('error handler', () => {
  it("unexpected error returns 500 { code: 'internal_error' } without the message", async () => {
    const app = await buildApp();
    app.get('/boom', async () => {
      throw new Error('connection to db-prod:5432 refused');
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'internal_error' });
    expect(response.body).not.toContain('db-prod');
    await app.close();
  });

  it('keeps 4xx errors as they are', async () => {
    const app = await buildApp();
    app.post('/echo', (request) => request.body);
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{invalido',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ statusCode: 400 });
    await app.close();
  });
});

describe('trustProxy', () => {
  async function ipBehindProxy(trustProxy: boolean) {
    const app = await buildApp({ trustProxy });
    app.get('/ip', (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    await app.close();
    return response.json<{ ip: string }>().ip;
  }

  it('takes the client IP from x-forwarded-for when on', async () => {
    expect(await ipBehindProxy(true)).toBe('203.0.113.9');
  });

  it('ignores x-forwarded-for by default', async () => {
    expect(await ipBehindProxy(false)).not.toBe('203.0.113.9');
  });
});
