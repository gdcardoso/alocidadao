import { randomUUID } from 'node:crypto';
import { createDatabase } from '@alocidadao/db';
import {
  occurrenceDetailSchema,
  occurrenceMapResponseSchema,
  panelSearchResponseSchema,
  teamOptionsResponseSchema,
  type GeoPoint,
} from '@alocidadao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { panelAuthHeader } from '../test/panel.js';
import { daysAgo, metersNorth, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.0, lng: -47.0 };

beforeAll(async () => {
  app = await buildApp({ storage, database: appDb.db, auth: testAuthOptions });
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

/** Ocorrência com `reports` relatos (o primeiro no centro dela), criados na ordem dada. */
async function occurrenceWithReports(
  seed: Awaited<ReturnType<typeof fx.seedPanelTenant>>,
  input: Parameters<typeof fx.addOccurrence>[1] & { reports?: number; address?: string },
) {
  const occurrenceId = await fx.addOccurrence(seed.tenantId, input);
  const created = [];
  for (let i = 0; i < (input.reports ?? 1); i++) {
    created.push(
      await fx.addRequest(seed.tenantId, {
        occurrenceId,
        categoryId: input.categoryId,
        citizenId: seed.citizenId,
        at: input.at,
        address: input.address ?? 'Rua Qualquer, 1',
        description: `Relato ${i + 1}`,
        createdAt: new Date((input.createdAt ?? new Date()).getTime() + i * 60_000),
      }),
    );
  }
  return { id: occurrenceId, requests: created };
}

describe('GET /panel/occurrences', () => {
  it('map lists open and in-progress occurrences of the last 30 days', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId } = seed;
    const adminId = await fx.newAdmin(tenantId);

    const openAt = metersNorth(CENTER, 100);
    const open = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: openAt,
      createdAt: daysAgo(2),
      reports: 2,
    });
    // Relato cancelado não conta.
    await fx.addRequest(tenantId, {
      occurrenceId: open.id,
      categoryId: potholeId,
      citizenId: seed.citizenId,
      at: openAt,
      status: 'cancelled',
    });

    const working = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 300),
      status: 'in_progress',
      createdAt: daysAgo(10),
    });
    const startedAt = daysAgo(5);
    await fx.addOccurrenceEvent(tenantId, {
      occurrenceId: working.id,
      toStatus: 'in_progress',
      at: daysAgo(7),
    });
    await fx.addOccurrenceEvent(tenantId, {
      occurrenceId: working.id,
      toStatus: 'in_progress',
      at: startedAt,
    });
    // Evento da solicitação, mais novo: não conta para o statusSince da ocorrência.
    await fx.addOccurrenceEvent(tenantId, {
      occurrenceId: working.id,
      requestId: working.requests[0]!.id,
      toStatus: 'in_progress',
      at: daysAgo(1),
    });

    // Fora: antiga demais, concluída, recusada.
    await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      createdAt: daysAgo(40),
    });
    await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER, status: 'completed' });
    await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER, status: 'rejected' });

    const res = await get('/panel/occurrences', adminId, tenantId);
    expect(res.statusCode).toBe(200);
    const body = occurrenceMapResponseSchema.parse(res.json());
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id).toSorted()).toEqual([open.id, working.id].toSorted());

    const openPoint = body.items.find((item) => item.id === open.id)!;
    expect(openPoint).toEqual({
      id: open.id,
      location: { lat: expect.closeTo(openAt.lat, 6), lng: expect.closeTo(openAt.lng, 6) },
      categoryId: potholeId,
      categoryName: 'Buraco',
      icon: 'construction',
      iconGroup: 'infrastructure',
      status: 'triage',
      requestCount: 2,
      statusSince: expect.any(String),
    });
    // Sem evento, vale a criação da ocorrência.
    expect(Math.abs(Date.parse(openPoint.statusSince) - daysAgo(2).getTime())).toBeLessThan(60_000);

    const workingPoint = body.items.find((item) => item.id === working.id)!;
    expect(workingPoint.status).toBe('in_progress');
    expect(workingPoint.requestCount).toBe(1);
    expect(workingPoint.statusSince).toBe(startedAt.toISOString());
  });

  it('map filters by category and period and never returns merged', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId } = seed;
    const adminId = await fx.newAdmin(tenantId);

    const recent = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      createdAt: daysAgo(5),
    });
    const lamp = await occurrenceWithReports(seed, {
      categoryId: lampId,
      at: CENTER,
      createdAt: daysAgo(5),
    });
    const old = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      createdAt: daysAgo(60),
    });
    const working = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'in_progress',
      createdAt: daysAgo(1),
    });
    await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'merged',
      mergedIntoId: recent.id,
      createdAt: daysAgo(1),
    });

    const ids = async (query: string) => {
      const res = await get(`/panel/occurrences${query}`, adminId, tenantId);
      expect(res.statusCode).toBe(200);
      const body = occurrenceMapResponseSchema.parse(res.json());
      expect(body.total).toBe(body.items.length);
      return body.items.map((item) => item.id).toSorted();
    };

    expect(await ids(`?categoryId=${potholeId}`)).toEqual([recent.id, working.id].toSorted());
    expect(await ids('?status=open&days=7')).toEqual([recent.id, lamp.id].toSorted());
    expect(await ids(`?status=open&days=all&categoryId=${potholeId}`)).toEqual(
      [recent.id, old.id].toSorted(),
    );
    expect(await ids('?status=in_progress&days=90')).toEqual([working.id]);
    expect(await ids('?days=all')).toEqual([recent.id, lamp.id, old.id, working.id].toSorted());

    const invalid = await get('/panel/occurrences?days=15', adminId, tenantId);
    expect(invalid.statusCode).toBe(400);
  });
});

