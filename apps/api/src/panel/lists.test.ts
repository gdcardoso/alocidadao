import {
  createDatabase,
  parseIbgeNeighborhoods,
  schema,
  upsertIbgeNeighborhoods,
  withContext,
} from '@alocidadao/db';
import {
  categoryOptionsResponseSchema,
  inProgressResponseSchema,
  neighborhoodsResponseSchema,
  NO_NEIGHBORHOOD,
  requestListResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { daysAgo, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.0, lng: -47.0 };

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function get(url: string, userId: string, tenantId: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: await panelAuthHeader(appDb.db, userId, tenantId),
  });
}

async function inProgress(query: string, userId: string, tenantId: string) {
  const res = await get(`/panel/in-progress${query}`, userId, tenantId);
  expect(res.statusCode).toBe(200);
  return inProgressResponseSchema.parse(res.json());
}

async function requestList(query: string, userId: string, tenantId: string) {
  const res = await get(`/panel/requests${query}`, userId, tenantId);
  expect(res.statusCode).toBe(200);
  return requestListResponseSchema.parse(res.json());
}

/** Grava o bairro direto (o gatilho só roda quando a localização muda). */
async function setNeighborhood(tenantId: string, occurrenceId: string, name: string | null) {
  await withContext(owner.db, { tenantId }, (tx) =>
    tx
      .update(schema.occurrences)
      .set({ neighborhood: name })
      .where(eq(schema.occurrences.id, occurrenceId)),
  );
}

type Seed = Awaited<ReturnType<typeof fx.seedPanelTenant>>;

/** Ocorrência com `reports` solicitações; a primeira é a mais antiga. */
async function withReports(
  seed: Seed,
  input: Parameters<typeof fx.addOccurrence>[1] & {
    address?: string;
    reports?: number;
    requestStatus?: Parameters<typeof fx.addRequest>[1]['status'];
  },
) {
  const id = await fx.addOccurrence(seed.tenantId, input);
  const created = [];
  for (let i = 0; i < (input.reports ?? 1); i++) {
    created.push(
      await fx.addRequest(seed.tenantId, {
        occurrenceId: id,
        categoryId: input.categoryId,
        citizenId: seed.citizenId,
        at: input.at,
        address: input.address ?? 'Rua Qualquer, 1',
        status: input.requestStatus,
        createdAt: new Date((input.createdAt ?? new Date()).getTime() + i * 60_000),
      }),
    );
  }
  return { id, requests: created };
}

/** Ocorrência em atendimento com atividade ativa. */
async function working(
  seed: Seed & { teamId: string },
  input: {
    status: Parameters<typeof fx.addWorkOrder>[1]['status'];
    dueAt?: Date;
    since: Date;
    categoryId?: string;
    address?: string;
  },
) {
  const occurrence = await withReports(seed, {
    categoryId: input.categoryId ?? seed.potholeId,
    at: CENTER,
    status: 'in_progress',
    createdAt: daysAgo(20),
    address: input.address,
  });
  await fx.addOccurrenceEvent(seed.tenantId, {
    occurrenceId: occurrence.id,
    toStatus: 'in_progress',
    at: input.since,
  });
  await fx.addWorkOrder(seed.tenantId, {
    occurrenceId: occurrence.id,
    teamId: seed.teamId,
    status: input.status,
    dueAt: input.dueAt,
  });
  return occurrence;
}

async function seedBase() {
  const seed = await fx.seedPanelTenant();
  const teamId = await fx.addTeam(seed.tenantId, {
    departmentId: seed.worksId,
    name: 'Equipe Norte',
  });
  const adminId = await fx.newAdmin(seed.tenantId);
  return { ...seed, teamId, adminId };
}

