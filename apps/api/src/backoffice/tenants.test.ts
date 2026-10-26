import { randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { tenantDetailSchema, tenantListResponseSchema } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { staffAuditEvents, tenantContracts, tenants, categories, departments } = schema;

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
  method: 'GET' | 'POST',
  url: string,
  userId: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: await staffAuthHeader(appDb.db, userId), payload });
}

const setStatus = (tenantId: string, userId: string, action: string) =>
  backoffice('POST', `/backoffice/tenants/${tenantId}/status`, userId, { action });

const auditOf = (tenantId: string) =>
  withContext(owner.db, { tenantId }, (tx) =>
    tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, tenantId)),
  );

async function setName(tenantId: string, displayName: string) {
  await owner.db.update(tenants).set({ displayName }).where(eq(tenants.id, tenantId));
}

/** Prefeitura em implantação com uma categoria ativa (e, com `withTeam`, um setor com equipe). */
async function readyTenant(status: 'onboarding' | 'active', withTeam = true) {
  const tenantId = await fx.createTenant(status);
  const deptId = await withContext(owner.db, { tenantId }, async (tx) => {
    const [dept] = await tx.insert(departments).values({ tenantId, name: 'Obras' }).returning();
    await tx.insert(categories).values({
      tenantId,
      departmentId: dept!.id,
      name: 'Buraco',
      icon: 'construction',
      iconGroup: 'infrastructure',
      clusterRadiusM: 50,
    });
    return dept!.id;
  });
  if (withTeam) await fx.addTeam(tenantId, { departmentId: deptId, name: 'Equipe 1' });
  return tenantId;
}

