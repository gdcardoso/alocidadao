import { createDatabase, schema, withContext, type Transaction } from '@alocidadao/db';
import {
  assignResponseSchema,
  mergeResponseSchema,
  occurrenceDetailSchema,
  splitResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { daysAgo, metersNorth, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { addDays, todayInSaoPaulo } from './occurrences.js';

const { occurrences, requests, workOrders, statusEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.1, lng: -47.1 };

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

type Seed = Awaited<ReturnType<typeof fx.seedPanelTenant>>;

async function post(url: string, userId: string, tenantId: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
    payload: body as Record<string, unknown>,
  });
}

/** Ocorrência com relatos no centro dela, criados na ordem dada (um minuto entre eles). */
async function occurrenceWithReports(
  seed: Seed,
  input: Parameters<typeof fx.addOccurrence>[1] & {
    reports?: number;
    requestStatuses?: Parameters<typeof fx.addRequest>[1]['status'][];
  },
) {
  const occurrenceId = await fx.addOccurrence(seed.tenantId, input);
  const statuses = input.requestStatuses ?? Array(input.reports ?? 1).fill('open');
  const created = [];
  for (let i = 0; i < statuses.length; i++) {
    created.push(
      await fx.addRequest(seed.tenantId, {
        occurrenceId,
        categoryId: input.categoryId,
        citizenId: seed.citizenId,
        at: metersNorth(input.at, i),
        address: `Rua ${i + 1}`,
        description: `Relato ${i + 1}`,
        status: statuses[i],
        createdAt: new Date((input.createdAt ?? daysAgo(1)).getTime() + i * 60_000),
      }),
    );
  }
  return { id: occurrenceId, requests: created };
}

function read<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>) {
  return withContext(owner.db, { tenantId }, fn);
}

const loadOccurrence = (tenantId: string, id: string) =>
  read(tenantId, async (tx) => {
    const [row] = await tx.select().from(occurrences).where(eq(occurrences.id, id));
    return row!;
  });

const loadRequests = (tenantId: string, occurrenceId: string) =>
  read(tenantId, (tx) =>
    tx
      .select()
      .from(requests)
      .where(eq(requests.occurrenceId, occurrenceId))
      .orderBy(asc(requests.createdAt)),
  );

const loadWorkOrders = (tenantId: string, occurrenceId: string) =>
  read(tenantId, (tx) =>
    tx.select().from(workOrders).where(eq(workOrders.occurrenceId, occurrenceId)),
  );

const loadEvents = (tenantId: string, occurrenceId: string) =>
  read(tenantId, (tx) =>
    tx
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.occurrenceId, occurrenceId))
      .orderBy(asc(statusEvents.createdAt)),
  );

const occurrenceEvents = (tenantId: string, occurrenceId: string) =>
  read(tenantId, (tx) =>
    tx
      .select()
      .from(statusEvents)
      .where(
        and(
          eq(statusEvents.occurrenceId, occurrenceId),
          isNull(statusEvents.requestId),
          isNull(statusEvents.workOrderId),
        ),
      ),
  );

const REASON = 'Fora da responsabilidade da prefeitura.';