describe('in progress list', () => {
  it('in progress lists by due date with no due date last', async () => {
    const seed = await seedBase();
    const { tenantId, adminId } = seed;
    const noDueOld = await working(seed, { status: 'assigned', since: daysAgo(9) });
    const noDueNew = await working(seed, { status: 'assigned', since: daysAgo(2) });
    const late = await working(seed, {
      status: 'in_execution',
      dueAt: daysAgo(3),
      since: daysAgo(5),
    });
    const soon = await working(seed, {
      status: 'impeded',
      dueAt: new Date(Date.now() + 2 * 86_400_000),
      since: daysAgo(1),
    });
    // Em triagem e concluída não entram.
    await withReports(seed, { categoryId: seed.potholeId, at: CENTER });

    const result = await inProgress('', adminId, tenantId);
    expect(result.total).toBe(4);
    expect(result.items.map((item) => item.occurrenceId)).toEqual([
      late.id,
      soon.id,
      noDueOld.id,
      noDueNew.id,
    ]);
    expect(result.items[0]).toMatchObject({
      protocol: late.requests[0]!.protocol,
      categoryName: 'Buraco',
      teamName: 'Equipe Norte',
      workOrderStatus: 'in_execution',
      address: 'Rua Qualquer, 1',
    });
    expect(result.items[0]!.dueAt).not.toBeNull();
    expect(result.items[2]!.dueAt).toBeNull();
    expect(Date.parse(result.items[0]!.statusSince)).toBeCloseTo(daysAgo(5).getTime(), -4);
    expect(JSON.stringify(result)).not.toMatch(/phone|email|Maria/i);
  });

  it('in progress filters by work order status', async () => {
    const seed = await seedBase();
    const { tenantId, adminId } = seed;
    const execution = await working(seed, { status: 'in_execution', since: daysAgo(1) });
    await working(seed, { status: 'impeded', since: daysAgo(1) });
    const lamp = await working(seed, {
      status: 'in_execution',
      since: daysAgo(1),
      categoryId: seed.lampId,
    });

    const byStatus = await inProgress('?workOrderStatus=in_execution', adminId, tenantId);
    expect(byStatus.items.map((item) => item.occurrenceId).toSorted()).toEqual(
      [execution.id, lamp.id].toSorted(),
    );
    expect(byStatus.total).toBe(2);
    const byCategory = await inProgress(`?categoryId=${seed.lampId}`, adminId, tenantId);
    expect(byCategory.items.map((item) => item.occurrenceId)).toEqual([lamp.id]);
    const invalid = await get('/panel/in-progress?workOrderStatus=completed', adminId, tenantId);
    expect(invalid.statusCode).toBe(400);
  });
});