describe('prefeituras do backoffice', () => {
  it('tenant list orders active, onboarding and suspended and picks the first alert', async () => {
    const staffId = await fx.newStaff('support');
    const suspendedId = await fx.createTenant('suspended');
    const onboardingId = await fx.createTenant('onboarding');
    const activeBId = await fx.createTenant('active');
    const impededId = await fx.seedPanelTenant();
    const lateId = await fx.seedPanelTenant();
    await setName(suspendedId, 'Aaa Suspensa');
    await setName(onboardingId, 'Aaa Implantação');
    await setName(activeBId, 'Zzz Ativa');
    await setName(impededId.tenantId, 'Mmm Impedida');
    await setName(lateId.tenantId, 'Bbb Atrasada');

    const team1 = await fx.addTeam(lateId.tenantId, { departmentId: lateId.worksId, name: 'E1' });
    await fx.seedReview(lateId, { teamId: team1, at: { lat: -25, lng: -49 }, hoursAgo: 30 });
    // Revisão e impedimento: vale o primeiro alerta, a revisão.
    await fx.seedImpediment(lateId, { teamId: team1, at: { lat: -25.1, lng: -49 }, hoursAgo: 40 });
    const team2 = await fx.addTeam(impededId.tenantId, {
      departmentId: impededId.worksId,
      name: 'E2',
    });
    await fx.seedImpediment(impededId, { teamId: team2, at: { lat: -25, lng: -49 }, hoursAgo: 30 });
    await owner.db.insert(tenantContracts).values([
      {
        tenantId: lateId.tenantId,
        plan: 'essential',
        startsOn: '2025-01-01',
        includedPanelUsers: 5,
      },
      {
        tenantId: lateId.tenantId,
        plan: 'complete',
        startsOn: '2026-01-01',
        includedPanelUsers: 9,
      },
    ]);

    const response = await backoffice('GET', '/backoffice/tenants', staffId);
    expect(response.statusCode).toBe(200);
    const body = tenantListResponseSchema.parse(response.json());
    const ids = [lateId.tenantId, impededId.tenantId, activeBId, onboardingId, suspendedId];
    const rows = body.items.filter((item) => ids.includes(item.id));
    expect(rows.map((r) => r.id)).toEqual([
      lateId.tenantId,
      impededId.tenantId,
      activeBId,
      onboardingId,
      suspendedId,
    ]);
    const late = rows[0]!;
    expect(late).toMatchObject({
      displayName: 'Bbb Atrasada',
      status: 'active',
      plan: 'complete',
      lateReviewCount: 1,
      staleImpedimentCount: 1,
      activeCategoryCount: 2,
    });
    expect(rows[1]).toMatchObject({ plan: null, lateReviewCount: 0, staleImpedimentCount: 1 });
    expect(body.overview.activeTenants).toBeGreaterThanOrEqual(3);
  });

  it('tenant detail brings stats, contract and the 5 latest staff actions', async () => {
    const adminId = await fx.newStaff('admin', 'Ana Admin');
    const supportId = await fx.newStaff('support', 'Sérgio Suporte');
    const tenantId = await readyTenant('active');
    await fx.newManager(tenantId, [], 'Gestor');
    await owner.db.insert(tenantContracts).values({
      tenantId,
      plan: 'essential',
      startsOn: '2026-02-01',
      endsOn: '2027-02-01',
      includedPanelUsers: 7,
    });
    await withContext(owner.db, { tenantId }, async (tx) => {
      for (let i = 0; i < 6; i += 1) {
        await tx.insert(staffAuditEvents).values({
          tenantId,
          staffUserId: i === 5 ? supportId : adminId,
          action: i === 5 ? 'support.leave' : 'support.enter',
          createdAt: new Date(Date.now() - (10 - i) * 60_000),
        });
      }
    });

    const response = await backoffice('GET', `/backoffice/tenants/${tenantId}`, supportId);
    expect(response.statusCode).toBe(200);
    const body = tenantDetailSchema.parse(response.json());
    expect(body).toMatchObject({
      id: tenantId,
      status: 'active',
      contract: {
        plan: 'essential',
        includedPanelUsers: 7,
        startsOn: '2026-02-01',
        endsOn: '2027-02-01',
      },
      stats: { teamCount: 1, activeCategoryCount: 1, managerCount: 1, panelUserCount: 1 },
    });
    expect(body.recentStaffActions).toHaveLength(5);
    expect(body.recentStaffActions[0]).toMatchObject({
      action: 'support.leave',
      staffName: 'Sérgio Suporte',
    });
    expect(body.recentStaffActions[1]).toMatchObject({ staffName: 'Ana Admin' });

    const missing = await backoffice('GET', `/backoffice/tenants/${randomUUID()}`, supportId);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'tenant_not_found' });
  });

  it('support gets 403 admin_only on tenant writes', async () => {
    const supportId = await fx.newStaff('support');
    const tenantId = await readyTenant('onboarding');
    const response = await setStatus(tenantId, supportId, 'activate');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'admin_only' });
    const [row] = await owner.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row!.status).toBe('onboarding');
    expect(await auditOf(tenantId)).toEqual([]);
  });

  it('activation needs an active category and a team', async () => {
    const adminId = await fx.newStaff('admin');
    const noCategory = await fx.createTenant('onboarding');
    const noTeam = await readyTenant('onboarding', false);
    const ready = await readyTenant('onboarding');

    for (const id of [noCategory, noTeam]) {
      const response = await setStatus(id, adminId, 'activate');
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: 'tenant_not_ready' });
      expect(await auditOf(id)).toEqual([]);
    }
    // Categoria inativa não conta.
    const [dept] = await withContext(owner.db, { tenantId: noTeam }, (tx) =>
      tx.select().from(departments).where(eq(departments.tenantId, noTeam)),
    );
    await fx.addTeam(noTeam, { departmentId: dept!.id, name: 'Equipe' });
    await withContext(owner.db, { tenantId: noTeam }, (tx) =>
      tx.update(categories).set({ active: false }).where(eq(categories.tenantId, noTeam)),
    );
    expect((await setStatus(noTeam, adminId, 'activate')).statusCode).toBe(422);

    const ok = await setStatus(ready, adminId, 'activate');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'active' });
    expect((await auditOf(ready)).map((e) => e.action)).toEqual(['tenant.activate']);

    const again = await setStatus(ready, adminId, 'activate');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'tenant_status_conflict' });

    const unknown = await setStatus(randomUUID(), adminId, 'activate');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ code: 'tenant_not_found' });
  });

  it('suspend then reactivate writes two audit events', async () => {
    const adminId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant('active');

    expect((await setStatus(tenantId, adminId, 'reactivate')).statusCode).toBe(409);
    const suspend = await setStatus(tenantId, adminId, 'suspend');
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json()).toEqual({ status: 'suspended' });
    expect((await setStatus(tenantId, adminId, 'suspend')).statusCode).toBe(409);
    const reactivate = await setStatus(tenantId, adminId, 'reactivate');
    expect(reactivate.json()).toEqual({ status: 'active' });

    const events = await auditOf(tenantId);
    expect(events.map((e) => [e.action, e.staffUserId, e.targetType, e.targetId])).toEqual(
      expect.arrayContaining([
        ['tenant.suspend', adminId, 'tenant', tenantId],
        ['tenant.reactivate', adminId, 'tenant', tenantId],
      ]),
    );
    expect(events).toHaveLength(2);
  });

  it('suspended tenant blocks support mode and panel', async () => {
    const adminId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant('active');
    const managerId = await fx.newAdmin(tenantId);
    await setStatus(tenantId, adminId, 'suspend');

    const enter = await backoffice(
      'POST',
      `/backoffice/tenants/${tenantId}/support/enter`,
      adminId,
    );
    expect(enter.statusCode).toBe(409);
    expect(enter.json()).toEqual({ code: 'tenant_suspended' });
    for (const userId of [adminId, managerId]) {
      const panel = await app.inject({
        method: 'GET',
        url: '/panel/occurrences',
        headers: await panelAuthHeader(appDb.db, userId, tenantId),
      });
      expect(panel.statusCode).toBe(403);
      expect(panel.json()).toEqual({ code: 'not_a_member' });
    }
  });

  it('suspended tenant disappears from citizen locate', async () => {
    const adminId = await fx.newStaff('admin');
    const citizenId = await fx.createUser('Cidadã');
    const center = { lat: -33.5, lng: -53.5 };
    const [tenant] = await owner.db
      .insert(tenants)
      .values({
        name: 'Município Locate',
        displayName: 'Prefeitura Locate',
        city: 'Locate',
        state: 'RS',
        ibgeCode: '9999971',
        status: 'active',
        boundary: sql`ST_Multi(ST_MakeEnvelope(${center.lng - 0.01}, ${center.lat - 0.01}, ${center.lng + 0.01}, ${center.lat + 0.01}, 4326))`,
      })
      .returning();
    const url = `/citizen/locate?lat=${center.lat}&lng=${center.lng}`;
    const headers = await appAuthHeader(appDb.db, citizenId);

    const before = await app.inject({ method: 'GET', url, headers });
    expect(before.json()).toMatchObject({ status: 'served' });
    expect((await setStatus(tenant!.id, adminId, 'suspend')).statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url, headers });
    expect(after.json()).toMatchObject({ status: 'not_served' });
    await setStatus(tenant!.id, adminId, 'reactivate');
    const back = await app.inject({ method: 'GET', url, headers });
    expect(back.json()).toMatchObject({ status: 'served' });
  });
});