describe('POST /panel/occurrences/:id/assign', () => {
  it('assign creates the work order and moves occurrence and open requests to in progress', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      requestStatuses: ['open', 'open', 'cancelled'],
    });
    const dueDate = addDays(todayInSaoPaulo(), 3);

    const response = await post(`/panel/occurrences/${occ.id}/assign`, managerId, tenantId, {
      teamId,
      dueDate,
      instructions: '  Levar asfalto frio.  ',
    });

    expect(response.statusCode).toBe(200);
    const body = assignResponseSchema.parse(response.json());
    expect(body.occurrenceId).toBe(occ.id);

    const [order] = await loadWorkOrders(tenantId, occ.id);
    expect(order).toMatchObject({
      id: body.workOrderId,
      teamId,
      status: 'assigned',
      managerInstructions: 'Levar asfalto frio.',
    });
    expect(order!.dueAt!.toISOString()).toBe(new Date(`${dueDate}T23:59:59-03:00`).toISOString());

    expect((await loadOccurrence(tenantId, occ.id)).status).toBe('in_progress');
    const rows = await loadRequests(tenantId, occ.id);
    expect(rows.map((r) => r.status)).toEqual(['in_progress', 'in_progress', 'cancelled']);

    const events = await loadEvents(tenantId, occ.id);
    expect(events.every((e) => e.actorUserId === managerId)).toBe(true);
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workOrderId: body.workOrderId,
          requestId: null,
          toStatus: 'assigned',
        }),
        expect.objectContaining({
          workOrderId: null,
          requestId: null,
          fromStatus: 'triage',
          toStatus: 'in_progress',
        }),
        expect.objectContaining({
          requestId: occ.requests[0]!.id,
          fromStatus: 'open',
          toStatus: 'in_progress',
        }),
        expect.objectContaining({
          requestId: occ.requests[1]!.id,
          fromStatus: 'open',
          toStatus: 'in_progress',
        }),
      ]),
    );

    // O detalhe passa a mostrar a atividade.
    const detail = await app.inject({
      method: 'GET',
      url: `/panel/occurrences/${occ.id}`,
      headers: await panelAuthHeader(appDb.db, managerId, tenantId),
    });
    expect(occurrenceDetailSchema.parse(detail.json()).activeWorkOrder).toMatchObject({
      id: body.workOrderId,
      teamName: 'Equipe A',
    });
  });

  it('assigning twice is 409 and keeps one work order', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const adminId = await fx.newAdmin(tenantId);
    const otherManagerId = await fx.newManager(tenantId, [worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const occ = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const body = { teamId, dueDate: todayInSaoPaulo(), instructions: null };

    const [first, second] = await Promise.all([
      post(`/panel/occurrences/${occ.id}/assign`, adminId, tenantId, body),
      post(`/panel/occurrences/${occ.id}/assign`, otherManagerId, tenantId, body),
    ]);

    expect([first.statusCode, second.statusCode].toSorted()).toEqual([200, 409]);
    const conflict = first.statusCode === 409 ? first : second;
    expect(conflict.json()).toEqual({ code: 'occurrence_unavailable' });
    expect(await loadWorkOrders(tenantId, occ.id)).toHaveLength(1);
    const rows = await loadRequests(tenantId, occ.id);
    expect(rows.map((r) => r.status)).toEqual(['in_progress']);
    expect(await occurrenceEvents(tenantId, occ.id)).toHaveLength(1);
  });

  it('assign to a team of another department is 422 team_not_eligible', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId, lightsId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const lightsTeam = await fx.addTeam(tenantId, { departmentId: lightsId, name: 'Eletricistas' });
    const occ = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });

    const response = await post(`/panel/occurrences/${occ.id}/assign`, managerId, tenantId, {
      teamId: lightsTeam,
      dueDate: todayInSaoPaulo(),
      instructions: null,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'team_not_eligible' });
    expect(await loadWorkOrders(tenantId, occ.id)).toHaveLength(0);
    expect((await loadOccurrence(tenantId, occ.id)).status).toBe('triage');
  });

  it('assign with a past date is 422', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const occ = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });

    const response = await post(`/panel/occurrences/${occ.id}/assign`, managerId, tenantId, {
      teamId,
      dueDate: addDays(todayInSaoPaulo(), -1),
      instructions: null,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'due_date_in_past' });
    expect(await loadWorkOrders(tenantId, occ.id)).toHaveLength(0);
  });
});