describe('request list', () => {
  it('request list pages 50 at a time, newest first', async () => {
    const seed = await seedBase();
    const { tenantId, adminId, potholeId } = seed;
    const occurrence = await fx.addOccurrence(tenantId, { categoryId: potholeId, at: CENTER });
    const base = Date.now() - 20 * 86_400_000;
    for (let i = 0; i < 55; i++) {
      await fx.addRequest(tenantId, {
        occurrenceId: occurrence,
        categoryId: potholeId,
        citizenId: seed.citizenId,
        at: CENTER,
        address: `Rua ${i}`,
        createdAt: new Date(base + i * 60_000),
      });
    }
    const first = await requestList('', adminId, tenantId);
    expect(first).toMatchObject({ total: 55, page: 1, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]!.address).toBe('Rua 54');
    expect(first.items[0]).toMatchObject({
      occurrenceId: occurrence,
      categoryName: 'Buraco',
      categoryId: expect.any(String),
    });
    const second = await requestList('?page=2', adminId, tenantId);
    expect(second.page).toBe(2);
    expect(second.items.map((item) => item.address)).toEqual([
      'Rua 4',
      'Rua 3',
      'Rua 2',
      'Rua 1',
      'Rua 0',
    ]);
    expect((await requestList('?page=3', adminId, tenantId)).items).toEqual([]);
  });

  it('request list filters by status, category, period and protocol prefix', async () => {
    const seed = await seedBase();
    const { tenantId, adminId, potholeId, lampId } = seed;
    const recent = await withReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      address: 'Rua das Flores, 100',
      createdAt: daysAgo(2),
    });
    const resolved = await withReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      address: 'Avenida Brasil, 5',
      createdAt: daysAgo(10),
      requestStatus: 'completed',
    });
    const lamp = await withReports(seed, {
      categoryId: lampId,
      at: CENTER,
      address: 'Praça Central',
      createdAt: daysAgo(40),
    });
    const ids = (r: Awaited<ReturnType<typeof requestList>>) =>
      r.items.map((item) => item.requestId);

    // Padrão: 30 dias, pela criação da solicitação.
    expect(ids(await requestList('', adminId, tenantId))).toEqual([
      recent.requests[0]!.id,
      resolved.requests[0]!.id,
    ]);
    expect(ids(await requestList('?days=all', adminId, tenantId))).toHaveLength(3);
    expect(ids(await requestList('?days=7', adminId, tenantId))).toEqual([recent.requests[0]!.id]);
    expect(ids(await requestList('?days=all&status=completed', adminId, tenantId))).toEqual([
      resolved.requests[0]!.id,
    ]);
    expect(ids(await requestList(`?days=all&categoryId=${lampId}`, adminId, tenantId))).toEqual([
      lamp.requests[0]!.id,
    ]);
    // Endereço (3 letras ou mais) e prefixo de protocolo.
    expect(ids(await requestList('?q=flores', adminId, tenantId))).toEqual([
      recent.requests[0]!.id,
    ]);
    const protocol = resolved.requests[0]!.protocol;
    expect(ids(await requestList(`?q=${protocol}`, adminId, tenantId))).toEqual([
      resolved.requests[0]!.id,
    ]);
    const filtered = await requestList('?days=all&status=completed&q=brasil', adminId, tenantId);
    expect(filtered.total).toBe(1);
    expect((await requestList('?q=zzz', adminId, tenantId)).total).toBe(0);
  });

  it('lists ignore other departments', async () => {
    const seed = await seedBase();
    const { tenantId, lampId, lightsId } = seed;
    await working(seed, { status: 'assigned', since: daysAgo(1) });
    const lamp = await working(seed, {
      status: 'assigned',
      since: daysAgo(1),
      categoryId: lampId,
    });
    const lightsManager = await fx.newManager(tenantId, [lightsId]);

    const inProg = await inProgress('', lightsManager, tenantId);
    expect(inProg.items.map((item) => item.occurrenceId)).toEqual([lamp.id]);
    expect(inProg.total).toBe(1);
    const list = await requestList('?days=all', lightsManager, tenantId);
    expect(list.items.map((item) => item.requestId)).toEqual([lamp.requests[0]!.id]);
    expect(list.total).toBe(1);

    const none = await fx.newManager(tenantId, []);
    expect((await inProgress('', none, tenantId)).items).toEqual([]);
    expect((await requestList('?days=all', none, tenantId)).total).toBe(0);

    // Outra prefeitura não aparece.
    const other = await seedBase();
    expect((await inProgress('', other.adminId, other.tenantId)).items).toEqual([]);
  });
});

describe('category options', () => {
  it('category options are scoped and alphabetical', async () => {
    const seed = await seedBase();
    const adminId = seed.adminId;
    const managerId = await fx.newManager(seed.tenantId, [seed.lightsId]);
    const all = await get('/panel/category-options', adminId, seed.tenantId);
    expect(all.statusCode).toBe(200);
    expect(categoryOptionsResponseSchema.parse(all.json()).items.map((i) => i.name)).toEqual([
      'Buraco',
      'Poste apagado',
    ]);
    const scoped = await get('/panel/category-options', managerId, seed.tenantId);
    expect(categoryOptionsResponseSchema.parse(scoped.json()).items).toEqual([
      { id: seed.lampId, name: 'Poste apagado' },
    ]);
  });
});

