import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import {
  backofficeContextSchema,
  managerRowSchema,
  occurrenceMapResponseSchema,
  panelContextSchema,
} from '@alocidadao/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { staffAuditEvents, users } = schema;

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

/** CPF válido e aleatório (dígitos verificadores calculados). */
function newCpf(): string {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  const check = (length: number) => {
    const sum = digits.slice(0, length).reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(check(9));
  digits.push(check(10));
  const cpf = digits.join('');
  return /^(.)\1{10}$/.test(cpf) ? newCpf() : cpf;
}

async function backoffice(method: 'GET' | 'POST', url: string, userId: string) {
  return app.inject({ method, url, headers: await staffAuthHeader(appDb.db, userId) });
}

const auditOf = (tenantId: string) =>
  withContext(owner.db, { tenantId }, (tx) =>
    tx
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.tenantId, tenantId))
      .orderBy(asc(staffAuditEvents.createdAt)),
  );

describe('equipe interna no backoffice', () => {
  it('app audience token never gets platform staff', async () => {
    const staffId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant('active');
    const appHeaders = await appAuthHeader(appDb.db, staffId);

    const context = await app.inject({
      method: 'GET',
      url: '/backoffice/context',
      headers: appHeaders,
    });
    expect(context.statusCode).toBe(403);
    expect(context.json()).toEqual({ code: 'not_platform_staff' });

    const enter = await app.inject({
      method: 'POST',
      url: `/backoffice/tenants/${tenantId}/support/enter`,
      headers: appHeaders,
    });
    expect(enter.statusCode).toBe(403);
    expect(enter.json()).toEqual({ code: 'not_platform_staff' });

    // O painel nem aceita o token do app.
    const panel = await app.inject({
      method: 'GET',
      url: '/panel/context',
      headers: { ...appHeaders, 'x-tenant-id': tenantId },
    });
    expect(panel.statusCode).toBe(401);
    expect(await auditOf(tenantId)).toEqual([]);
  });

  it('returns the backoffice context for admin and support, and 403 for everyone else', async () => {
    const adminId = await fx.newStaff('admin', 'Ana Admin');
    const supportId = await fx.newStaff('support', 'Sérgio Suporte');
    const tenantId = await fx.createTenant('active');
    const tenantAdminId = await fx.newAdmin(tenantId);

    const asAdmin = await backoffice('GET', '/backoffice/context', adminId);
    expect(asAdmin.statusCode).toBe(200);
    expect(backofficeContextSchema.parse(asAdmin.json())).toEqual({
      user: { id: adminId, name: 'Ana Admin' },
      platformRole: 'admin',
    });

    const asSupport = await backoffice('GET', '/backoffice/context', supportId);
    expect(asSupport.json()).toEqual({
      user: { id: supportId, name: 'Sérgio Suporte' },
      platformRole: 'support',
    });

    const asTenantAdmin = await backoffice('GET', '/backoffice/context', tenantAdminId);
    expect(asTenantAdmin.statusCode).toBe(403);
    expect(asTenantAdmin.json()).toEqual({ code: 'not_platform_staff' });

    const anonymous = await app.inject({ method: 'GET', url: '/backoffice/context' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('removed platform role is 403 on the next call', async () => {
    const supportId = await fx.newStaff('support');
    const tenantId = await fx.createTenant('active');
    const backofficeHeaders = await staffAuthHeader(appDb.db, supportId);
    const panelHeaders = await panelAuthHeader(appDb.db, supportId, tenantId);

    const before = await app.inject({
      method: 'GET',
      url: '/backoffice/context',
      headers: backofficeHeaders,
    });
    expect(before.statusCode).toBe(200);
    const panelBefore = await app.inject({
      method: 'GET',
      url: '/panel/context',
      headers: panelHeaders,
    });
    expect(panelBefore.statusCode).toBe(200);

    await owner.db.update(users).set({ platformRole: null }).where(eq(users.id, supportId));

    const after = await app.inject({
      method: 'GET',
      url: '/backoffice/context',
      headers: backofficeHeaders,
    });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toEqual({ code: 'not_platform_staff' });
    const panelAfter = await app.inject({
      method: 'GET',
      url: '/panel/context',
      headers: panelHeaders,
    });
    expect(panelAfter.statusCode).toBe(403);
    expect(panelAfter.json()).toEqual({ code: 'not_a_member' });
  });

  it('frozen staff account is 403', async () => {
    const adminId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant('active');
    const backofficeHeaders = await staffAuthHeader(appDb.db, adminId);
    const panelHeaders = await panelAuthHeader(appDb.db, adminId, tenantId);
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, adminId));

    const context = await app.inject({
      method: 'GET',
      url: '/backoffice/context',
      headers: backofficeHeaders,
    });
    expect(context.statusCode).toBe(403);
    expect(context.json()).toEqual({ code: 'not_platform_staff' });

    const enter = await app.inject({
      method: 'POST',
      url: `/backoffice/tenants/${tenantId}/support/enter`,
      headers: backofficeHeaders,
    });
    expect(enter.statusCode).toBe(403);
    expect(enter.json()).toEqual({ code: 'not_platform_staff' });

    const panel = await app.inject({ method: 'GET', url: '/panel/context', headers: panelHeaders });
    expect(panel.statusCode).toBe(403);
    expect(panel.json()).toEqual({ code: 'not_a_member' });
    expect(await auditOf(tenantId)).toEqual([]);
  });
});

describe('modo suporte', () => {
  it('support enters an onboarding tenant and sees the map', async () => {
    const supportId = await fx.newStaff('support', 'Sérgio Suporte');
    const seed = await fx.seedPanelTenant();
    await owner.db
      .update(schema.tenants)
      .set({ status: 'onboarding' })
      .where(eq(schema.tenants.id, seed.tenantId));

    const enter = await backoffice(
      'POST',
      `/backoffice/tenants/${seed.tenantId}/support/enter`,
      supportId,
    );
    expect(enter.statusCode).toBe(204);

    const headers = await panelAuthHeader(appDb.db, supportId, seed.tenantId);
    const map = await app.inject({ method: 'GET', url: '/panel/occurrences', headers });
    expect(map.statusCode).toBe(200);
    occurrenceMapResponseSchema.parse(map.json());

    const context = await app.inject({ method: 'GET', url: '/panel/context', headers });
    expect(context.statusCode).toBe(200);
    const body = panelContextSchema.parse(context.json());
    expect(body.tenant).toMatchObject({ id: seed.tenantId, status: 'onboarding' });
    expect(body.user).toEqual({ id: supportId, name: 'Sérgio Suporte' });
    expect(body.role).toBe('tenant_admin');
    expect(body.departments.map((d) => d.id).toSorted()).toEqual(
      [seed.worksId, seed.lightsId].toSorted(),
    );
  });

  it('support gets 403 not_a_member on a suspended tenant panel', async () => {
    const supportId = await fx.newStaff('support');
    const tenantId = await fx.createTenant('suspended');

    const enter = await backoffice(
      'POST',
      `/backoffice/tenants/${tenantId}/support/enter`,
      supportId,
    );
    expect(enter.statusCode).toBe(409);
    expect(enter.json()).toEqual({ code: 'tenant_suspended' });

    const panel = await app.inject({
      method: 'GET',
      url: '/panel/occurrences',
      headers: await panelAuthHeader(appDb.db, supportId, tenantId),
    });
    expect(panel.statusCode).toBe(403);
    expect(panel.json()).toEqual({ code: 'not_a_member' });
    expect(await auditOf(tenantId)).toEqual([]);
  });

  it('enter answers 404 tenant_not_found for an unknown tenant', async () => {
    const adminId = await fx.newStaff('admin');
    const response = await backoffice(
      'POST',
      `/backoffice/tenants/${randomUUID()}/support/enter`,
      adminId,
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'tenant_not_found' });
  });

  it('support can register a manager in support mode', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await fx.seedPanelTenant();
    const cpf = newCpf();

    const response = await app.inject({
      method: 'POST',
      url: '/panel/managers',
      headers: await panelAuthHeader(appDb.db, supportId, seed.tenantId),
      payload: {
        name: 'Gestora Nova',
        cpf,
        email: `gestora.${randomUUID()}@teste.dev`,
        departmentIds: [seed.worksId],
      },
    });

    expect(response.statusCode).toBe(201);
    const row = managerRowSchema.parse(response.json());
    expect(row.name).toBe('Gestora Nova');
    await vi.waitFor(async () => {
      const events = await auditOf(seed.tenantId);
      expect(events.map((e) => e.action)).toEqual(['manager.create']);
    });
  });

  it('enter and leave write support.enter and support.leave', async () => {
    const adminId = await fx.newStaff('admin');
    const tenantId = await fx.createTenant('active');

    const enter = await backoffice(
      'POST',
      `/backoffice/tenants/${tenantId}/support/enter`,
      adminId,
    );
    expect(enter.statusCode).toBe(204);
    const leave = await backoffice(
      'POST',
      `/backoffice/tenants/${tenantId}/support/leave`,
      adminId,
    );
    expect(leave.statusCode).toBe(204);

    const events = await auditOf(tenantId);
    expect(
      events.map(({ action, staffUserId, targetType, targetId }) => ({
        action,
        staffUserId,
        targetType,
        targetId,
      })),
    ).toEqual([
      { action: 'support.enter', staffUserId: adminId, targetType: 'tenant', targetId: tenantId },
      { action: 'support.leave', staffUserId: adminId, targetType: 'tenant', targetId: tenantId },
    ]);
  });

  it('entering another tenant writes an implicit leave for the previous one', async () => {
    const supportId = await fx.newStaff('support');
    const first = await fx.createTenant('active');
    const second = await fx.createTenant('active');
    const enter = (tenantId: string) =>
      backoffice('POST', `/backoffice/tenants/${tenantId}/support/enter`, supportId);

    expect((await enter(first)).statusCode).toBe(204);
    // Sem sair da primeira, entra na segunda: a primeira ganha uma saída implícita antes.
    expect((await enter(second)).statusCode).toBe(204);
    const pick = (events: Awaited<ReturnType<typeof auditOf>>) =>
      events.map(({ action, staffUserId, targetId, details }) => ({
        action,
        staffUserId,
        targetId,
        details,
      }));
    expect(pick(await auditOf(first))).toEqual([
      { action: 'support.enter', staffUserId: supportId, targetId: first, details: null },
      {
        action: 'support.leave',
        staffUserId: supportId,
        targetId: first,
        details: { reason: 'implicit' },
      },
    ]);
    expect(pick(await auditOf(second))).toEqual([
      { action: 'support.enter', staffUserId: supportId, targetId: second, details: null },
    ]);

    // Com saída explícita, a entrada seguinte não grava outra saída.
    const leave = await backoffice(
      'POST',
      `/backoffice/tenants/${second}/support/leave`,
      supportId,
    );
    expect(leave.statusCode).toBe(204);
    expect((await enter(first)).statusCode).toBe(204);
    expect((await auditOf(second)).map((e) => e.action)).toEqual([
      'support.enter',
      'support.leave',
    ]);
    expect((await auditOf(first)).map((e) => e.action)).toEqual([
      'support.enter',
      'support.leave',
      'support.enter',
    ]);
  });
});
