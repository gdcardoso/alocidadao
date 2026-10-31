import { createDatabase, schema, withContext } from '@alocidadao/db';
import { tenantDetailSchema, tenantProfileSchema } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { tenantContracts } = schema;

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

async function getProfile(userId: string, tenantId: string) {
  return app.inject({
    method: 'GET',
    url: '/panel/tenant-profile',
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
  });
}

describe('GET /panel/tenant-profile', () => {
  it('manager reads the profile of his tenant only', async () => {
    const tenantId = await fx.createTenant('active');
    const otherTenantId = await fx.createTenant('active');
    const managerId = await fx.newManager(tenantId, []);
    await owner.db.insert(tenantContracts).values([
      {
        tenantId,
        plan: 'essential',
        startsOn: '2025-01-01',
        endsOn: '2025-12-31',
        includedPanelUsers: 3,
      },
      { tenantId, plan: 'complete', startsOn: '2026-01-01', includedPanelUsers: 9 },
    ]);

    const response = await getProfile(managerId, tenantId);
    expect(response.statusCode).toBe(200);
    const body = tenantProfileSchema.parse(response.json());
    expect(body).toMatchObject({
      displayName: 'Prefeitura do Painel',
      city: 'Painel',
      state: 'PR',
      status: 'active',
      // O contrato vigente é o de início mais recente.
      contract: { plan: 'complete', startsOn: '2026-01-01', endsOn: null, includedPanelUsers: 9 },
      panelUserCount: 1,
      neighborhoods: { count: 0, source: null },
    });

    const other = await getProfile(managerId, otherTenantId);
    expect(other.statusCode).toBe(403);
  });

  it('has no contract and counts the tenant neighborhoods', async () => {
    const tenantId = await fx.createTenant('onboarding');
    const adminId = await fx.newAdmin(tenantId);
    await owner.db.execute(sql`
      insert into tenant_neighborhoods (tenant_id, name, boundary)
      select ${tenantId}::uuid, n,
        ST_Multi(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326))
      from unnest(array['Centro', 'Norte']) n`);

    const response = await getProfile(adminId, tenantId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'onboarding',
      contract: null,
      neighborhoods: { count: 2, source: 'tenant' },
    });
  });

  it('allows support mode', async () => {
    const tenantId = await fx.createTenant('active');
    const staffId = await fx.newStaff('support');
    const response = await getProfile(staffId, tenantId);
    expect(response.statusCode).toBe(200);
  });

  it('profile has no write route', async () => {
    const tenantId = await fx.createTenant('active');
    const adminId = await fx.newAdmin(tenantId);
    const headers = await panelAuthHeader(appDb.db, adminId, tenantId);
    for (const method of ['PATCH', 'POST', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: '/panel/tenant-profile',
        headers,
        payload: { displayName: 'Outro' },
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('panelUserCount matches the backoffice detail', async () => {
    const tenantId = await fx.createTenant('active');
    const managerId = await fx.newManager(tenantId, []);
    await fx.newAdmin(tenantId);
    await fx.newManager(tenantId, [], 'Outro gestor');
    const staffId = await fx.newStaff('admin');

    const profile = tenantProfileSchema.parse((await getProfile(managerId, tenantId)).json());
    const detail = await app.inject({
      method: 'GET',
      url: `/backoffice/tenants/${tenantId}`,
      headers: await staffAuthHeader(appDb.db, staffId),
    });
    expect(detail.statusCode).toBe(200);
    expect(profile.panelUserCount).toBe(3);
    expect(tenantDetailSchema.parse(detail.json()).stats.panelUserCount).toBe(
      profile.panelUserCount,
    );
  });
});

describe('panel_tenant_profile()', () => {
  it('returns null for a user without active manager or admin membership', async () => {
    const tenantId = await fx.createTenant('active');
    const agentId = await fx.createUser('Agente');
    await fx.link(tenantId, agentId, 'field_agent');
    const result = await withContext(appDb.db, { tenantId, userId: agentId }, (tx) =>
      tx.execute<{ profile: unknown }>(sql`select panel_tenant_profile() as profile`),
    );
    expect(result.rows[0]?.profile).toBeNull();
  });

  it('returns null without a tenant context', async () => {
    const result = await withContext(appDb.db, {}, (tx) =>
      tx.execute<{ profile: unknown }>(sql`select panel_tenant_profile() as profile`),
    );
    expect(result.rows[0]?.profile).toBeNull();
  });
});