describe('POST /panel/occurrences/:id/reject', () => {
  it('reject from triage rejects every open request with the public reason', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      requestStatuses: ['open', 'open', 'cancelled'],
    });

    const response = await post(`/panel/occurrences/${occ.id}/reject`, managerId, tenantId, {
      reason: `  ${REASON}  `,
    });

    expect(response.statusCode).toBe(204);
    const occurrence = await loadOccurrence(tenantId, occ.id);
    expect(occurrence).toMatchObject({ status: 'rejected', rejectionReason: REASON });
    const rows = await loadRequests(tenantId, occ.id);
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'rejected', 'cancelled']);

    const events = await loadEvents(tenantId, occ.id);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.comment === REASON && e.actorUserId === managerId)).toBe(true);
    expect(events.filter((e) => e.requestId === null)).toEqual([
      expect.objectContaining({ fromStatus: 'triage', toStatus: 'rejected', workOrderId: null }),
    ]);
  });

  it('reject in progress cancels the active work order', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const adminId = await fx.newAdmin(tenantId);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'in_progress',
      requestStatuses: ['in_progress', 'in_progress'],
    });
    const workOrderId = await fx.addWorkOrder(tenantId, {
      occurrenceId: occ.id,
      teamId,
      status: 'in_execution',
    });

    const response = await post(`/panel/occurrences/${occ.id}/reject`, adminId, tenantId, {
      reason: REASON,
    });

    expect(response.statusCode).toBe(204);
    expect((await loadOccurrence(tenantId, occ.id)).status).toBe('rejected');
    const [order] = await loadWorkOrders(tenantId, occ.id);
    expect(order!.status).toBe('cancelled');
    const rows = await loadRequests(tenantId, occ.id);
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    const events = await loadEvents(tenantId, occ.id);
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workOrderId,
          fromStatus: 'in_execution',
          toStatus: 'cancelled',
          comment: REASON,
        }),
      ]),
    );
  });

  it('reject after merge is 409 occurrence_unavailable', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const survivor = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const absorbed = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 10),
    });

    const merge = await post(`/panel/occurrences/${survivor.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: absorbed.id,
    });
    expect(merge.statusCode).toBe(200);

    const response = await post(`/panel/occurrences/${absorbed.id}/reject`, managerId, tenantId, {
      reason: REASON,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'occurrence_unavailable' });
    expect((await loadOccurrence(tenantId, absorbed.id)).status).toBe('merged');
    const rows = await loadRequests(tenantId, survivor.id);
    expect(rows.map((r) => r.status)).toEqual(['open', 'open']);
  });
});

describe('POST /panel/occurrences/:id/merge', () => {
  it('merge moves every request and marks the other occurrence merged', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const survivor = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      reports: 2,
    });
    const other = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 20),
      requestStatuses: ['open', 'cancelled'],
    });

    const response = await post(`/panel/occurrences/${survivor.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: other.id,
    });

    expect(response.statusCode).toBe(200);
    expect(mergeResponseSchema.parse(response.json())).toEqual({ survivorId: survivor.id });
    expect(await loadOccurrence(tenantId, other.id)).toMatchObject({
      status: 'merged',
      mergedIntoId: survivor.id,
    });
    expect(await loadRequests(tenantId, other.id)).toHaveLength(0);
    const rows = await loadRequests(tenantId, survivor.id);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.status).toSorted()).toEqual(['cancelled', 'open', 'open', 'open']);
    expect((await loadOccurrence(tenantId, survivor.id)).status).toBe('triage');

    expect(await occurrenceEvents(tenantId, other.id)).toEqual([
      expect.objectContaining({
        fromStatus: 'triage',
        toStatus: 'merged',
        actorUserId: managerId,
        details: { mergedIntoId: survivor.id },
      }),
    ]);

    // A juntada some das sugestões e do detalhe.
    const headers = await panelAuthHeader(appDb.db, managerId, tenantId);
    const detail = await app.inject({
      method: 'GET',
      url: `/panel/occurrences/${survivor.id}`,
      headers,
    });
    const parsed = occurrenceDetailSchema.parse(detail.json());
    expect(parsed.requestCount).toBe(3);
    expect(parsed.suggestions).toEqual([]);
    const gone = await app.inject({
      method: 'GET',
      url: `/panel/occurrences/${other.id}`,
      headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('merge keeps the occurrence with the active work order and moves open requests to in progress', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const opened = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      reports: 2,
    });
    const working = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 15),
      status: 'in_progress',
      requestStatuses: ['in_progress'],
    });
    await fx.addWorkOrder(tenantId, { occurrenceId: working.id, teamId, status: 'assigned' });

    const response = await post(`/panel/occurrences/${opened.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: working.id,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ survivorId: working.id });
    expect(await loadOccurrence(tenantId, opened.id)).toMatchObject({
      status: 'merged',
      mergedIntoId: working.id,
    });
    expect((await loadOccurrence(tenantId, working.id)).status).toBe('in_progress');
    const rows = await loadRequests(tenantId, working.id);
    expect(rows.map((r) => r.status)).toEqual(['in_progress', 'in_progress', 'in_progress']);

    const moved = (await loadEvents(tenantId, working.id)).filter((e) => e.requestId !== null);
    expect(moved.map((e) => e.requestId).toSorted()).toEqual(
      opened.requests.map((r) => r.id).toSorted(),
    );
    expect(moved.every((e) => e.fromStatus === 'open' && e.toStatus === 'in_progress')).toBe(true);
    expect(await occurrenceEvents(tenantId, opened.id)).toEqual([
      expect.objectContaining({ toStatus: 'merged', details: { mergedIntoId: working.id } }),
    ]);
  });

  it('merge with both active work orders is 409 both_have_work_orders', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe A' });
    const [a, b] = [
      await occurrenceWithReports(seed, {
        categoryId: potholeId,
        at: CENTER,
        status: 'in_progress',
        requestStatuses: ['in_progress'],
      }),
      await occurrenceWithReports(seed, {
        categoryId: potholeId,
        at: metersNorth(CENTER, 10),
        status: 'in_progress',
        requestStatuses: ['in_progress'],
      }),
    ];
    await fx.addWorkOrder(tenantId, { occurrenceId: a!.id, teamId, status: 'assigned' });
    await fx.addWorkOrder(tenantId, { occurrenceId: b!.id, teamId, status: 'impeded' });

    const response = await post(`/panel/occurrences/${a!.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: b!.id,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'both_have_work_orders' });
    expect((await loadOccurrence(tenantId, b!.id)).status).toBe('in_progress');
  });

  it('merge across categories is 422 category_mismatch', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId } = seed;
    const adminId = await fx.newAdmin(tenantId);
    const pothole = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const lamp = await occurrenceWithReports(seed, { categoryId: lampId, at: CENTER });

    const response = await post(`/panel/occurrences/${pothole.id}/merge`, adminId, tenantId, {
      otherOccurrenceId: lamp.id,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'category_mismatch' });
    expect((await loadOccurrence(tenantId, lamp.id)).status).toBe('triage');

    const same = await post(`/panel/occurrences/${pothole.id}/merge`, adminId, tenantId, {
      otherOccurrenceId: pothole.id,
    });
    expect(same.statusCode).toBe(422);
    expect(same.json()).toEqual({ code: 'same_occurrence' });
  });

  it('manager cannot merge with an occurrence of another department', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const pothole = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const lamp = await occurrenceWithReports(seed, { categoryId: lampId, at: CENTER });

    const fromMine = await post(`/panel/occurrences/${pothole.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: lamp.id,
    });
    const fromOther = await post(`/panel/occurrences/${lamp.id}/merge`, managerId, tenantId, {
      otherOccurrenceId: pothole.id,
    });

    for (const response of [fromMine, fromOther]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'occurrence_not_found' });
    }
    expect((await loadOccurrence(tenantId, lamp.id)).status).toBe('triage');
    expect((await loadOccurrence(tenantId, pothole.id)).status).toBe('triage');
  });
});

describe('POST /panel/occurrences/:id/dismiss-suggestion', () => {
  it('dismissed pair is not suggested again', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const a = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const b = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 10),
    });
    const lamp = await occurrenceWithReports(seed, { categoryId: lampId, at: CENTER });
    const headers = await panelAuthHeader(appDb.db, managerId, tenantId);
    const suggestionsOf = async (id: string) => {
      const detail = await app.inject({ method: 'GET', url: `/panel/occurrences/${id}`, headers });
      return occurrenceDetailSchema.parse(detail.json()).suggestions.map((s) => s.occurrenceId);
    };
    expect(await suggestionsOf(a.id)).toEqual([b.id]);

    for (let i = 0; i < 2; i++) {
      const response = await post(
        `/panel/occurrences/${a.id}/dismiss-suggestion`,
        managerId,
        tenantId,
        { otherOccurrenceId: b.id },
      );
      expect(response.statusCode).toBe(204);
    }

    expect(await suggestionsOf(a.id)).toEqual([]);
    expect(await suggestionsOf(b.id)).toEqual([]);

    const outside = await post(
      `/panel/occurrences/${a.id}/dismiss-suggestion`,
      managerId,
      tenantId,
      { otherOccurrenceId: lamp.id },
    );
    expect(outside.statusCode).toBe(404);
    expect(outside.json()).toEqual({ code: 'occurrence_not_found' });
  });
});

describe('POST /panel/occurrences/:id/split', () => {
  it('split creates a triage occurrence with the unchecked requests', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      reports: 3,
    });
    const [keep, oldestMoved, newerMoved] = occ.requests;

    const response = await post(`/panel/occurrences/${occ.id}/split`, managerId, tenantId, {
      requestIds: [newerMoved!.id, oldestMoved!.id],
    });

    expect(response.statusCode).toBe(200);
    const { newOccurrenceId } = splitResponseSchema.parse(response.json());
    const created = await loadOccurrence(tenantId, newOccurrenceId);
    expect(created).toMatchObject({ status: 'triage', categoryId: potholeId });
    const movedRows = await loadRequests(tenantId, newOccurrenceId);
    expect(movedRows.map((r) => r.id)).toEqual([oldestMoved!.id, newerMoved!.id]);
    expect(movedRows.every((r) => r.status === 'open')).toBe(true);
    // No local da solicitação mais antiga movida.
    expect(created.location).toEqual(movedRows[0]!.location);
    expect((await loadRequests(tenantId, occ.id)).map((r) => r.id)).toEqual([keep!.id]);
    expect((await loadOccurrence(tenantId, occ.id)).status).toBe('triage');

    expect(await occurrenceEvents(tenantId, newOccurrenceId)).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'triage',
        actorUserId: managerId,
        details: { splitFrom: occ.id },
      }),
    ]);
    const separations = await read(tenantId, (tx) =>
      tx.execute<{ a: string; b: string; created_by: string }>(sqlSeparations(tenantId)),
    );
    const [low, high] = [occ.id, newOccurrenceId].toSorted();
    expect(separations.rows).toEqual([{ a: low, b: high, created_by: managerId }]);
  });

  it('split rejects moving every request', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      requestStatuses: ['open', 'open', 'cancelled'],
    });
    const other = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const [first, second, cancelled] = occ.requests;
    const url = `/panel/occurrences/${occ.id}/split`;

    const cases = [
      [first!.id, second!.id],
      [first!.id, cancelled!.id],
      [first!.id, other.requests[0]!.id],
    ];
    for (const requestIds of cases) {
      const response = await post(url, managerId, tenantId, { requestIds });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: 'split_invalid' });
    }
    expect(await loadRequests(tenantId, occ.id)).toHaveLength(3);
  });

  it('split of an in-progress occurrence is 409', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const managerId = await fx.newManager(tenantId, [worksId]);
    const occ = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'in_progress',
      requestStatuses: ['in_progress', 'in_progress'],
    });

    const response = await post(`/panel/occurrences/${occ.id}/split`, managerId, tenantId, {
      requestIds: [occ.requests[1]!.id],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'occurrence_unavailable' });
    expect(await loadRequests(tenantId, occ.id)).toHaveLength(2);
  });
});

function sqlSeparations(tenantId: string) {
  return sql`
    select occurrence_a_id as a, occurrence_b_id as b, created_by
    from occurrence_separations
    where tenant_id = ${tenantId}
  `;
}
