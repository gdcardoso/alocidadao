import { randomInt } from 'node:crypto';
import {
  createDatabase,
  parseIbgeNeighborhoods,
  schema,
  upsertIbgeNeighborhoods,
  withContext,
} from '@alocidadao/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { occurrences, staffAuditEvents, tenantNeighborhoods, tenants } = schema;

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

const square = (x: number, y: number, size = 1) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

const feature = (
  properties: Record<string, unknown> | null,
  geometry: unknown = square(40, -40),
) => ({
  type: 'Feature',
  properties,
  geometry,
});

const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

function call(
  method: 'GET' | 'PUT' | 'DELETE',
  tenantId: string,
  userId: string,
  payload?: unknown,
) {
  return staffAuthHeader(appDb.db, userId).then((headers) =>
    app.inject({
      method,
      url: `/backoffice/tenants/${tenantId}/neighborhoods`,
      headers,
      payload: payload as object | undefined,
    }),
  );
}

/** Prefeitura com uma ocorrência em (lng 40.5, lat -39.5) e a malha do IBGE com o bairro "Centro". */
async function seedTenant() {
  const seeded = await fx.seedPanelTenant();
  const ibgeCode = String(randomInt(1_000_000, 9_999_999));
  await owner.db.update(tenants).set({ ibgeCode }).where(eq(tenants.id, seeded.tenantId));
  await upsertIbgeNeighborhoods(
    owner.db,
    parseIbgeNeighborhoods({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { CD_MUN: ibgeCode, CD_BAIRRO: `${ibgeCode}00001`, NM_BAIRRO: 'Centro' },
          geometry: square(40, -40, 2),
        },
      ],
    }),
  );
  const occurrenceId = await fx.addOccurrence(seeded.tenantId, {
    categoryId: seeded.potholeId,
    at: { lat: -39.5, lng: 40.5 },
  });
  return { tenantId: seeded.tenantId, occurrenceId };
}

const neighborhoodOf = async (occurrenceId: string) => {
  const [row] = await owner.db
    .select({ neighborhood: occurrences.neighborhood })
    .from(occurrences)
    .where(eq(occurrences.id, occurrenceId));
  return row!.neighborhood;
};

const layerNames = async (tenantId: string) =>
  (
    await owner.db
      .select({ name: tenantNeighborhoods.name })
      .from(tenantNeighborhoods)
      .where(eq(tenantNeighborhoods.tenantId, tenantId))
  ).map((row) => row.name);