describe('GET /panel/search', () => {
  it('search by protocol prefix and by address', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId, lightsId } = seed;
    const adminId = await fx.newAdmin(tenantId);

    const flowers = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      address: 'Rua das Flores, 100',
      reports: 2,
      createdAt: daysAgo(3),
    });
    const avenue = await occurrenceWithReports(seed, {
      categoryId: lampId,
      at: metersNorth(CENTER, 500),
      address: 'Avenida Brasil, 2000',
    });
    const merged = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      address: 'Rua das Flores, 200',
      status: 'merged',
      mergedIntoId: flowers.id,
    });

    const search = async (q: string, userId = adminId) => {
      const res = await get(`/panel/search?q=${encodeURIComponent(q)}`, userId, tenantId);
      expect(res.statusCode).toBe(200);
      return panelSearchResponseSchema.parse(res.json()).items;
    };

    // Endereço: sem diferenciar maiúsculas, um resultado por ocorrência (o relato mais antigo).
    const byAddress = await search('rua das FLORES');
    expect(byAddress).toEqual([
      {
        occurrenceId: flowers.id,
        protocol: flowers.requests[0]!.protocol,
        categoryName: 'Buraco',
        address: 'Rua das Flores, 100',
        location: { lat: expect.closeTo(CENTER.lat, 6), lng: expect.closeTo(CENTER.lng, 6) },
      },
    ]);
    expect(await search('Fl')).toEqual([]);
    expect(await search('100%')).toEqual([]);

    // Protocolo inteiro e prefixo.
    const avenueProtocol = avenue.requests[0]!.protocol;
    expect((await search(avenueProtocol)).map((item) => item.occurrenceId)).toEqual([avenue.id]);
    const prefix = avenueProtocol.slice(0, 7);
    const byPrefix = await search(prefix);
    expect(byPrefix.map((item) => item.occurrenceId).toSorted()).toEqual(
      [flowers.id, avenue.id].toSorted(),
    );
    expect(byPrefix.map((item) => item.occurrenceId)).not.toContain(merged.id);
    // O protocolo do relato da ocorrência juntada não é achado.
    expect(await search(merged.requests[0]!.protocol)).toEqual([]);

    // Fora do alcance: o gestor de Iluminação não acha o buraco.
    const lightsManager = await fx.newManager(tenantId, [lightsId]);
    expect(await search('Flores', lightsManager)).toEqual([]);
    expect((await search('Avenida', lightsManager)).map((item) => item.occurrenceId)).toEqual([
      avenue.id,
    ]);
  });
});

