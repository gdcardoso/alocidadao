import { randomUUID } from 'node:crypto';
import type { GeoPoint, OccurrenceStatus } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext } from './client.js';
import { findActiveTenantAt, findSimilarOccurrences } from './geo.js';
import {
  categories,
  departments,
  memberships,
  occurrences,
  requests,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco prepara os dados; as consultas rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const EARTH_RADIUS_M = 6_371_008.8;

// Limites quadrados de 1 grau, vizinhos (A e B) e distante (C), longe dos dados de outros testes.
const POINT_A: GeoPoint = { lat: 10.5, lng: 20.5 };
const POINT_B: GeoPoint = { lat: 10.5, lng: 21.5 };
const POINT_C: GeoPoint = { lat: 10.5, lng: 30.5 };
const POINT_OUTSIDE: GeoPoint = { lat: 50, lng: 50 };

/** Ponto `meters` metros ao norte de `point`. */
function north(point: GeoPoint, meters: number): GeoPoint {
  return { lat: point.lat + ((meters / EARTH_RADIUS_M) * 180) / Math.PI, lng: point.lng };
}

interface TenantSeed {
  tenantId: string;
  departmentId: string;
  citizenId: string;
}

let a: TenantSeed;
let b: TenantSeed;

async function seedTenant(
  label: string,
  ibgeCode: string,
  status: 'active' | 'onboarding',
  west: number,
): Promise<TenantSeed> {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status,
    })
    .returning();
  const tenantId = tenant!.id;
  await owner.db.execute(
    sql`update tenants set boundary = ST_Multi(ST_MakeEnvelope(${west}, 10, ${west + 1}, 11, 4326)) where id = ${tenantId}`,
  );
  const [citizen] = await owner.db
    .insert(users)
    .values({
      name: `Cidadão ${label}`,
      email: `cidadao.${label}@geo.dev`,
      phone: `+551193${ibgeCode}`,
    })
    .returning();
  return withContext(owner.db, { tenantId }, async (tx) => {
    await tx.insert(memberships).values({ tenantId, userId: citizen!.id, role: 'citizen' });
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    return { tenantId, departmentId: department!.id, citizenId: citizen!.id };
  });
}

/** Categoria nova com raio de 20 m, para cada teste ter o seu conjunto de ocorrências. */
async function newCategory(seed: TenantSeed): Promise<string> {
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({
        tenantId: seed.tenantId,
        departmentId: seed.departmentId,
        name: `Buraco ${randomUUID()}`,
        clusterRadiusM: 20,
      })
      .returning();
    return row!.id;
  });
}

/** Cria uma ocorrência com `requestCount` solicitações. */
async function newOccurrence(
  seed: TenantSeed,
  categoryId: string,
  point: GeoPoint,
  status: OccurrenceStatus = 'triage',
  requestCount = 1,
): Promise<string> {
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId: seed.tenantId, categoryId, location: geoPoint(point), status })
      .returning();
    for (let i = 0; i < requestCount; i++) {
      await tx.insert(requests).values({
        tenantId: seed.tenantId,
        citizenId: seed.citizenId,
        categoryId,
        occurrenceId: occurrence!.id,
        description: 'Buraco perto do ponto de ônibus',
        location: geoPoint(point),
        gpsLocation: geoPoint(point),
      });
    }
    return occurrence!.id;
  });
}

beforeAll(async () => {
  a = await seedTenant('geo-a', '0000031', 'active', 20);
  b = await seedTenant('geo-b', '0000032', 'active', 21);
  await seedTenant('geo-c', '0000033', 'onboarding', 30);
});

describe('findActiveTenantAt', () => {
  it('acha a prefeitura do ponto', async () => {
    const found = await app.db.transaction((tx) => findActiveTenantAt(tx, POINT_A));
    expect(found).toEqual({ id: a.tenantId, displayName: 'Prefeitura geo-a' });
    const other = await app.db.transaction((tx) => findActiveTenantAt(tx, POINT_B));
    expect(other?.id).toBe(b.tenantId);
  });

  it('não devolve prefeitura em implantação', async () => {
    expect(await app.db.transaction((tx) => findActiveTenantAt(tx, POINT_C))).toBeUndefined();
  });

  it('devolve undefined fora de qualquer limite', async () => {
    expect(await app.db.transaction((tx) => findActiveTenantAt(tx, POINT_OUTSIDE))).toBeUndefined();
  });
});

describe('findSimilarOccurrences', () => {
  it('acha a ocorrência dentro do raio, mais perto primeiro, com a contagem de relatos', async () => {
    const categoryId = await newCategory(a);
    const far = await newOccurrence(a, categoryId, north(POINT_A, 18), 'in_progress', 2);
    const near = await newOccurrence(a, categoryId, north(POINT_A, 10), 'triage', 1);

    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findSimilarOccurrences(tx, { categoryId, point: POINT_A }),
    );

    expect(found).toEqual([
      { id: near, status: 'triage', distanceM: 10, requestCount: 1 },
      { id: far, status: 'in_progress', distanceM: 18, requestCount: 2 },
    ]);
  });

  it('respeita o limite de resultados', async () => {
    const categoryId = await newCategory(a);
    await newOccurrence(a, categoryId, north(POINT_A, 5));
    await newOccurrence(a, categoryId, north(POINT_A, 8));
    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findSimilarOccurrences(tx, { categoryId, point: POINT_A, limit: 1 }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.distanceM).toBe(5);
  });

  it('ignora o que está fora do raio, encerrado, de outra categoria ou de outra prefeitura', async () => {
    const categoryId = await newCategory(a);
    const otherCategoryId = await newCategory(a);
    await newOccurrence(a, categoryId, north(POINT_A, 25));
    for (const status of ['merged', 'cancelled', 'rejected', 'completed'] as const) {
      await newOccurrence(a, categoryId, north(POINT_A, 5), status);
    }
    await newOccurrence(a, otherCategoryId, north(POINT_A, 5));
    const categoryInB = await newCategory(b);
    await newOccurrence(b, categoryInB, north(POINT_A, 5));

    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findSimilarOccurrences(tx, { categoryId, point: POINT_A }),
    );
    expect(found).toEqual([]);

    // Mesmo pedindo a categoria da prefeitura B, o contexto da A não enxerga nada.
    const crossTenant = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findSimilarOccurrences(tx, { categoryId: categoryInB, point: POINT_A }),
    );
    expect(crossTenant).toEqual([]);
  });
});
