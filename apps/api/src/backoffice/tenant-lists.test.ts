import { randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { staffPanelIdentity } from './tenant-lists.js';

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

async function get(userId: string, tenantId: string, path: string) {
  return app.inject({
    method: 'GET',
    url: `/backoffice/tenants/${tenantId}/${path}`,
    headers: await staffAuthHeader(appDb.db, userId),
  });
}

describe('listas do backoffice por prefeitura', () => {
  it('staffPanelIdentity builds a tenant admin identity with the platform role', () => {
    expect(staffPanelIdentity({ userId: 'u', platformRole: 'support' }, 't')).toEqual({
      userId: 'u',
      tenantId: 't',
      role: 'tenant_admin',
      departmentIds: null,
      platformRole: 'support',
    });
  });

  it('staff lists teams, managers and categories of a tenant', async () => {
    const seed = await fx.seedPanelTenant();
    const teamId = await fx.addTeam(seed.tenantId, { departmentId: seed.worksId, name: 'Turno A' });
    await fx.addAgent(seed.tenantId, teamId, 'active');
    const managerId = await fx.newManager(seed.tenantId, [seed.worksId], 'Gestora de Obras');
    for (const role of ['admin', 'support'] as const) {
      const staffId = await fx.newStaff(role);

      const teams = await get(staffId, seed.tenantId, 'teams');
      expect(teams.statusCode).toBe(200);
      expect(teams.json().items).toEqual([
        expect.objectContaining({
          name: 'Turno A',
          departmentName: 'Obras',
          agentCount: 1,
          activeAgentCount: 1,
        }),
      ]);

      const managers = await get(staffId, seed.tenantId, 'managers');
      expect(managers.statusCode).toBe(200);
      expect(managers.json().items).toEqual([
        expect.objectContaining({ userId: managerId, name: 'Gestora de Obras', role: 'manager' }),
      ]);

      const categories = await get(staffId, seed.tenantId, 'categories');
      expect(categories.statusCode).toBe(200);
      expect(
        categories
          .json()
          .items.map((c: { name: string }) => c.name)
          .toSorted(),
      ).toEqual(['Buraco', 'Poste apagado']);
    }
  });

  it('managers response never contains full cpf or email', async () => {
    const seed = await fx.seedPanelTenant();
    const managerId = await fx.newManager(seed.tenantId, [seed.worksId], 'Gestora Sigilo');
    const email = `gestora.${randomUUID()}@teste.dev`;
    await owner.db
      .update(schema.users)
      .set({ cpf: '12345678909', email })
      .where(eq(schema.users.id, managerId));
    const staffId = await fx.newStaff('support');
    const res = await get(staffId, seed.tenantId, 'managers');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      expect.objectContaining({
        name: 'Gestora Sigilo',
        cpfMasked: '•••.456.789-••',
        emailMasked: `${email.slice(0, 1)}•••@teste.dev`,
      }),
    ]);
    expect(res.body).not.toContain('12345678909');
    expect(res.body).not.toContain('123.456.789-09');
    expect(res.body).not.toContain(email);
    expect(res.body).not.toContain('"cpf"');
    expect(res.body).not.toContain('"email"');
  });

  it('does not leak other tenants', async () => {
    const seed = await fx.seedPanelTenant();
    const other = await fx.seedPanelTenant();
    await fx.addTeam(other.tenantId, { departmentId: other.worksId, name: 'Equipe Alheia' });
    await fx.newManager(other.tenantId, [other.worksId], 'Gestor Alheio');
    const staffId = await fx.newStaff('support');

    const teams = await get(staffId, seed.tenantId, 'teams');
    const managers = await get(staffId, seed.tenantId, 'managers');
    const categories = await get(staffId, seed.tenantId, 'categories');
    expect(teams.json().items).toEqual([]);
    expect(managers.json().items).toEqual([]);
    expect(categories.json().items).toHaveLength(2);
    expect(categories.json().items.map((c: { id: string }) => c.id)).not.toContain(other.potholeId);
  });

  it('returns 404 tenant_not_found for an unknown tenant', async () => {
    const staffId = await fx.newStaff('admin');
    const res = await get(staffId, randomUUID(), 'teams');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'tenant_not_found' });
  });

  it('request without a token gets 401', async () => {
    const seed = await fx.seedPanelTenant();
    const res = await app.inject({
      method: 'GET',
      url: `/backoffice/tenants/${seed.tenantId}/teams`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('a tenant admin (not staff) gets 403', async () => {
    const seed = await fx.seedPanelTenant();
    const adminId = await fx.newAdmin(seed.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: `/backoffice/tenants/${seed.tenantId}/managers`,
      headers: await panelAuthHeader(appDb.db, adminId, seed.tenantId),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_platform_staff' });
  });
});
