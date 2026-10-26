import { createDatabase, schema } from '@alocidadao/db';
import {
  impedimentDetailSchema,
  workOrderResultSchema,
  workQueueResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { panelAuthHeader } from '../test/panel.js';
import { metersNorth, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { occurrences, requests, statusEvents, workOrders } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.0, lng: -47.0 };

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: testAuthOptions,
    storage: createStorage(testStorageConfig),
  });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function call(
  method: 'GET' | 'POST',
  url: string,
  userId: string,
  tenantId: string,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
    ...(payload ? { payload } : {}),
  });
}

/** Prefeitura com a equipe de Obras e um admin. */
async function seedBase() {
  const seed = await fx.seedPanelTenant();
  const teamId = await fx.addTeam(seed.tenantId, {
    departmentId: seed.worksId,
    name: 'Equipe Norte',
  });
  const adminId = await fx.newAdmin(seed.tenantId);
  return { ...seed, teamId, adminId };
}

const orders = async (occurrenceId: string) =>
  owner.db
    .select()
    .from(workOrders)
    .where(eq(workOrders.occurrenceId, occurrenceId))
    .orderBy(asc(workOrders.createdAt), asc(workOrders.id));

const tomorrow = () => new Date(Date.now() + 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);

/** Impedimento pronto, com uma segunda equipe de Obras disponível. */
async function seedImpeded() {
  const base = await seedBase();
  const otherTeamId = await fx.addTeam(base.tenantId, {
    departmentId: base.worksId,
    name: 'Equipe Sul',
  });
  const impediment = await fx.seedImpediment(base, { teamId: base.teamId, at: CENTER });
  return { ...base, otherTeamId, ...impediment };
}

