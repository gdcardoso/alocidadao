import { randomInt } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { cityInterestResponseSchema } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { cityInterest, municipalities, municipalityLeads, staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function backoffice(
  method: 'GET' | 'PUT',
  url: string,
  userId: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: await staffAuthHeader(appDb.db, userId), payload });
}

/** Município com um pedido de interesse; o código IBGE é aleatório para não colidir. */
async function cityWithInterest(name: string) {
  const ibgeCode = String(randomInt(1_000_000, 9_999_999));
  await owner.db.insert(municipalities).values({
    ibgeCode,
    name,
    state: 'BA',
    boundary: sql`ST_Multi(ST_MakeEnvelope(-42.6, -12.6, -42.4, -12.4, 4326))`,
  });
  await owner.db.insert(cityInterest).values({ ibgeCode, userId: await fx.createUser('Cidadão') });
  return ibgeCode;
}

describe('interesse por cidade do backoffice', () => {
  it('lists interest with customer flag for admin and support', async () => {
    const ibgeCode = await cityWithInterest('Cidade Interessada');
    for (const role of ['admin', 'support'] as const) {
      const staffId = await fx.newStaff(role);
      const response = await backoffice('GET', '/backoffice/city-interest', staffId);
      expect(response.statusCode).toBe(200);
      const body = cityInterestResponseSchema.parse(response.json());
      expect(body.items.find((row) => row.ibgeCode === ibgeCode)).toMatchObject({
        name: 'Cidade Interessada',
        state: 'BA',
        requestCount: 1,
        commercialStatus: 'new',
        isCustomer: false,
      });
    }
  });

  it('csv download has attachment header and the expected first line', async () => {
    await cityWithInterest('Cidade Csv');
    const staffId = await fx.newStaff('support');
    const response = await backoffice('GET', '/backoffice/city-interest.csv', staffId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="interesse-por-cidade.csv"',
    );
    expect(response.body.split('\r\n')[0]).toBe(
      '﻿Posição;Município;UF;Pedidos;Últimos 30 dias;Primeiro pedido;Situação comercial;Já é cliente',
    );
  });

  it('support can change commercial status', async () => {
    const ibgeCode = await cityWithInterest('Cidade Lead');
    const staffId = await fx.newStaff('support');
    const response = await backoffice(
      'PUT',
      `/backoffice/city-interest/${ibgeCode}/status`,
      staffId,
      { status: 'negotiating' },
    );
    expect(response.statusCode).toBe(204);
    const [lead] = await owner.db
      .select()
      .from(municipalityLeads)
      .where(eq(municipalityLeads.ibgeCode, ibgeCode));
    expect(lead).toMatchObject({ commercialStatus: 'negotiating', updatedBy: staffId });
    const audit = await owner.db
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.staffUserId, staffId));
    expect(audit.map((a) => a.action)).toEqual(['lead.update']);
  });

  it('unknown municipality is 404 municipality_not_found', async () => {
    const staffId = await fx.newStaff('admin');
    const response = await backoffice('PUT', '/backoffice/city-interest/0000001/status', staffId, {
      status: 'won',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'municipality_not_found' });
  });

  it('invalid ibge code is 400', async () => {
    const staffId = await fx.newStaff('admin');
    const response = await backoffice('PUT', '/backoffice/city-interest/abc/status', staffId, {
      status: 'won',
    });
    expect(response.statusCode).toBe(400);
  });

  it('app token is 403 not_platform_staff', async () => {
    const citizenId = await fx.createUser('Cidadão');
    const headers = await appAuthHeader(appDb.db, citizenId);
    for (const url of ['/backoffice/city-interest', '/backoffice/city-interest.csv']) {
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: 'not_platform_staff' });
    }
  });
});