describe('neighborhood filter', () => {
  it('in-progress and requests lists filter by neighborhood', async () => {
    const seed = await seedBase();
    const { tenantId, adminId } = seed;
    const centro = await working(seed, { status: 'in_execution', since: daysAgo(1) });
    const alvorada = await working(seed, { status: 'in_execution', since: daysAgo(1) });
    const none = await working(seed, { status: 'in_execution', since: daysAgo(1) });
    await setNeighborhood(tenantId, centro.id, 'Centro');
    await setNeighborhood(tenantId, alvorada.id, 'Alvorada');

    const byName = await inProgress('?neighborhood=Centro', adminId, tenantId);
    expect(byName.items.map((item) => item.occurrenceId)).toEqual([centro.id]);
    expect(byName.total).toBe(1);
    const byNone = await inProgress(`?neighborhood=${NO_NEIGHBORHOOD}`, adminId, tenantId);
    expect(byNone.items.map((item) => item.occurrenceId)).toEqual([none.id]);

    const requests = await requestList('?neighborhood=Alvorada', adminId, tenantId);
    expect(requests.items.map((item) => item.requestId)).toEqual(
      alvorada.requests.map((r) => r.id),
    );
    expect(requests.total).toBe(1);
    const noneRequests = await requestList(`?neighborhood=${NO_NEIGHBORHOOD}`, adminId, tenantId);
    expect(noneRequests.items.map((item) => item.requestId)).toEqual(
      none.requests.map((r) => r.id),
    );
    expect((await requestList('', adminId, tenantId)).total).toBe(3);
  });
});

describe('GET /panel/neighborhoods', () => {
  it('GET /panel/neighborhoods lists the effective names', async () => {
    const seed = await seedBase();
    const { tenantId, adminId } = seed;
    const square = (x: number) =>
      sql`ST_Multi(ST_GeomFromText(${`POLYGON((${x} 0,${x + 1} 0,${x + 1} 1,${x} 0))`}, 4326))`;
    await withContext(owner.db, { tenantId }, (tx) =>
      tx.insert(schema.tenantNeighborhoods).values(
        ['Zumbi', 'Água Branca', 'Centro'].map((name, i) => ({
          tenantId,
          name,
          boundary: square(i * 2),
        })),
      ),
    );
    const res = await get('/panel/neighborhoods', adminId, tenantId);
    expect(res.statusCode).toBe(200);
    expect(neighborhoodsResponseSchema.parse(res.json())).toEqual({
      items: ['Água Branca', 'Centro', 'Zumbi'],
      source: 'tenant',
    });
  });

  it('GET /panel/neighborhoods returns distinct names when two IBGE neighborhoods share one', async () => {
    const seed = await seedBase();
    const ibgeCode = String(randomInt(1_000_000, 9_999_999));
    await owner.db
      .update(schema.tenants)
      .set({ ibgeCode })
      .where(eq(schema.tenants.id, seed.tenantId));
    const square = (x: number) => ({
      type: 'Polygon',
      coordinates: [
        [
          [x, 0],
          [x + 1, 0],
          [x + 1, 1],
          [x, 1],
          [x, 0],
        ],
      ],
    });
    await upsertIbgeNeighborhoods(
      owner.db,
      parseIbgeNeighborhoods({
        type: 'FeatureCollection',
        features: ['00001', '00002'].map((suffix, i) => ({
          type: 'Feature',
          properties: { CD_MUN: ibgeCode, CD_BAIRRO: `${ibgeCode}${suffix}`, NM_BAIRRO: 'Centro' },
          geometry: square(i * 2),
        })),
      }),
    );
    const res = await get('/panel/neighborhoods', seed.adminId, seed.tenantId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: ['Centro'], source: 'ibge' });
  });

  it('GET /panel/neighborhoods is empty for a tenant without neighborhoods', async () => {
    const seed = await seedBase();
    const res = await get('/panel/neighborhoods', seed.adminId, seed.tenantId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], source: null });
  });
});
