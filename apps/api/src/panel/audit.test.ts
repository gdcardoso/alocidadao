import { randomInt } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { STAFF_AUDIT_ACTIONS, type GeoPoint } from '@alocidadao/shared';
import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { PANEL_AUDIT_ACTIONS, PANEL_UNAUDITED_ROUTES } from './audit.js';
import { addDays, todayInSaoPaulo } from './occurrences.js';
import { registerPanelRoutes } from './routes.js';

const { staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const CENTER: GeoPoint = { lat: -23.2, lng: -47.2 };

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

const auditOf = (tenantId: string) =>
  withContext(owner.db, { tenantId }, (tx) =>
    tx
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.tenantId, tenantId))
      .orderBy(asc(staffAuditEvents.createdAt)),
  );

/** Ocorrência em triagem com um relato, numa prefeitura com uma equipe de Obras. */
async function seedAssignable() {
  const seed = await fx.seedPanelTenant();
  const teamId = await fx.addTeam(seed.tenantId, { departmentId: seed.worksId, name: 'Equipe A' });
  const occurrenceId = await fx.addOccurrence(seed.tenantId, {
    categoryId: seed.potholeId,
    at: CENTER,
  });
  await fx.addRequest(seed.tenantId, {
    occurrenceId,
    categoryId: seed.potholeId,
    citizenId: seed.citizenId,
    at: CENTER,
    description: 'Relato do cidadão',
  });
  return { ...seed, teamId, occurrenceId };
}

async function assign(userId: string, tenantId: string, occurrenceId: string, teamId: string) {
  return app.inject({
    method: 'POST',
    url: `/panel/occurrences/${occurrenceId}/assign`,
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
    payload: { teamId, dueDate: addDays(todayInSaoPaulo(), 3), instructions: 'Levar asfalto.' },
  });
}