describe('GET /panel/occurrences/:id', () => {
  it('detail returns requests with distance and suggestions without citizen identity', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId, worksId } = seed;
    const adminId = await fx.newAdmin(tenantId);

    const occurrenceId = await fx.addOccurrence(tenantId, {
      categoryId: potholeId,
      at: CENTER,
      createdAt: daysAgo(2),
    });
    const first = await fx.addRequest(tenantId, {
      occurrenceId,
      categoryId: potholeId,
      citizenId: seed.citizenId,
      at: CENTER,
      address: 'Rua das Flores, 100',
      description: 'Buraco fundo na esquina',
      createdAt: daysAgo(2),
    });
    const second = await fx.addRequest(tenantId, {
      occurrenceId,
      categoryId: potholeId,
      citizenId: seed.citizenId,
      at: metersNorth(CENTER, 15),
      address: 'Rua das Flores, 120',
      description: '',
      createdAt: daysAgo(1),
    });
    await fx.addRequest(tenantId, {
      occurrenceId,
      categoryId: potholeId,
      citizenId: seed.citizenId,
      at: CENTER,
      status: 'cancelled',
      createdAt: daysAgo(3),
    });
    const photoKey = await fx.addReportPhoto(tenantId, {
      requestId: first.id,
      uploadedBy: seed.citizenId,
      createdAt: daysAgo(2),
    });
    await fx.addReportPhoto(tenantId, {
      requestId: first.id,
      uploadedBy: seed.citizenId,
      createdAt: daysAgo(1),
    });

    // Sugestões: parecida a 30 m (2 relatos); a 40 m descartada; poste perto; buraco a 80 m.
    const near = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 30),
      reports: 2,
    });
    const dismissed = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, -40),
    });
    await fx.separate(tenantId, occurrenceId, dismissed.id);
    await occurrenceWithReports(seed, { categoryId: lampId, at: metersNorth(CENTER, 5) });
    await occurrenceWithReports(seed, { categoryId: potholeId, at: metersNorth(CENTER, 80) });

    const res = await get(`/panel/occurrences/${occurrenceId}`, adminId, tenantId);
    expect(res.statusCode).toBe(200);
    for (const secret of [seed.citizen.name, seed.citizen.phone, seed.citizen.email]) {
      expect(res.body).not.toContain(secret);
    }
    const detail = occurrenceDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      id: occurrenceId,
      status: 'triage',
      category: {
        id: potholeId,
        name: 'Buraco',
        icon: 'construction',
        iconGroup: 'infrastructure',
        clusterRadiusM: 50,
        defaultDeadlineDays: 5,
        departmentId: worksId,
        departmentName: 'Obras',
      },
      address: 'Rua das Flores, 100',
      requestCount: 2,
      activeWorkOrder: null,
    });
    expect(Math.abs(Date.parse(detail.statusSince) - daysAgo(2).getTime())).toBeLessThan(60_000);

    expect(detail.requests.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(detail.requests[0]).toMatchObject({
      protocol: first.protocol,
      description: 'Buraco fundo na esquina',
      distanceM: 0,
    });
    expect(detail.requests[0]!.photoUrl).toContain(photoKey);
    expect(detail.requests[1]).toMatchObject({
      protocol: second.protocol,
      description: null,
      photoUrl: null,
    });
    expect(Number.isInteger(detail.requests[1]!.distanceM)).toBe(true);
    expect(detail.requests[1]!.distanceM).toBeGreaterThanOrEqual(14);
    expect(detail.requests[1]!.distanceM).toBeLessThanOrEqual(16);

    expect(detail.suggestions).toHaveLength(1);
    expect(detail.suggestions[0]).toMatchObject({
      occurrenceId: near.id,
      protocol: near.requests[0]!.protocol,
      categoryName: 'Buraco',
      description: 'Relato 1',
      requestCount: 2,
    });
    expect(detail.suggestions[0]!.distanceM).toBeGreaterThanOrEqual(29);
    expect(detail.suggestions[0]!.distanceM).toBeLessThanOrEqual(31);
  });

  it('detail of an occurrence in progress shows the active work order', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId } = seed;
    const adminId = await fx.newAdmin(tenantId);
    const working = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'in_progress',
    });
    const teamId = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Equipe Asfalto' });
    await fx.addWorkOrder(tenantId, {
      occurrenceId: working.id,
      teamId,
      status: 'cancelled',
    });
    const active = await fx.addWorkOrder(tenantId, {
      occurrenceId: working.id,
      teamId,
      status: 'in_execution',
    });
    const res = await get(`/panel/occurrences/${working.id}`, adminId, tenantId);
    expect(res.statusCode).toBe(200);
    expect(occurrenceDetailSchema.parse(res.json()).activeWorkOrder).toEqual({
      id: active,
      status: 'in_execution',
      teamName: 'Equipe Asfalto',
    });
  });

  it('manager of another department gets 404 on detail', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lightsId, worksId } = seed;
    const pothole = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });
    const merged = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: CENTER,
      status: 'merged',
      mergedIntoId: pothole.id,
    });

    const lightsManager = await fx.newManager(tenantId, [lightsId]);
    for (const url of [
      `/panel/occurrences/${pothole.id}`,
      `/panel/occurrences/${pothole.id}/teams`,
    ]) {
      const res = await get(url, lightsManager, tenantId);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'occurrence_not_found' });
    }

    const worksManager = await fx.newManager(tenantId, [worksId]);
    expect((await get(`/panel/occurrences/${pothole.id}`, worksManager, tenantId)).statusCode).toBe(
      200,
    );
    for (const id of [merged.id, randomUUID()]) {
      const res = await get(`/panel/occurrences/${id}`, worksManager, tenantId);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'occurrence_not_found' });
    }
    expect((await get('/panel/occurrences/nao-e-uuid', worksManager, tenantId)).statusCode).toBe(
      400,
    );

    // Ocorrência de outra prefeitura: 404 também.
    const other = await fx.seedPanelTenant();
    const foreign = await occurrenceWithReports(other, { categoryId: other.potholeId, at: CENTER });
    const adminId = await fx.newAdmin(tenantId);
    const res = await get(`/panel/occurrences/${foreign.id}`, adminId, tenantId);
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /panel/occurrences/:id/teams', () => {
  /** Hoje em São Paulo mais `days` dias, como AAAA-MM-DD. */
  function saoPauloDatePlus(days: number) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  it('teams are the category department ordered by base distance with the nearest suggested', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, worksId, lightsId } = seed;
    const occurrence = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });

    const far = await fx.addTeam(tenantId, {
      departmentId: worksId,
      name: 'Equipe Longe',
      base: metersNorth(CENTER, 2000),
    });
    const near = await fx.addTeam(tenantId, {
      departmentId: worksId,
      name: 'Equipe Perto',
      base: metersNorth(CENTER, -500),
    });
    await fx.addTeam(tenantId, {
      departmentId: lightsId,
      name: 'Equipe Luz',
      base: CENTER,
    });

    await fx.addAgent(tenantId, near, 'active');
    await fx.addAgent(tenantId, near, 'active');
    await fx.addAgent(tenantId, near, 'inactive');
    const other = await occurrenceWithReports(seed, {
      categoryId: potholeId,
      at: metersNorth(CENTER, 900),
      status: 'in_progress',
    });
    await fx.addWorkOrder(tenantId, { occurrenceId: other.id, teamId: near, status: 'impeded' });
    await fx.addWorkOrder(tenantId, { occurrenceId: other.id, teamId: near, status: 'completed' });

    const managerId = await fx.newManager(tenantId, [worksId]);
    const res = await get(`/panel/occurrences/${occurrence.id}/teams`, managerId, tenantId);
    expect(res.statusCode).toBe(200);
    const body = teamOptionsResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      suggestedTeamId: near,
      defaultDueDate: saoPauloDatePlus(5),
      departmentName: 'Obras',
    });
    expect(body.items.map((team) => team.id)).toEqual([near, far]);
    expect(body.items[0]).toMatchObject({
      name: 'Equipe Perto',
      activeAgentCount: 2,
      openWorkOrderCount: 1,
    });
    expect(body.items[0]!.baseDistanceM).toBeGreaterThanOrEqual(490);
    expect(body.items[0]!.baseDistanceM).toBeLessThanOrEqual(505);
    expect(body.items[1]).toMatchObject({ activeAgentCount: 0, openWorkOrderCount: 0 });
    expect(body.items[1]!.baseDistanceM).toBeGreaterThan(1950);
  });

  it('team without base comes last with null distance', async () => {
    const seed = await fx.seedPanelTenant();
    const { tenantId, potholeId, lampId, worksId, lightsId } = seed;
    const adminId = await fx.newAdmin(tenantId);
    const pothole = await occurrenceWithReports(seed, { categoryId: potholeId, at: CENTER });

    const zeta = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Zeta' });
    const alpha = await fx.addTeam(tenantId, { departmentId: worksId, name: 'Alfa' });
    const based = await fx.addTeam(tenantId, {
      departmentId: worksId,
      name: 'Com Base',
      base: metersNorth(CENTER, 3000),
    });

    const res = await get(`/panel/occurrences/${pothole.id}/teams`, adminId, tenantId);
    const body = teamOptionsResponseSchema.parse(res.json());
    expect(body.suggestedTeamId).toBe(based);
    expect(body.items.map((team) => team.id)).toEqual([based, alpha, zeta]);
    expect(body.items.slice(1).map((team) => team.baseDistanceM)).toEqual([null, null]);

    // Setor só com equipes sem base: nenhuma sugerida.
    await fx.addTeam(tenantId, { departmentId: lightsId, name: 'Luz Sem Base' });
    const lamp = await occurrenceWithReports(seed, { categoryId: lampId, at: CENTER });
    const lights = teamOptionsResponseSchema.parse(
      (await get(`/panel/occurrences/${lamp.id}/teams`, adminId, tenantId)).json(),
    );
    expect(lights).toMatchObject({
      suggestedTeamId: null,
      departmentName: 'Iluminação',
      defaultDueDate: saoPauloDatePlus(7),
    });
    expect(lights.items.map((team) => [team.name, team.baseDistanceM])).toEqual([
      ['Luz Sem Base', null],
    ]);
  });
});