describe('impedimentos na API', () => {
  it('impediment queue shows the reason label key and oldest first', async () => {
    const base = await seedBase();
    const recent = await fx.seedImpediment(base, {
      teamId: base.teamId,
      at: CENTER,
      hoursAgo: 2,
      reason: 'inaccessible',
    });
    const old = await fx.seedImpediment(base, {
      teamId: base.teamId,
      at: metersNorth(CENTER, 500),
      hoursAgo: 20,
      reason: 'not_municipal',
      address: 'Rua Antiga, 1',
    });
    // Motivo desconhecido vira null.
    const odd = await fx.seedImpediment(base, {
      teamId: base.teamId,
      at: metersNorth(CENTER, 900),
      hoursAgo: 1,
      reason: 'motivo_inventado',
    });
    // Em revisão não entra.
    await fx.seedReview(base, { teamId: base.teamId, at: metersNorth(CENTER, 1300) });

    const res = await call('GET', '/panel/impediments', base.adminId, base.tenantId);
    expect(res.statusCode).toBe(200);
    const queue = workQueueResponseSchema.parse(res.json());
    expect(queue.total).toBe(3);
    expect(queue.items.map((item) => item.workOrderId)).toEqual([
      old.workOrderId,
      recent.workOrderId,
      odd.workOrderId,
    ]);
    expect(queue.items.map((item) => item.impedimentReason)).toEqual([
      'not_municipal',
      'inaccessible',
      null,
    ]);
    expect(queue.items[0]).toMatchObject({ address: 'Rua Antiga, 1', teamName: 'Equipe Norte' });
  });

  it('impediment detail brings the note, the photo and the agent', async () => {
    const seed = await seedImpeded();
    const res = await call(
      'GET',
      `/panel/impediments/${seed.workOrderId}`,
      seed.adminId,
      seed.tenantId,
    );
    expect(res.statusCode).toBe(200);
    const detail = impedimentDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      workOrderId: seed.workOrderId,
      status: 'impeded',
      agentName: 'Agente Impedido',
      reason: 'missing_material',
      note: 'Faltou massa asfáltica.',
      teamName: 'Equipe Norte',
      managerInstructions: 'Levar o cone.',
      activeRequestCount: 1,
    });
    expect(detail.photoUrl).toContain('/uploads/');
    expect(res.body).not.toContain('Cidadã Sigilosa');

    // Sem foto, photoUrl é null; fora de impedimento, 404.
    const bare = await fx.seedImpediment(seed, {
      teamId: seed.teamId,
      at: metersNorth(CENTER, 700),
      withPhoto: false,
    });
    const noPhoto = await call(
      'GET',
      `/panel/impediments/${bare.workOrderId}`,
      seed.adminId,
      seed.tenantId,
    );
    expect(impedimentDetailSchema.parse(noPhoto.json()).photoUrl).toBeNull();
    await owner.db
      .update(workOrders)
      .set({ status: 'assigned' })
      .where(eq(workOrders.id, bare.workOrderId));
    const gone = await call(
      'GET',
      `/panel/impediments/${bare.workOrderId}`,
      seed.adminId,
      seed.tenantId,
    );
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ code: 'work_order_not_found' });
  });

  it('reassign cancels the impeded work order and creates one for the new team', async () => {
    const seed = await seedImpeded();
    const res = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reassign`,
      seed.adminId,
      seed.tenantId,
      { teamId: seed.otherTeamId, dueDate: tomorrow(), instructions: 'Trazer massa.' },
    );
    expect(res.statusCode).toBe(200);
    const result = workOrderResultSchema.parse(res.json());
    expect(result.status).toBe('assigned');
    expect(result.workOrderId).not.toBe(seed.workOrderId);

    const [old, created] = await orders(seed.occurrenceId);
    expect(old).toMatchObject({ id: seed.workOrderId, status: 'cancelled' });
    expect(created).toMatchObject({
      id: result.workOrderId,
      teamId: seed.otherTeamId,
      status: 'assigned',
      managerInstructions: 'Trazer massa.',
    });
    expect(created!.dueAt?.toISOString()).toBe(
      new Date(`${tomorrow()}T23:59:59-03:00`).toISOString(),
    );

    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.occurrenceId, seed.occurrenceId));
    expect(
      events.find((e) => e.workOrderId === seed.workOrderId && e.toStatus === 'cancelled'),
    ).toMatchObject({ comment: 'Reatribuída a Equipe Sul', actorUserId: seed.adminId });
    expect(
      events.find((e) => e.workOrderId === result.workOrderId && e.toStatus === 'assigned'),
    ).toBeDefined();

    // Ocorrência e solicitação seguem em atendimento.
    const [occurrence] = await owner.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, seed.occurrenceId));
    expect(occurrence!.status).toBe('in_progress');
    const [request] = await owner.db.select().from(requests).where(eq(requests.id, seed.requestId));
    expect(request!.status).toBe('in_progress');
  });

  it('reassign to the same team is 422 same_team', async () => {
    const seed = await seedImpeded();
    const res = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reassign`,
      seed.adminId,
      seed.tenantId,
      { teamId: seed.teamId, dueDate: tomorrow(), instructions: null },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'same_team' });
    expect(await orders(seed.occurrenceId)).toHaveLength(1);
  });

  it('reassign to a team of another department is 422 team_not_eligible', async () => {
    const seed = await seedImpeded();
    const lightsTeam = await fx.addTeam(seed.tenantId, {
      departmentId: seed.lightsId,
      name: 'Equipe Luz',
    });
    const res = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reassign`,
      seed.adminId,
      seed.tenantId,
      { teamId: lightsTeam, dueDate: tomorrow(), instructions: null },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'team_not_eligible' });
    const past = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reassign`,
      seed.adminId,
      seed.tenantId,
      { teamId: seed.otherTeamId, dueDate: '2020-01-01', instructions: null },
    );
    expect(past.statusCode).toBe(422);
    expect(past.json()).toEqual({ code: 'due_date_in_past' });
    expect((await orders(seed.occurrenceId))[0]!.status).toBe('impeded');
  });

  it('reschedule keeps the team and sets the new due date', async () => {
    const seed = await seedImpeded();
    const date = '2099-10-23';
    const res = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reschedule`,
      seed.adminId,
      seed.tenantId,
      { dueDate: date },
    );
    expect(res.statusCode).toBe(200);
    expect(workOrderResultSchema.parse(res.json())).toEqual({
      workOrderId: seed.workOrderId,
      status: 'assigned',
    });
    const rows = await orders(seed.occurrenceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: seed.teamId, status: 'assigned' });
    expect(rows[0]!.dueAt?.toISOString()).toBe('2099-10-24T02:59:59.000Z');
    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.workOrderId, seed.workOrderId));
    expect(events.find((e) => e.toStatus === 'assigned')).toMatchObject({
      comment: 'Reagendada para 23 out',
      fromStatus: 'impeded',
    });
  });

  it('reschedule with a past date is 422 due_date_in_past', async () => {
    const seed = await seedImpeded();
    const res = await call(
      'POST',
      `/panel/work-orders/${seed.workOrderId}/reschedule`,
      seed.adminId,
      seed.tenantId,
      { dueDate: '2020-01-01' },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'due_date_in_past' });
    expect((await orders(seed.occurrenceId))[0]!.status).toBe('impeded');
  });

  it('reassign after reschedule is 409 and keeps one active work order', async () => {
    const seed = await seedImpeded();
    const url = (action: string) => `/panel/work-orders/${seed.workOrderId}/${action}`;
    expect(
      (
        await call('POST', url('reschedule'), seed.adminId, seed.tenantId, {
          dueDate: tomorrow(),
        })
      ).statusCode,
    ).toBe(200);
    const res = await call('POST', url('reassign'), seed.adminId, seed.tenantId, {
      teamId: seed.otherTeamId,
      dueDate: tomorrow(),
      instructions: null,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'work_order_unavailable' });
    const again = await call('POST', url('reschedule'), seed.adminId, seed.tenantId, {
      dueDate: tomorrow(),
    });
    expect(again.statusCode).toBe(409);
    const rows = await orders(seed.occurrenceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('assigned');
  });

  it('reject from impediment cancels the work order', async () => {
    const seed = await seedImpeded();
    const res = await call(
      'POST',
      `/panel/occurrences/${seed.occurrenceId}/reject`,
      seed.adminId,
      seed.tenantId,
      { reason: 'Não é de competência da prefeitura.' },
    );
    expect(res.statusCode).toBe(204);
    expect((await orders(seed.occurrenceId))[0]!.status).toBe('cancelled');
    const [request] = await owner.db.select().from(requests).where(eq(requests.id, seed.requestId));
    expect(request!.status).toBe('rejected');
  });

  it('impediment decisions outside the departments are 404', async () => {
    const seed = await seedImpeded();
    const outsider = await fx.newManager(seed.tenantId, [seed.lightsId]);
    const id = seed.workOrderId;
    const detail = await call('GET', `/panel/impediments/${id}`, outsider, seed.tenantId);
    expect(detail.statusCode).toBe(404);
    const reassign = await call(
      'POST',
      `/panel/work-orders/${id}/reassign`,
      outsider,
      seed.tenantId,
      {
        teamId: seed.otherTeamId,
        dueDate: tomorrow(),
        instructions: null,
      },
    );
    expect(reassign.statusCode).toBe(404);
    expect(reassign.json()).toEqual({ code: 'work_order_not_found' });
    const reschedule = await call(
      'POST',
      `/panel/work-orders/${id}/reschedule`,
      outsider,
      seed.tenantId,
      { dueDate: tomorrow() },
    );
    expect(reschedule.statusCode).toBe(404);
    const queue = await call('GET', '/panel/impediments', outsider, seed.tenantId);
    expect(workQueueResponseSchema.parse(queue.json()).total).toBe(0);
    expect((await orders(seed.occurrenceId))[0]!.status).toBe('impeded');
  });
});