describe('auditoria do modo suporte', () => {
  it('every non-GET panel route has an audit action', async () => {
    const routes: string[] = [];
    const probe = Fastify().withTypeProvider<ZodTypeProvider>();
    probe.setValidatorCompiler(validatorCompiler);
    probe.setSerializerCompiler(serializerCompiler);
    probe.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        const key = `${method} ${route.url}`;
        if (method !== 'GET' && method !== 'HEAD' && !PANEL_UNAUDITED_ROUTES.includes(key)) {
          routes.push(key);
        }
      }
    });
    registerPanelRoutes(probe, {
      db: appDb.db,
      email: testAuthOptions.email,
      invites: { panelUrl: 'http://painel.teste', playStoreUrl: null, appStoreUrl: null },
    });
    await probe.ready();
    await probe.close();

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => / \/panel\//.test(route))).toBe(true);
    // Toda rota que altera dados tem ação, e o mapa não tem rota que não existe.
    expect(routes.filter((route) => !(route in PANEL_AUDIT_ACTIONS))).toEqual([]);
    expect(Object.keys(PANEL_AUDIT_ACTIONS).toSorted()).toEqual(routes.toSorted());
    for (const action of Object.values(PANEL_AUDIT_ACTIONS)) {
      expect(STAFF_AUDIT_ACTIONS).toContain(action);
    }
    expect(PANEL_AUDIT_ACTIONS['POST /panel/occurrences/:id/assign']).toBe('occurrence.assign');
  });

  it('support assign writes one audit event without the body', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await seedAssignable();

    const response = await assign(supportId, seed.tenantId, seed.occurrenceId, seed.teamId);
    expect(response.statusCode).toBe(200);

    await vi.waitFor(async () => {
      expect(await auditOf(seed.tenantId)).toHaveLength(1);
    });
    const [event] = await auditOf(seed.tenantId);
    expect(event).toMatchObject({
      tenantId: seed.tenantId,
      staffUserId: supportId,
      action: 'occurrence.assign',
      targetType: 'occurrence',
      targetId: seed.occurrenceId,
      details: { route: 'POST /panel/occurrences/:id/assign' },
    });
    expect(JSON.stringify(event!.details)).not.toContain('asfalto');

    // Ler não grava nada; recusa (4xx) também não.
    const headers = await panelAuthHeader(appDb.db, supportId, seed.tenantId);
    await app.inject({ method: 'GET', url: '/panel/occurrences', headers });
    const again = await assign(supportId, seed.tenantId, seed.occurrenceId, seed.teamId);
    expect(again.statusCode).toBe(409);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await auditOf(seed.tenantId)).toHaveLength(1);
  });

  it('manager actions write no staff audit', async () => {
    const seed = await seedAssignable();
    const managerId = await fx.newManager(seed.tenantId, [seed.worksId]);
    const adminId = await fx.newAdmin(seed.tenantId);

    const response = await assign(managerId, seed.tenantId, seed.occurrenceId, seed.teamId);
    expect(response.statusCode).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: '/panel/departments',
      headers: await panelAuthHeader(appDb.db, adminId, seed.tenantId),
      payload: { name: 'Trânsito' },
    });
    expect(created.statusCode).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await auditOf(seed.tenantId)).toEqual([]);
  });

  it('records the user target of agent and manager routes', async () => {
    const adminId = await fx.newStaff('admin');
    const seed = await fx.seedPanelTenant();
    const managerId = await fx.newManager(seed.tenantId, [seed.worksId]);

    const response = await app.inject({
      method: 'PATCH',
      url: `/panel/managers/${managerId}`,
      headers: await panelAuthHeader(appDb.db, adminId, seed.tenantId),
      payload: { action: 'deactivate' },
    });
    expect(response.statusCode).toBe(200);

    await vi.waitFor(async () => {
      expect(await auditOf(seed.tenantId)).toHaveLength(1);
    });
    const [event] = await auditOf(seed.tenantId);
    expect(event).toMatchObject({
      action: 'manager.update',
      targetType: 'manager',
      targetId: managerId,
      details: { route: 'PATCH /panel/managers/:userId' },
    });
  });

  it('support email change of a manager has its own audit action', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await fx.seedPanelTenant();
    const managerId = await fx.newManager(seed.tenantId, [seed.worksId]);
    const headers = await panelAuthHeader(appDb.db, supportId, seed.tenantId);
    const patch = (email: string) =>
      app.inject({
        method: 'PATCH',
        url: `/panel/managers/${managerId}`,
        headers,
        payload: { action: 'update', email, departmentIds: [seed.worksId] },
      });

    const email = `gestor.${randomInt(0, 1_000_000_000)}@teste.dev`;
    expect((await patch(email)).statusCode).toBe(200);
    // O mesmo e-mail de novo só mexe nos setores: ação genérica.
    expect((await patch(email)).statusCode).toBe(200);

    await vi.waitFor(async () => {
      expect(await auditOf(seed.tenantId)).toHaveLength(2);
    });
    // A gravação é depois da resposta: a ordem entre as duas não é garantida.
    const events = (await auditOf(seed.tenantId)).toSorted((a, b) =>
      a.action.localeCompare(b.action),
    );
    expect(events.map((e) => [e.action, e.targetType, e.targetId, e.details])).toEqual([
      ['manager.email_change', 'manager', managerId, { route: 'PATCH /panel/managers/:userId' }],
      ['manager.update', 'manager', managerId, { route: 'PATCH /panel/managers/:userId' }],
    ]);
  });

  it('support phone change of an agent has its own audit action', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await fx.seedPanelTenant();
    const teamId = await fx.addTeam(seed.tenantId, {
      departmentId: seed.worksId,
      name: 'Equipe C',
    });
    const agentId = await fx.addAgent(seed.tenantId, teamId, 'active');
    const headers = await panelAuthHeader(appDb.db, supportId, seed.tenantId);

    const changed = await app.inject({
      method: 'PATCH',
      url: `/panel/agents/${agentId}`,
      headers,
      payload: {
        action: 'change_phone',
        phone: `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
      },
    });
    expect(changed.statusCode).toBe(200);
    const deactivated = await app.inject({
      method: 'PATCH',
      url: `/panel/agents/${agentId}`,
      headers,
      payload: { action: 'deactivate' },
    });
    expect(deactivated.statusCode).toBe(200);

    await vi.waitFor(async () => {
      expect(await auditOf(seed.tenantId)).toHaveLength(2);
    });
    const events = (await auditOf(seed.tenantId)).toSorted((a, b) =>
      a.action.localeCompare(b.action),
    );
    expect(events.map((e) => [e.action, e.targetType, e.targetId])).toEqual([
      ['agent.phone_change', 'agent', agentId],
      ['agent.update', 'agent', agentId],
    ]);
  });

  it('adding an agent audits the agent as target', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await fx.seedPanelTenant();
    const teamId = await fx.addTeam(seed.tenantId, {
      departmentId: seed.worksId,
      name: 'Equipe B',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/panel/teams/${teamId}/agents`,
      headers: await panelAuthHeader(appDb.db, supportId, seed.tenantId),
      payload: {
        name: 'Agente Novo',
        phone: `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
        email: `agente.${randomInt(0, 1e9)}@teste.dev`,
      },
    });
    expect(response.statusCode).toBe(201);
    const agent = response.json<{ userId: string }>();

    await vi.waitFor(async () => {
      expect(await auditOf(seed.tenantId)).toHaveLength(1);
    });
    const [event] = await auditOf(seed.tenantId);
    expect(event).toMatchObject({
      action: 'agent.create',
      targetType: 'agent',
      targetId: agent.userId,
      details: { route: 'POST /panel/teams/:id/agents' },
    });
  });
});
