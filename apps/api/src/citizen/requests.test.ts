import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import {
  requestCardSchema,
  requestDetailSchema,
  type ConnectionContext,
  type CreateRequestResponse,
  type GeoPoint,
  type OccurrenceStatus,
  type RequestCard,
  type RequestStatus,
} from '@alocidadao/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage, newRequestPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  users,
  tenants,
  departments,
  categories,
  occurrences,
  requests,
  photos,
  statusEvents,
  teams,
  workOrders,
  clientActions,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);

const DEMO_CENTER: GeoPoint = { lat: -23.5505, lng: -46.6333 };
const CONTEST_NOTICE =
  'Outro morador informou que o problema continua; a prefeitura vai reavaliar.';

const connection: ConnectionContext = {
  networkType: 'wifi',
  cellularGeneration: null,
  apiLatencyMs: 80,
  uploadDurationMs: 500,
  sentOffline: false,
};

let app: Awaited<ReturnType<typeof buildApp>>;
let demoTenantId: string;
let categoryId: string;
let departmentId: string;

const newPhone = () => `+55319${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

interface Citizen {
  id: string;
  headers: Record<string, string>;
}

async function createCitizen(): Promise<Citizen> {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Cidadão de teste', phone: newPhone() })
    .returning({ id: users.id });
  return { id: user!.id, headers: await appAuthHeader(appDb.db, user!.id) };
}

async function uploadPhoto(userId: string) {
  const key = newRequestPhotoKey(userId);
  const { url, headers: putHeaders } = await storage.presignUpload(key);
  const res = await fetch(url, { method: 'PUT', headers: putHeaders, body: new Uint8Array(500) });
  if (!res.ok) throw new Error(`Falha ao enviar a foto de teste: ${res.status}`);
  return key;
}

function randomDemoPoint(): GeoPoint {
  return {
    lat: DEMO_CENTER.lat + 0.02 + randomInt(0, 1000) / 100_000,
    lng: DEMO_CENTER.lng + 0.02 + randomInt(0, 1000) / 100_000,
  };
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 20, 12, minutes));

interface Seeded {
  occurrenceId: string;
  /** Na ordem de `members`. */
  requestIds: string[];
  /** Chave da foto de cada solicitação, na ordem de `members`. */
  photoKeys: string[];
}

/**
 * Monta uma ocorrência com uma solicitação por cidadão, direto no banco (dono). Cada
 * solicitação ganha uma foto, o evento `open` e, se o status é outro, o evento desse status
 * com um comentário interno que o cidadão nunca pode ver.
 */
async function seedOccurrence(
  occurrenceStatus: OccurrenceStatus,
  members: Array<{ citizenId: string; status: RequestStatus }>,
  tenant = { tenantId: demoTenantId, categoryId },
  extra: { rejectionReason?: string } = {},
): Promise<Seeded> {
  return withContext(owner.db, { tenantId: tenant.tenantId }, async (tx) => {
    const point = randomDemoPoint();
    const [occurrence] = await tx
      .insert(occurrences)
      .values({
        tenantId: tenant.tenantId,
        categoryId: tenant.categoryId,
        location: geoPoint(point),
        status: occurrenceStatus,
        rejectionReason: extra.rejectionReason ?? null,
      })
      .returning({ id: occurrences.id });
    const occurrenceId = occurrence!.id;
    const requestIds: string[] = [];
    const photoKeys: string[] = [];
    for (const member of members) {
      const [request] = await tx
        .insert(requests)
        .values({
          tenantId: tenant.tenantId,
          citizenId: member.citizenId,
          categoryId: tenant.categoryId,
          occurrenceId,
          status: member.status,
          description: 'Buraco na esquina',
          location: geoPoint(point),
          gpsLocation: geoPoint(point),
          address: 'Rua A, 10',
          createdAt: at(0),
          statusChangedAt: at(member.status === 'open' ? 0 : 30),
        })
        .returning({ id: requests.id });
      const requestId = request!.id;
      requestIds.push(requestId);
      const key = newRequestPhotoKey(member.citizenId);
      photoKeys.push(key);
      await tx.insert(photos).values({
        tenantId: tenant.tenantId,
        requestId,
        storageKey: key,
        uploadedBy: member.citizenId,
        createdAt: at(0),
      });
      await tx.insert(statusEvents).values({
        tenantId: tenant.tenantId,
        occurrenceId,
        requestId,
        toStatus: 'open',
        actorUserId: member.citizenId,
        createdAt: at(0),
      });
      if (member.status !== 'open') {
        await tx.insert(statusEvents).values({
          tenantId: tenant.tenantId,
          occurrenceId,
          requestId,
          fromStatus: 'open',
          toStatus: member.status,
          comment: 'Comentário interno do gestor',
          createdAt: at(30),
        });
      }
    }
    return { occurrenceId, requestIds, photoKeys };
  });
}

const getDetail = (id: string, citizen: Citizen) =>
  app.inject({ method: 'GET', url: `/citizen/requests/${id}`, headers: citizen.headers });

const act = (
  id: string,
  action: 'cancel' | 'confirm' | 'contest',
  citizen: Citizen,
  payload: object = { clientActionId: randomUUID() },
) =>
  app.inject({
    method: 'POST',
    url: `/citizen/requests/${id}/${action}`,
    headers: citizen.headers,
    payload,
  });

async function requestStatus(id: string) {
  const [row] = await owner.db
    .select({ status: requests.status })
    .from(requests)
    .where(eq(requests.id, id));
  return row!.status;
}

async function occurrenceStatusOf(id: string) {
  const [row] = await owner.db
    .select({ status: occurrences.status })
    .from(occurrences)
    .where(eq(occurrences.id, id));
  return row!.status;
}

function requestEvents(id: string) {
  return owner.db
    .select()
    .from(statusEvents)
    .where(eq(statusEvents.requestId, id))
    .orderBy(asc(statusEvents.createdAt));
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  demoTenantId = seeded.tenantId;
  const [category] = await owner.db
    .select({ id: categories.id, departmentId: categories.departmentId })
    .from(categories)
    .where(and(eq(categories.tenantId, demoTenantId), eq(categories.name, 'Buraco na via')));
  categoryId = category!.id;
  departmentId = category!.departmentId;
  app = await buildApp({ storage, database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('GET /citizen/requests', () => {
  it('list filters active and done across tenants', async () => {
    const citizen = await createCitizen();
    const [tenant] = await owner.db
      .insert(tenants)
      .values({
        name: 'Município Lista',
        displayName: 'Prefeitura Lista',
        city: 'Lista',
        state: 'MG',
        ibgeCode: `97${String(randomInt(0, 100_000)).padStart(5, '0')}`,
        status: 'active',
      })
      .returning({ id: tenants.id });
    const [department] = await owner.db
      .insert(departments)
      .values({ tenantId: tenant!.id, name: 'Obras' })
      .returning({ id: departments.id });
    const [foreignCategory] = await owner.db
      .insert(categories)
      .values({ tenantId: tenant!.id, departmentId: department!.id, name: 'Iluminação' })
      .returning({ id: categories.id });

    const active = await seedOccurrence('triage', [{ citizenId: citizen.id, status: 'open' }]);
    const done = await seedOccurrence(
      'completed',
      [{ citizenId: citizen.id, status: 'completed' }],
      { tenantId: tenant!.id, categoryId: foreignCategory!.id },
    );

    const list = async (filter?: string) => {
      const res = await app.inject({
        method: 'GET',
        url: filter ? `/citizen/requests?filter=${filter}` : '/citizen/requests',
        headers: citizen.headers,
      });
      expect(res.statusCode).toBe(200);
      return res.json<RequestCard[]>();
    };

    const all = await list();
    expect(all.map((card) => card.id).toSorted()).toEqual(
      [active.requestIds[0]!, done.requestIds[0]!].toSorted(),
    );
    for (const card of all) requestCardSchema.parse(card);
    expect((await list('active')).map((card) => card.id)).toEqual([active.requestIds[0]]);
    const doneList = await list('done');
    expect(doneList.map((card) => card.id)).toEqual([done.requestIds[0]]);
    expect(doneList[0]).toMatchObject({ categoryName: 'Iluminação', status: 'completed' });
  });

  it('rejects an unknown filter', async () => {
    const citizen = await createCitizen();
    const res = await app.inject({
      method: 'GET',
      url: '/citizen/requests?filter=whatever',
      headers: citizen.headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /citizen/requests/:id', () => {
  it("detail of an open request has only the citizen's photos and the open timeline", async () => {
    const citizen = await createCitizen();
    const point = randomDemoPoint();
    const photoKey = await uploadPhoto(citizen.id);
    const created = await app.inject({
      method: 'POST',
      url: '/citizen/requests',
      headers: citizen.headers,
      payload: {
        clientActionId: randomUUID(),
        categoryId,
        description: 'Poste apagado',
        occurredAt: '2026-10-20T13:45:00.000Z',
        gpsLocation: point,
        location: point,
        address: 'Rua das Flores, 120',
        photoKeys: [photoKey],
        connection,
      },
    });
    expect(created.statusCode).toBe(201);
    const { requestId, protocol } = created.json<CreateRequestResponse>();

    const res = await getDetail(requestId, citizen);
    expect(res.statusCode).toBe(200);
    const detail = requestDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      id: requestId,
      protocol,
      status: 'open',
      categoryName: 'Buraco na via',
      description: 'Poste apagado',
      address: 'Rua das Flores, 120',
      createdAt: '2026-10-20T13:45:00.000Z',
      team: null,
      completion: null,
      rejection: null,
    });
    expect(detail.location.lat).toBeCloseTo(point.lat, 6);
    expect(detail.location.lng).toBeCloseTo(point.lng, 6);
    expect(detail.photos).toHaveLength(1);
    expect(detail.photos[0]!.url).toContain(photoKey);
    expect(detail.timeline.map((event) => event.status)).toEqual(['open']);
  });

  it("detail hides agent note, unpublished photos and other citizens' photos", async () => {
    const citizen = await createCitizen();
    const neighbor = await createCitizen();
    const seeded = await seedOccurrence('awaiting_confirmation', [
      { citizenId: citizen.id, status: 'awaiting_confirmation' },
      { citizenId: neighbor.id, status: 'awaiting_confirmation' },
    ]);
    const publishedKey = `${demoTenantId}/published-${randomUUID()}.jpg`;
    const discardedKey = `${demoTenantId}/discarded-${randomUUID()}.jpg`;
    const agentNote = `Nota interna do agente ${randomUUID()}`;
    await withContext(owner.db, { tenantId: demoTenantId }, async (tx) => {
      const [team] = await tx
        .insert(teams)
        .values({ tenantId: demoTenantId, departmentId, name: 'Equipe Asfalto Norte' })
        .returning({ id: teams.id });
      const [order] = await tx
        .insert(workOrders)
        .values({
          tenantId: demoTenantId,
          occurrenceId: seeded.occurrenceId,
          teamId: team!.id,
          status: 'completed',
          agentNote,
          publicNote: 'Buraco tapado com asfalto.',
          publishedAt: at(25),
          completedAt: at(20),
        })
        .returning({ id: workOrders.id });
      const [agent] = await tx
        .insert(users)
        .values({ name: 'Agente', phone: newPhone() })
        .returning({ id: users.id });
      await tx.insert(photos).values([
        {
          tenantId: demoTenantId,
          workOrderId: order!.id,
          storageKey: publishedKey,
          uploadedBy: agent!.id,
          review: 'published',
          createdAt: at(20),
        },
        {
          tenantId: demoTenantId,
          workOrderId: order!.id,
          storageKey: discardedKey,
          uploadedBy: agent!.id,
          review: 'discarded',
          createdAt: at(20),
        },
      ]);
      await tx.insert(statusEvents).values({
        tenantId: demoTenantId,
        occurrenceId: seeded.occurrenceId,
        workOrderId: order!.id,
        toStatus: 'completed',
        actorUserId: agent!.id,
        comment: agentNote,
        createdAt: at(20),
      });
    });

    const res = await getDetail(seeded.requestIds[0]!, citizen);
    expect(res.statusCode).toBe(200);
    const raw = res.body;
    expect(raw).not.toContain(agentNote);
    expect(raw).not.toContain('Comentário interno do gestor');
    expect(raw).not.toContain(discardedKey);
    expect(raw).not.toContain(seeded.photoKeys[1]!);
    expect(raw).not.toContain(neighbor.id);

    const detail = requestDetailSchema.parse(res.json());
    expect(detail.team).toEqual({ name: 'Equipe Asfalto Norte' });
    expect(detail.photos).toHaveLength(1);
    expect(detail.photos[0]!.url).toContain(seeded.photoKeys[0]!);
    expect(detail.completion).toMatchObject({
      publicNote: 'Buraco tapado com asfalto.',
      publishedAt: at(25).toISOString(),
    });
    expect(detail.completion!.photos).toHaveLength(1);
    expect(detail.completion!.photos[0]!.url).toContain(publishedKey);
    expect(detail.completion!.photos[0]!.takenAt).toBe(at(20).toISOString());
    expect(detail.timeline).toEqual([
      { status: 'open', at: at(0).toISOString() },
      { status: 'awaiting_confirmation', at: at(30).toISOString() },
    ]);
  });

  it('rejected request shows the public reason', async () => {
    const citizen = await createCitizen();
    const seeded = await seedOccurrence(
      'rejected',
      [{ citizenId: citizen.id, status: 'rejected' }],
      undefined,
      { rejectionReason: 'Fora da área de responsabilidade da prefeitura.' },
    );
    const res = await getDetail(seeded.requestIds[0]!, citizen);
    expect(res.statusCode).toBe(200);
    const detail = requestDetailSchema.parse(res.json());
    expect(detail.rejection).toEqual({
      reason: 'Fora da área de responsabilidade da prefeitura.',
      at: at(30).toISOString(),
    });
    expect(detail.completion).toBeNull();
    expect(res.body).not.toContain('Comentário interno do gestor');
  });
});

describe('POST /citizen/requests/:id actions', () => {
  it('cancel last request cancels the occurrence; with another request the occurrence stays', async () => {
    const citizen = await createCitizen();
    const neighbor = await createCitizen();

    const alone = await seedOccurrence('triage', [{ citizenId: citizen.id, status: 'open' }]);
    const res = await act(alone.requestIds[0]!, 'cancel', citizen);
    expect(res.statusCode).toBe(200);
    const card = requestCardSchema.parse(res.json());
    expect(card).toMatchObject({ id: alone.requestIds[0], status: 'cancelled' });
    expect(new Date(card.statusChangedAt).getTime()).toBeGreaterThan(at(0).getTime());
    expect(await requestStatus(alone.requestIds[0]!)).toBe('cancelled');
    expect(await occurrenceStatusOf(alone.occurrenceId)).toBe('cancelled');
    const events = await requestEvents(alone.requestIds[0]!);
    expect(events.at(-1)).toMatchObject({
      fromStatus: 'open',
      toStatus: 'cancelled',
      actorUserId: citizen.id,
    });
    const occurrenceEvents = await owner.db
      .select()
      .from(statusEvents)
      .where(
        and(eq(statusEvents.occurrenceId, alone.occurrenceId), isNull(statusEvents.requestId)),
      );
    expect(occurrenceEvents).toMatchObject([{ fromStatus: 'triage', toStatus: 'cancelled' }]);

    const shared = await seedOccurrence('triage', [
      { citizenId: citizen.id, status: 'open' },
      { citizenId: neighbor.id, status: 'open' },
    ]);
    expect((await act(shared.requestIds[0]!, 'cancel', citizen)).statusCode).toBe(200);
    expect(await requestStatus(shared.requestIds[0]!)).toBe('cancelled');
    expect(await requestStatus(shared.requestIds[1]!)).toBe('open');
    expect(await occurrenceStatusOf(shared.occurrenceId)).toBe('triage');
  });

  it('cancel outside open is 409 invalid_status', async () => {
    const citizen = await createCitizen();
    const seeded = await seedOccurrence('in_progress', [
      { citizenId: citizen.id, status: 'in_progress' },
    ]);
    const res = await act(seeded.requestIds[0]!, 'cancel', citizen);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'invalid_status' });
    expect(await requestStatus(seeded.requestIds[0]!)).toBe('in_progress');
  });

  it('confirm completes the occurrence when nobody else is awaiting', async () => {
    const citizen = await createCitizen();
    const neighbor = await createCitizen();
    const seeded = await seedOccurrence('awaiting_confirmation', [
      { citizenId: citizen.id, status: 'awaiting_confirmation' },
      { citizenId: neighbor.id, status: 'awaiting_confirmation' },
    ]);

    const first = await act(seeded.requestIds[0]!, 'confirm', citizen);
    expect(first.statusCode).toBe(200);
    expect(requestCardSchema.parse(first.json()).status).toBe('completed');
    expect(await occurrenceStatusOf(seeded.occurrenceId)).toBe('awaiting_confirmation');

    expect((await act(seeded.requestIds[1]!, 'confirm', neighbor)).statusCode).toBe(200);
    expect(await requestStatus(seeded.requestIds[1]!)).toBe('completed');
    expect(await occurrenceStatusOf(seeded.occurrenceId)).toBe('completed');
    expect((await requestEvents(seeded.requestIds[1]!)).at(-1)).toMatchObject({
      fromStatus: 'awaiting_confirmation',
      toStatus: 'completed',
      actorUserId: neighbor.id,
    });

    const again = await act(seeded.requestIds[0]!, 'confirm', citizen);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'invalid_status' });
  });

  it('contest reopens occurrence and other awaiting requests with the notice', async () => {
    const citizen = await createCitizen();
    const neighbor = await createCitizen();
    const confirmed = await createCitizen();
    const seeded = await seedOccurrence('awaiting_confirmation', [
      { citizenId: citizen.id, status: 'awaiting_confirmation' },
      { citizenId: neighbor.id, status: 'awaiting_confirmation' },
      { citizenId: confirmed.id, status: 'completed' },
    ]);
    const photoKey = await uploadPhoto(citizen.id);
    const comment = 'O buraco continua no mesmo lugar.';

    const res = await act(seeded.requestIds[0]!, 'contest', citizen, {
      clientActionId: randomUUID(),
      comment,
      photoKeys: [photoKey],
    });
    expect(res.statusCode).toBe(200);
    expect(requestCardSchema.parse(res.json()).status).toBe('open');

    expect(await requestStatus(seeded.requestIds[0]!)).toBe('open');
    expect(await requestStatus(seeded.requestIds[1]!)).toBe('open');
    expect(await requestStatus(seeded.requestIds[2]!)).toBe('completed');
    expect(await occurrenceStatusOf(seeded.occurrenceId)).toBe('triage');

    expect((await requestEvents(seeded.requestIds[0]!)).at(-1)).toMatchObject({
      fromStatus: 'awaiting_confirmation',
      toStatus: 'open',
      actorUserId: citizen.id,
      comment,
    });
    const neighborEvent = (await requestEvents(seeded.requestIds[1]!)).at(-1);
    expect(neighborEvent).toMatchObject({
      fromStatus: 'awaiting_confirmation',
      toStatus: 'open',
      comment: CONTEST_NOTICE,
    });
    expect(neighborEvent!.comment).not.toContain(comment);
    expect((await requestEvents(seeded.requestIds[2]!)).at(-1)!.toStatus).toBe('completed');

    const stored = await owner.db.select().from(photos).where(eq(photos.storageKey, photoKey));
    expect(stored).toMatchObject([
      { requestId: seeded.requestIds[0], uploadedBy: citizen.id, review: null },
    ]);

    // O vizinho não vê o comentário de quem contestou, só o aviso.
    const neighborDetail = await getDetail(seeded.requestIds[1]!, neighbor);
    expect(neighborDetail.body).not.toContain(comment);
  });

  it('contest validates comment and photos', async () => {
    const citizen = await createCitizen();
    const other = await createCitizen();
    const seeded = await seedOccurrence('awaiting_confirmation', [
      { citizenId: citizen.id, status: 'awaiting_confirmation' },
    ]);
    const id = seeded.requestIds[0]!;
    const short = await act(id, 'contest', citizen, {
      clientActionId: randomUUID(),
      comment: 'ok',
      photoKeys: [],
    });
    expect(short.statusCode).toBe(400);

    const foreign = await act(id, 'contest', citizen, {
      clientActionId: randomUUID(),
      comment: 'Continua igual',
      photoKeys: [await uploadPhoto(other.id)],
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json()).toEqual({ code: 'photo_missing' });

    // A foto da semeadura nunca foi enviada ao armazenamento.
    const notUploaded = await act(id, 'contest', citizen, {
      clientActionId: randomUUID(),
      comment: 'Continua igual',
      photoKeys: [seeded.photoKeys[0]!],
    });
    expect(notUploaded.statusCode).toBe(422);
    expect(notUploaded.json()).toEqual({ code: 'photo_missing' });

    // Foto enviada, mas já ligada a outra solicitação.
    const usedKey = await uploadPhoto(citizen.id);
    const elsewhere = await seedOccurrence('triage', [{ citizenId: citizen.id, status: 'open' }]);
    await owner.db.insert(photos).values({
      tenantId: demoTenantId,
      requestId: elsewhere.requestIds[0]!,
      storageKey: usedKey,
      uploadedBy: citizen.id,
    });
    const used = await act(id, 'contest', citizen, {
      clientActionId: randomUUID(),
      comment: 'Continua igual',
      photoKeys: [usedKey],
    });
    expect(used.statusCode).toBe(409);
    expect(used.json()).toEqual({ code: 'photo_already_used' });
    expect(await requestStatus(id)).toBe('awaiting_confirmation');
  });

  it("other citizen's request is 404 for every action", async () => {
    const citizen = await createCitizen();
    const stranger = await createCitizen();
    const seeded = await seedOccurrence('awaiting_confirmation', [
      { citizenId: citizen.id, status: 'awaiting_confirmation' },
    ]);
    const id = seeded.requestIds[0]!;

    const detail = await getDetail(id, stranger);
    expect(detail.statusCode).toBe(404);
    expect(detail.json()).toEqual({ code: 'request_not_found' });
    for (const action of ['cancel', 'confirm'] as const) {
      const res = await act(id, action, stranger);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'request_not_found' });
    }
    const contest = await act(id, 'contest', stranger, {
      clientActionId: randomUUID(),
      comment: 'Não foi resolvido',
      photoKeys: [],
    });
    expect(contest.statusCode).toBe(404);
    expect(contest.json()).toEqual({ code: 'request_not_found' });
    expect((await getDetail(randomUUID(), citizen)).statusCode).toBe(404);
    expect(await requestStatus(id)).toBe('awaiting_confirmation');
  });

  it('repeating an action with the same clientActionId is harmless', async () => {
    const citizen = await createCitizen();
    const seeded = await seedOccurrence('triage', [{ citizenId: citizen.id, status: 'open' }]);
    const id = seeded.requestIds[0]!;
    const payload = { clientActionId: randomUUID() };

    const first = await act(id, 'cancel', citizen, payload);
    expect(first.statusCode).toBe(200);
    const second = await act(id, 'cancel', citizen, payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const cancelledEvents = (await requestEvents(id)).filter((e) => e.toStatus === 'cancelled');
    expect(cancelledEvents).toHaveLength(1);
    const actions = await owner.db
      .select()
      .from(clientActions)
      .where(eq(clientActions.id, payload.clientActionId));
    expect(actions).toMatchObject([{ kind: 'cancel_request', targetId: id, userId: citizen.id }]);

    // O mesmo id usado para outra ação é conflito.
    const conflict = await act(id, 'confirm', citizen, payload);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ code: 'client_action_conflict' });
  });
});
