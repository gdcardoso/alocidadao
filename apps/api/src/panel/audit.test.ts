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
import { PANEL_AUDIT_ACTIONS } from './audit.js';
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
        if (method !== 'GET' && method !== 'HEAD') routes.push(`${method} ${route.url}`);
      }
    });
    registerPanelRoutes(probe, { db: appDb.db });
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
});
