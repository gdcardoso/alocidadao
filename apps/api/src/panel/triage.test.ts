import { createDatabase } from '@alocidadao/db';
import {
  occurrenceMapResponseSchema,
  panelCountsSchema,
  triageResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { daysAgo, metersNorth, panelFixtures } from '../test/panel-fixtures.js';
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

async function triage(query: string, userId: string, tenantId: string) {
  const res = await get(`/panel/triage${query}`, userId, tenantId);
  expect(res.statusCode).toBe(200);
  return triageResponseSchema.parse(res.json());
}

type Seed = Awaited<ReturnType<typeof fx.seedPanelTenant>>;

/** Ocorrência com um relato no centro dela. */
async function withReport(
  seed: Seed,
  input: Parameters<typeof fx.addOccurrence>[1] & { address?: string },
) {
  const id = await fx.addOccurrence(seed.tenantId, input);
  const request = await fx.addRequest(seed.tenantId, {
    occurrenceId: id,
    categoryId: input.categoryId,
    citizenId: seed.citizenId,
    at: input.at,
    address: input.address ?? 'Rua Qualquer, 1',
    createdAt: input.createdAt,
  });
  return { id, request };
}

/**
 * Três em triagem: `oldest` (3 dias) no centro, `middle` (2 dias) 30 m ao norte e `newest`, criada
 * há 10 dias mas de volta à triagem há 1 dia, longe. Uma em atendimento 30 m ao sul do centro, uma
 * juntada no centro e um poste no centro.
 */
async function seedTriage() {
  const seed = await fx.seedPanelTenant();
  const { tenantId, potholeId, lampId } = seed;
  const oldest = await withReport(seed, {
    categoryId: potholeId,
    at: CENTER,
    createdAt: daysAgo(3),
    address: 'Rua das Flores, 100',
  });
  // Segundo relato, mais novo: o protocolo da linha é o do mais antigo.
  await fx.addRequest(tenantId, {
    occurrenceId: oldest.id,
    categoryId: potholeId,
    citizenId: seed.citizenId,
    at: CENTER,
    address: 'Rua das Flores, 110',
    createdAt: daysAgo(2.5),
  });
  const middle = await withReport(seed, {
    categoryId: potholeId,
    at: metersNorth(CENTER, 30),
    createdAt: daysAgo(2),
  });
  const newest = await withReport(seed, {
    categoryId: potholeId,
    at: metersNorth(CENTER, 3000),
    createdAt: daysAgo(10),
  });
  await fx.addOccurrenceEvent(tenantId, {
    occurrenceId: newest.id,
    toStatus: 'triage',
    at: daysAgo(1),
  });
  await withReport(seed, {
    categoryId: potholeId,
    at: metersNorth(CENTER, -30),
    status: 'in_progress',
  });
  await withReport(seed, {
    categoryId: potholeId,
    at: CENTER,
    status: 'merged',
    mergedIntoId: oldest.id,
  });
  const lamp = await withReport(seed, { categoryId: lampId, at: CENTER, createdAt: daysAgo(0.5) });
  return { seed, oldest, middle, newest, lamp };
}

describe('GET /panel/triage', () => {
  it('triage orders by statusSince and counts suggestions', async () => {
    const { seed, oldest, middle, newest, lamp } = await seedTriage();
    const adminId = await fx.newAdmin(seed.tenantId);

    const body = await triage('', adminId, seed.tenantId);
    expect(body.total).toBe(4);
    expect(body.items.map((row) => row.occurrenceId)).toEqual([
      oldest.id,
      middle.id,
      newest.id,
      lamp.id,
    ]);
    expect(body.items[0]).toEqual({
      occurrenceId: oldest.id,
      protocol: oldest.request.protocol,
      categoryName: 'Buraco',
      icon: 'construction',
      iconGroup: 'infrastructure',
      address: 'Rua das Flores, 100',
      departmentName: 'Obras',
      requestCount: 2,
      // A do meio (30 m) e a em atendimento (30 m); a juntada não conta.
      suggestionCount: 2,
      statusSince: expect.any(String),
    });
    // A do meio está a 60 m da em atendimento, fora do raio de 50 m.
    expect(body.items.map((row) => row.suggestionCount)).toEqual([2, 1, 0, 0]);
    expect(Math.abs(Date.parse(body.items[2]!.statusSince) - daysAgo(1).getTime())).toBeLessThan(
      60_000,
    );
    expect(body.items[3]!.departmentName).toBe('Iluminação');

    // Par descartado deixa de contar.
    await fx.separate(seed.tenantId, oldest.id, middle.id);
    const after = await triage('', adminId, seed.tenantId);
    expect(after.items.map((row) => row.suggestionCount)).toEqual([1, 0, 0, 0]);
  });

  it('triage onlySuggestions keeps rows with suggestions', async () => {
    const { seed, oldest, middle } = await seedTriage();
    const adminId = await fx.newAdmin(seed.tenantId);

    const only = await triage('?onlySuggestions=true', adminId, seed.tenantId);
    expect(only.total).toBe(2);
    expect(only.items.map((row) => row.occurrenceId)).toEqual([oldest.id, middle.id]);

    const lamps = await triage(
      `?onlySuggestions=true&categoryId=${seed.lampId}`,
      adminId,
      seed.tenantId,
    );
    expect(lamps).toEqual({ total: 0, items: [] });

    const potholes = await triage(`?categoryId=${seed.potholeId}`, adminId, seed.tenantId);
    expect(potholes.total).toBe(3);

    const invalid = await get('/panel/triage?onlySuggestions=sim', adminId, seed.tenantId);
    expect(invalid.statusCode).toBe(400);
  });

  it('counts, map and triage ignore other departments', async () => {
    const { seed, oldest, middle, newest, lamp } = await seedTriage();
    const { tenantId, worksId, lightsId } = seed;

    const worksManager = await fx.newManager(tenantId, [worksId]);
    const counts = panelCountsSchema.parse(
      (await get('/panel/counts', worksManager, tenantId)).json(),
    );
    expect(counts.triage).toBe(3);
    const map = occurrenceMapResponseSchema.parse(
      (await get('/panel/occurrences?status=open', worksManager, tenantId)).json(),
    );
    expect(map.items.map((item) => item.id).toSorted()).toEqual(
      [oldest.id, middle.id, newest.id].toSorted(),
    );
    const rows = await triage('', worksManager, tenantId);
    expect(rows.items.map((row) => row.occurrenceId)).toEqual([oldest.id, middle.id, newest.id]);
    // Categoria de outro setor no filtro: nada.
    expect(await triage(`?categoryId=${seed.lampId}`, worksManager, tenantId)).toEqual({
      total: 0,
      items: [],
    });

    const lightsManager = await fx.newManager(tenantId, [lightsId]);
    expect(
      (await triage('', lightsManager, tenantId)).items.map((row) => row.occurrenceId),
    ).toEqual([lamp.id]);

    const lone = await fx.newManager(tenantId, []);
    expect(await triage('', lone, tenantId)).toEqual({ total: 0, items: [] });
    const loneMap = occurrenceMapResponseSchema.parse(
      (await get('/panel/occurrences', lone, tenantId)).json(),
    );
    expect(loneMap).toEqual({ total: 0, items: [] });
  });
});
