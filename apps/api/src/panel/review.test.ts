import { createDatabase, schema } from '@alocidadao/db';
import {
  requestDetailSchema,
  reviewDetailSchema,
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
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { photos, requests, occurrences, statusEvents, workOrders } = schema;

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

const photoReviews = async (workOrderId: string) =>
  Object.fromEntries(
    (
      await owner.db
        .select({ id: photos.id, review: photos.review })
        .from(photos)
        .where(eq(photos.workOrderId, workOrderId))
    ).map((row) => [row.id, row.review]),
  );

describe('revisão na API', () => {
  it('review queue lists awaiting_review work orders oldest first with team and department', async () => {
    const base = await seedBase();
    const recent = await fx.seedReview(base, { teamId: base.teamId, at: CENTER, hoursAgo: 3 });
    const old = await fx.seedReview(base, {
      teamId: base.teamId,
      at: metersNorth(CENTER, 500),
      hoursAgo: 30,
      address: 'Rua Antiga, 1',
    });
    // Impedida e em execução não entram na fila de revisão.
    const other = await fx.addOccurrence(base.tenantId, {
      categoryId: base.potholeId,
      at: metersNorth(CENTER, 900),
      status: 'in_progress',
    });
    await fx.addWorkOrder(base.tenantId, {
      occurrenceId: other,
      teamId: base.teamId,
      status: 'impeded',
    });

    const res = await call('GET', '/panel/reviews', base.adminId, base.tenantId);
    expect(res.statusCode).toBe(200);
    const queue = workQueueResponseSchema.parse(res.json());
    expect(queue.total).toBe(2);
    expect(queue.items.map((item) => item.workOrderId)).toEqual([
      old.workOrderId,
      recent.workOrderId,
    ]);
    expect(queue.items[0]).toMatchObject({
      categoryName: 'Buraco',
      departmentName: 'Obras',
      teamName: 'Equipe Norte',
      address: 'Rua Antiga, 1',
      impedimentReason: null,
    });
    const waited = Date.now() - new Date(queue.items[0]!.statusSince).getTime();
    expect(waited).toBeGreaterThan(29 * 3_600_000);
    expect(waited).toBeLessThan(31 * 3_600_000);
  });

  it('review detail brings agent, distance, pending photos and one citizen photo per request', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER, distanceM: 250 });
    // Segunda solicitação com duas fotos e uma cancelada: só a primeira foto da não cancelada.
    const second = await fx.addRequest(base.tenantId, {
      occurrenceId: review.occurrenceId,
      categoryId: base.potholeId,
      citizenId: base.citizenId,
      at: CENTER,
      status: 'in_progress',
    });
    await fx.addReportPhoto(base.tenantId, { requestId: second.id, uploadedBy: base.citizenId });
    await fx.addReportPhoto(base.tenantId, { requestId: second.id, uploadedBy: base.citizenId });
    const cancelled = await fx.addRequest(base.tenantId, {
      occurrenceId: review.occurrenceId,
      categoryId: base.potholeId,
      citizenId: base.citizenId,
      at: CENTER,
      status: 'cancelled',
    });
    await fx.addReportPhoto(base.tenantId, { requestId: cancelled.id, uploadedBy: base.citizenId });
    // Foto já decidida não volta.
    await fx.addWorkOrderPhoto(base.tenantId, {
      workOrderId: review.workOrderId,
      uploadedBy: review.agentId,
      review: 'discarded',
    });

    const res = await call(
      'GET',
      `/panel/reviews/${review.workOrderId}`,
      base.adminId,
      base.tenantId,
    );
    expect(res.statusCode).toBe(200);
    const detail = reviewDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      workOrderId: review.workOrderId,
      status: 'awaiting_review',
      agentName: 'Agente Revisão',
      distanceM: 250,
      activeRequestCount: 2,
      teamName: 'Equipe Norte',
      address: 'Rua da Revisão, 10',
      agentNote: 'Buraco tapado com massa asfáltica.',
    });
    expect(detail.pendingPhotos.map((photo) => photo.id)).toEqual(review.photoIds);
    expect(detail.pendingPhotos[0]!.url).toContain('/uploads/');
    expect(detail.citizenPhotos).toHaveLength(2);
    expect(res.body).not.toContain('Cidadã Sigilosa');

    // Sem estar em revisão, 404.
    const queue = await call('GET', '/panel/reviews', base.adminId, base.tenantId);
    expect(queue.statusCode).toBe(200);
    await owner.db
      .update(workOrders)
      .set({ status: 'impeded' })
      .where(eq(workOrders.id, review.workOrderId));
    const gone = await call(
      'GET',
      `/panel/reviews/${review.workOrderId}`,
      base.adminId,
      base.tenantId,
    );
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ code: 'work_order_not_found' });
  });

  it('publish marks only the chosen photos and moves only in_progress requests', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER, photoCount: 3 });
    const cancelled = await fx.addRequest(base.tenantId, {
      occurrenceId: review.occurrenceId,
      categoryId: base.potholeId,
      citizenId: base.citizenId,
      at: CENTER,
      status: 'cancelled',
    });
    const [keep, drop, extra] = review.photoIds as [string, string, string];

    const res = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/publish`,
      base.adminId,
      base.tenantId,
      {
        publicNote: '  Buraco tapado pela equipe.  ',
        publishedPhotoIds: [keep],
      },
    );
    expect(res.statusCode).toBe(200);
    expect(workOrderResultSchema.parse(res.json())).toEqual({
      workOrderId: review.workOrderId,
      status: 'completed',
    });

    expect(await photoReviews(review.workOrderId)).toEqual({
      [keep]: 'published',
      [drop]: 'discarded',
      [extra]: 'discarded',
    });
    const [order] = await owner.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, review.workOrderId));
    expect(order).toMatchObject({ status: 'completed', publicNote: 'Buraco tapado pela equipe.' });
    expect(order!.publishedAt).not.toBeNull();
    const [occurrence] = await owner.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, review.occurrenceId));
    expect(occurrence!.status).toBe('awaiting_confirmation');
    const rows = await owner.db
      .select({ id: requests.id, status: requests.status })
      .from(requests)
      .where(eq(requests.occurrenceId, review.occurrenceId));
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [review.requestId]: 'awaiting_confirmation',
      [cancelled.id]: 'cancelled',
    });
    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.occurrenceId, review.occurrenceId))
      .orderBy(asc(statusEvents.createdAt), asc(statusEvents.id));
    const published = events.filter((event) => event.toStatus === 'completed');
    expect(published).toMatchObject([
      { workOrderId: review.workOrderId, fromStatus: 'awaiting_review', actorUserId: base.adminId },
    ]);
    expect(
      events.filter(
        (event) =>
          event.requestId === review.requestId && event.toStatus === 'awaiting_confirmation',
      ),
    ).toHaveLength(1);
  });

  it('publish with a photo of another work order is 422 photo_not_found', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER });
    const other = await fx.seedReview(base, { teamId: base.teamId, at: metersNorth(CENTER, 500) });

    const res = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/publish`,
      base.adminId,
      base.tenantId,
      {
        publicNote: 'Buraco tapado pela equipe.',
        publishedPhotoIds: [review.photoIds[0]!, other.photoIds[0]!],
      },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'photo_not_found' });
    expect(Object.values(await photoReviews(review.workOrderId))).toEqual(['pending', 'pending']);
    expect(Object.values(await photoReviews(other.workOrderId))).toEqual(['pending', 'pending']);
    const [order] = await owner.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, review.workOrderId));
    expect(order!.status).toBe('awaiting_review');
  });

  it('publishing twice is 409 and keeps the photos as decided the first time', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER });
    const [keep, drop] = review.photoIds as [string, string];
    const path = `/panel/work-orders/${review.workOrderId}/publish`;

    const first = await call('POST', path, base.adminId, base.tenantId, {
      publicNote: 'Buraco tapado pela equipe.',
      publishedPhotoIds: [keep],
    });
    expect(first.statusCode).toBe(200);
    const second = await call('POST', path, base.adminId, base.tenantId, {
      publicNote: 'Outro texto qualquer aqui.',
      publishedPhotoIds: [drop],
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ code: 'work_order_unavailable' });
    expect(await photoReviews(review.workOrderId)).toEqual({
      [keep]: 'published',
      [drop]: 'discarded',
    });
    const [order] = await owner.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, review.workOrderId));
    expect(order!.publicNote).toBe('Buraco tapado pela equipe.');
  });

  it('request detail shows published photos after the panel publishes', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER });
    const [keep, drop] = review.photoIds as [string, string];
    const [keepRow] = await owner.db.select().from(photos).where(eq(photos.id, keep));
    const [dropRow] = await owner.db.select().from(photos).where(eq(photos.id, drop));

    const publish = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/publish`,
      base.adminId,
      base.tenantId,
      {
        publicNote: 'Buraco tapado pela equipe.',
        publishedPhotoIds: [keep],
      },
    );
    expect(publish.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/citizen/requests/${review.requestId}`,
      headers: await appAuthHeader(appDb.db, base.citizenId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(dropRow!.storageKey);
    const detail = requestDetailSchema.parse(res.json());
    expect(detail.status).toBe('awaiting_confirmation');
    expect(detail.completion).toMatchObject({ publicNote: 'Buraco tapado pela equipe.' });
    expect(detail.completion!.photos).toHaveLength(1);
    expect(detail.completion!.photos[0]!.url).toContain(keepRow!.storageKey);
    expect(detail.completion!.photos[0]!.purpose).toBe('completion');
  });

  it('rework records reasons and message in the event and discards the chosen photos', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER });
    const [bad, good] = review.photoIds as [string, string];

    const res = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/rework`,
      base.adminId,
      base.tenantId,
      {
        reasons: ['new_photos', 'return_to_site'],
        discardedPhotoIds: [bad],
        message: '  Faltou fechar a lateral. ',
      },
    );
    expect(res.statusCode).toBe(200);
    expect(workOrderResultSchema.parse(res.json())).toEqual({
      workOrderId: review.workOrderId,
      status: 'rework_requested',
    });
    expect(await photoReviews(review.workOrderId)).toEqual({
      [bad]: 'discarded',
      [good]: 'pending',
    });
    const events = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.workOrderId, review.workOrderId))
      .orderBy(asc(statusEvents.createdAt));
    expect(events.at(-1)).toMatchObject({
      fromStatus: 'awaiting_review',
      toStatus: 'rework_requested',
      actorUserId: base.adminId,
      comment: 'Faltou fechar a lateral.',
      details: { reasons: ['new_photos', 'return_to_site'], discardedPhotoIds: [bad] },
    });

    // A ocorrência e as solicitações continuam em atendimento.
    const [occurrence] = await owner.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, review.occurrenceId));
    expect(occurrence!.status).toBe('in_progress');

    const again = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/rework`,
      base.adminId,
      base.tenantId,
      {
        reasons: ['new_note'],
        discardedPhotoIds: [],
        message: 'Corrigir o relato.',
      },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'work_order_unavailable' });
  });

  it('manager of another department gets 404 on review detail, publish and rework', async () => {
    const base = await seedBase();
    const review = await fx.seedReview(base, { teamId: base.teamId, at: CENTER });
    const outsider = await fx.newManager(base.tenantId, [base.lightsId]);
    const insider = await fx.newManager(base.tenantId, [base.worksId]);

    const detail = await call(
      'GET',
      `/panel/reviews/${review.workOrderId}`,
      outsider,
      base.tenantId,
    );
    expect(detail.statusCode).toBe(404);
    const publish = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/publish`,
      outsider,
      base.tenantId,
      {
        publicNote: 'Buraco tapado pela equipe.',
        publishedPhotoIds: [],
      },
    );
    expect(publish.statusCode).toBe(404);
    expect(publish.json()).toEqual({ code: 'work_order_not_found' });
    const rework = await call(
      'POST',
      `/panel/work-orders/${review.workOrderId}/rework`,
      outsider,
      base.tenantId,
      {
        reasons: ['new_note'],
        discardedPhotoIds: [],
        message: 'Corrigir o relato.',
      },
    );
    expect(rework.statusCode).toBe(404);
    const queue = workQueueResponseSchema.parse(
      (await call('GET', '/panel/reviews', outsider, base.tenantId)).json(),
    );
    expect(queue).toEqual({ total: 0, items: [] });
    expect(await photoReviews(review.workOrderId)).toEqual({
      [review.photoIds[0]!]: 'pending',
      [review.photoIds[1]!]: 'pending',
    });

    // O gestor do setor certo age normalmente.
    const ok = await call('GET', `/panel/reviews/${review.workOrderId}`, insider, base.tenantId);
    expect(ok.statusCode).toBe(200);
  });

  it('request detail labels contest photos with purpose contest', async () => {
    const base = await seedBase();
    const occurrenceId = await fx.addOccurrence(base.tenantId, {
      categoryId: base.potholeId,
      at: CENTER,
      status: 'triage',
    });
    const request = await fx.addRequest(base.tenantId, {
      occurrenceId,
      categoryId: base.potholeId,
      citizenId: base.citizenId,
      at: CENTER,
    });
    await fx.addReportPhoto(base.tenantId, { requestId: request.id, uploadedBy: base.citizenId });
    await fx.addContestPhoto(base.tenantId, { requestId: request.id, uploadedBy: base.citizenId });

    const res = await app.inject({
      method: 'GET',
      url: `/citizen/requests/${request.id}`,
      headers: await appAuthHeader(appDb.db, base.citizenId),
    });
    expect(res.statusCode).toBe(200);
    const detail = requestDetailSchema.parse(res.json());
    expect(detail.photos.map((photo) => photo.purpose).toSorted()).toEqual(['contest', 'report']);
  });
});