describe('carga de bairros do backoffice', () => {
  it('admin uploads a GeoJSON and occurrences get the neighborhood', async () => {
    const { tenantId, occurrenceId } = await seedTenant();
    const adminId = await fx.newStaff('admin');
    expect(await neighborhoodOf(occurrenceId)).toBe('Centro');

    const response = await call(
      'PUT',
      tenantId,
      adminId,
      collection(
        feature({ nome: '  Distrito Novo ' }, square(40, -40, 2)),
        feature(
          { name: 'Vila Alta' },
          { type: 'MultiPolygon', coordinates: [square(50, 0).coordinates] },
        ),
        feature({ NM_BAIRRO: 'Zona Norte' }, square(60, 0)),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 3, source: 'tenant' });
    expect(await neighborhoodOf(occurrenceId)).toBe('Distrito Novo');
    expect((await layerNames(tenantId)).toSorted()).toEqual([
      'Distrito Novo',
      'Vila Alta',
      'Zona Norte',
    ]);
    const summary = await call('GET', tenantId, await fx.newStaff('support'));
    expect(summary.json()).toEqual({ count: 3, source: 'tenant' });
  });

  it('support gets 403 on upload and delete', async () => {
    const { tenantId, occurrenceId } = await seedTenant();
    const supportId = await fx.newStaff('support');

    const put = await call('PUT', tenantId, supportId, collection(feature({ nome: 'Novo' })));
    const del = await call('DELETE', tenantId, supportId);
    const get = await call('GET', tenantId, supportId);

    expect(put.statusCode).toBe(403);
    expect(del.statusCode).toBe(403);
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ count: 1, source: 'ibge' });
    expect(await layerNames(tenantId)).toEqual([]);
    expect(await neighborhoodOf(occurrenceId)).toBe('Centro');
  });

  it('invalid feature rejects the whole file and keeps the old layer', async () => {
    const { tenantId, occurrenceId } = await seedTenant();
    const adminId = await fx.newStaff('admin');
    await call(
      'PUT',
      tenantId,
      adminId,
      collection(feature({ nome: 'Antigo' }, square(40, -40, 2))),
    );

    const invalid = [
      collection(
        feature({ nome: 'Bom' }),
        feature({ nome: 'Ponto' }, { type: 'Point', coordinates: [40, -40] }),
      ),
      collection(
        feature({ nome: 'Bom' }),
        feature(
          { nome: 'Linha' },
          {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ),
      ),
      collection(
        feature(
          { nome: 'Aberto' },
          {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            ],
          },
        ),
      ),
      collection(feature({ nome: 'Fora' }, square(500, 0))),
      collection(),
      { type: 'Feature', properties: { nome: 'Solto' }, geometry: square(0, 0) },
      { not: 'geojson' },
    ];
    for (const body of invalid) {
      const response = await call('PUT', tenantId, adminId, body);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: 'invalid_neighborhoods' });
    }

    expect(await layerNames(tenantId)).toEqual(['Antigo']);
    expect(await neighborhoodOf(occurrenceId)).toBe('Antigo');
  });

  it('duplicate or empty name returns 422 invalid_neighborhoods', async () => {
    const { tenantId } = await seedTenant();
    const adminId = await fx.newStaff('admin');

    const bodies = [
      collection(feature({ nome: 'Centro' }), feature({ nome: ' centro ' })),
      collection(feature({ nome: 'Centro' }), feature({ name: 'CENTRO' })),
      collection(feature({ nome: '   ' })),
      collection(feature({})),
      collection(feature(null)),
      collection(feature({ nome: 42 })),
    ];
    for (const body of bodies) {
      const response = await call('PUT', tenantId, adminId, body);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: 'invalid_neighborhoods' });
    }
    expect(await layerNames(tenantId)).toEqual([]);
  });

  it('more than 2000 features returns 422 and an unknown tenant returns 404', async () => {
    const { tenantId } = await seedTenant();
    const adminId = await fx.newStaff('admin');

    const tooMany = collection(
      ...Array.from({ length: 2001 }, (_, i) => feature({ nome: `Bairro ${i}` })),
    );
    expect((await call('PUT', tenantId, adminId, tooMany)).statusCode).toBe(422);

    const missing = '00000000-0000-4000-8000-000000000000';
    const put = await call('PUT', missing, adminId, collection(feature({ nome: 'A' })));
    expect(put.statusCode).toBe(404);
    expect(put.json()).toEqual({ code: 'tenant_not_found' });
    expect((await call('DELETE', missing, adminId)).statusCode).toBe(404);
    expect((await call('GET', missing, adminId)).statusCode).toBe(404);
  });

  it('delete goes back to the IBGE layer', async () => {
    const { tenantId, occurrenceId } = await seedTenant();
    const adminId = await fx.newStaff('admin');
    await call(
      'PUT',
      tenantId,
      adminId,
      collection(feature({ nome: 'Próprio' }, square(40, -40, 2))),
    );
    expect(await neighborhoodOf(occurrenceId)).toBe('Próprio');

    const response = await call('DELETE', tenantId, adminId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 1, source: 'ibge' });
    expect(await layerNames(tenantId)).toEqual([]);
    expect(await neighborhoodOf(occurrenceId)).toBe('Centro');
  });

  it('upload and delete write the staff audit', async () => {
    const { tenantId } = await seedTenant();
    const adminId = await fx.newStaff('admin');

    await call(
      'PUT',
      tenantId,
      adminId,
      collection(feature({ nome: 'A' }), feature({ nome: 'B' }, square(45, 0))),
    );
    await call('DELETE', tenantId, adminId);

    const events = await withContext(owner.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(staffAuditEvents)
        .where(eq(staffAuditEvents.tenantId, tenantId))
        .orderBy(staffAuditEvents.createdAt),
    );
    expect(events.map((e) => e.action)).toEqual([
      'tenant.neighborhoods_replace',
      'tenant.neighborhoods_reset',
    ]);
    expect(events[0]).toMatchObject({
      staffUserId: adminId,
      targetType: 'tenant',
      targetId: tenantId,
    });
  });
});
