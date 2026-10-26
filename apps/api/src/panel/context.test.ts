import { randomInt } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import type { PanelContext, PanelCounts, TENANT_ROLES, TenantStatus } from '@alocidadao/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  users,
  tenants,
  memberships,
  departments,
  departmentManagers,
  categories,
  teams,
  occurrences,
  workOrders,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let app: Awaited<ReturnType<typeof buildApp>>;

const newPhone = () => `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function createUser(name: string) {
  const [user] = await owner.db.insert(users).values({ name, phone: newPhone() }).returning();
  return user!.id;
}

async function createTenant(status: TenantStatus = 'active') {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município Contexto',
      displayName: 'Prefeitura Contexto',
      city: 'Contexto',
      state: 'PR',
      ibgeCode: String(randomInt(1_000_000, 9_999_999)),
      status,
    })
    .returning();
  return tenant!.id;
}

async function link(tenantId: string, userId: string, role: (typeof TENANT_ROLES)[number]) {
  await owner.db.insert(memberships).values({ tenantId, userId, role, status: 'active' });
}

/** Gestor novo com vínculo ativo na prefeitura. */
async function newManager(tenantId: string, name = 'Gestor do Painel') {
  const userId = await createUser(name);
  await link(tenantId, userId, 'manager');
  return userId;
}

function get(url: '/panel/context' | '/panel/counts', headers: Record<string, string>) {
  return app.inject({ method: 'GET', url, headers });
}

/**
 * Prefeitura com limite, dois setores (Obras e Iluminação), uma categoria e uma equipe em
 * cada, e ocorrências e atividades nos dois.
 */
async function seedTenant() {
  const tenantId = await createTenant();
  await owner.db.execute(sql`
    update tenants
    set boundary = ST_Multi(ST_MakeEnvelope(-47.1, -23.1, -46.9, -22.9, 4326))
    where id = ${tenantId}
  `);
  return withContext(owner.db, { tenantId }, async (tx) => {
    const [works, lights] = await tx
      .insert(departments)
      .values([
        { tenantId, name: 'Obras' },
        { tenantId, name: 'Iluminação' },
      ])
      .returning();
    const [pothole, lamp] = await tx
      .insert(categories)
      .values([
        { tenantId, departmentId: works!.id, name: 'Buraco' },
        { tenantId, departmentId: lights!.id, name: 'Poste apagado' },
      ])
      .returning();
    const [worksTeam, lightsTeam] = await tx
      .insert(teams)
      .values([
        { tenantId, departmentId: works!.id, name: 'Equipe Obras' },
        { tenantId, departmentId: lights!.id, name: 'Equipe Luz' },
      ])
      .returning();

    const location = geoPoint({ lat: -23, lng: -47 });
    const occurrence = async (
      categoryId: string,
      status: (typeof occurrences.$inferInsert)['status'],
    ) => {
      const [row] = await tx
        .insert(occurrences)
        .values({ tenantId, categoryId, location, status })
        .returning();
      return row!.id;
    };
    const workOrder = async (
      categoryId: string,
      teamId: string,
      status: (typeof workOrders.$inferInsert)['status'],
    ) => {
      const occurrenceId = await occurrence(categoryId, 'in_progress');
      await tx.insert(workOrders).values({ tenantId, occurrenceId, teamId, status });
    };

    // Obras: 2 em triagem, 1 aguardando revisão, 2 impedidas.
    await occurrence(pothole!.id, 'triage');
    await occurrence(pothole!.id, 'triage');
    await occurrence(pothole!.id, 'rejected');
    await workOrder(pothole!.id, worksTeam!.id, 'awaiting_review');
    await workOrder(pothole!.id, worksTeam!.id, 'impeded');
    await workOrder(pothole!.id, worksTeam!.id, 'impeded');
    await workOrder(pothole!.id, worksTeam!.id, 'assigned');
    // Iluminação: 3 em triagem, 2 aguardando revisão, 1 impedida.
    await occurrence(lamp!.id, 'triage');
    await occurrence(lamp!.id, 'triage');
    await occurrence(lamp!.id, 'triage');
    await workOrder(lamp!.id, lightsTeam!.id, 'awaiting_review');
    await workOrder(lamp!.id, lightsTeam!.id, 'awaiting_review');
    await workOrder(lamp!.id, lightsTeam!.id, 'impeded');

    return { tenantId, worksId: works!.id, lightsId: lights!.id };
  });
}

let seeded: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
  seeded = await seedTenant();
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

describe('panel member', () => {
  it('suspended tenant blocks panel routes', async () => {
    const tenantId = await createTenant();
    const userId = await newManager(tenantId);
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);
    expect((await get('/panel/context', headers)).statusCode).toBe(200);

    await owner.db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId));
    for (const url of ['/panel/context', '/panel/counts'] as const) {
      const res = await get(url, headers);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'not_a_member' });
    }
  });

  it('onboarding tenant is allowed in the panel', async () => {
    const tenantId = await createTenant('onboarding');
    const userId = await newManager(tenantId);
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);
    const context = await get('/panel/context', headers);
    expect(context.statusCode).toBe(200);
    expect(context.json<PanelContext>().tenant).toEqual({
      id: tenantId,
      displayName: 'Prefeitura Contexto',
      status: 'onboarding',
      bounds: null,
    });
    const counts = await get('/panel/counts', headers);
    expect(counts.statusCode).toBe(200);
    expect(counts.json()).toEqual({ triage: 0, awaitingReview: 0, impeded: 0 });
  });

  it('field agent is 403 not_a_member on panel routes', async () => {
    const userId = await createUser('Agente no Painel');
    await link(seeded.tenantId, userId, 'field_agent');
    const headers = await panelAuthHeader(appDb.db, userId, seeded.tenantId);
    for (const url of ['/panel/context', '/panel/counts'] as const) {
      const res = await get(url, headers);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'not_a_member' });
    }
  });

  it('app token and missing tenant header are refused', async () => {
    const userId = await newManager(seeded.tenantId);
    const appToken = await appAuthHeader(appDb.db, userId);
    const withApp = await get('/panel/context', { ...appToken, 'x-tenant-id': seeded.tenantId });
    expect(withApp.statusCode).toBe(401);
    expect(withApp.json()).toEqual({ code: 'unauthorized' });

    const noTenant = await get('/panel/context', await panelAuthHeader(appDb.db, userId));
    expect(noTenant.statusCode).toBe(400);
    expect(noTenant.json()).toEqual({ code: 'tenant_required' });
  });

  it('deactivated membership is 403 on the next call', async () => {
    const userId = await newManager(seeded.tenantId);
    const headers = await panelAuthHeader(appDb.db, userId, seeded.tenantId);
    expect((await get('/panel/counts', headers)).statusCode).toBe(200);

    await owner.db
      .update(memberships)
      .set({ status: 'inactive' })
      .where(and(eq(memberships.tenantId, seeded.tenantId), eq(memberships.userId, userId)));
    const res = await get('/panel/counts', headers);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_a_member' });
  });
});

describe('panel context and counts', () => {
  it('context lists the manager departments and all departments for the admin', async () => {
    const { tenantId, worksId, lightsId } = seeded;
    const managerId = await newManager(tenantId, 'Gestora de Obras');
    await withContext(owner.db, { tenantId }, (tx) =>
      tx.insert(departmentManagers).values({ tenantId, departmentId: worksId, userId: managerId }),
    );
    const res = await get('/panel/context', await panelAuthHeader(appDb.db, managerId, tenantId));
    expect(res.statusCode).toBe(200);
    const context = res.json<PanelContext>();
    expect(context).toMatchObject({
      tenant: { id: tenantId, displayName: 'Prefeitura Contexto', status: 'active' },
      user: { id: managerId, name: 'Gestora de Obras' },
      role: 'manager',
      departments: [{ id: worksId, name: 'Obras' }],
    });
    const [west, south, east, north] = context.tenant.bounds!;
    expect(west).toBeCloseTo(-47.1, 4);
    expect(south).toBeCloseTo(-23.1, 4);
    expect(east).toBeCloseTo(-46.9, 4);
    expect(north).toBeCloseTo(-22.9, 4);

    // Quem tem os dois papéis conta como admin e vê todos os setores, por nome.
    const adminId = await newManager(tenantId, 'Admin da Prefeitura');
    await link(tenantId, adminId, 'tenant_admin');
    const admin = await get('/panel/context', await panelAuthHeader(appDb.db, adminId, tenantId));
    expect(admin.statusCode).toBe(200);
    expect(admin.json<PanelContext>()).toMatchObject({
      role: 'tenant_admin',
      departments: [
        { id: lightsId, name: 'Iluminação' },
        { id: worksId, name: 'Obras' },
      ],
    });

    // Gestor sem setor: nenhum setor.
    const loneId = await newManager(tenantId, 'Gestor sem Setor');
    const lone = await get('/panel/context', await panelAuthHeader(appDb.db, loneId, tenantId));
    expect(lone.json<PanelContext>()).toMatchObject({ role: 'manager', departments: [] });
  });

  it('counts only include the manager departments', async () => {
    const { tenantId, worksId } = seeded;
    const managerId = await newManager(tenantId, 'Gestor de Obras');
    await withContext(owner.db, { tenantId }, (tx) =>
      tx.insert(departmentManagers).values({ tenantId, departmentId: worksId, userId: managerId }),
    );
    const manager = await get(
      '/panel/counts',
      await panelAuthHeader(appDb.db, managerId, tenantId),
    );
    expect(manager.statusCode).toBe(200);
    expect(manager.json<PanelCounts>()).toEqual({ triage: 2, awaitingReview: 1, impeded: 2 });

    const adminId = await createUser('Admin Contador');
    await link(tenantId, adminId, 'tenant_admin');
    const admin = await get('/panel/counts', await panelAuthHeader(appDb.db, adminId, tenantId));
    expect(admin.json<PanelCounts>()).toEqual({ triage: 5, awaitingReview: 3, impeded: 3 });

    const loneId = await newManager(tenantId, 'Gestor Vazio');
    const lone = await get('/panel/counts', await panelAuthHeader(appDb.db, loneId, tenantId));
    expect(lone.json<PanelCounts>()).toEqual({ triage: 0, awaitingReview: 0, impeded: 0 });
  });
});
