import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext } from './client.js';
import { parseIbgeNeighborhoods, upsertIbgeNeighborhoods } from './neighborhoods.js';
import { categories, departments, occurrences, tenantNeighborhoods, tenants } from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco prepara os dados e carrega a malha do IBGE; a camada própria é carregada
// como app_user, com o papel de admin ou de suporte no contexto, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const geojson: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/neighborhoods-sample.geojson', import.meta.url), 'utf8'),
);

// Centro: x 40..41; Alvorada: x 41..42 (os dois y -40..-39). A divisa é x = 41.
const CENTRO = { lat: -39.5, lng: 40.5 };
const ALVORADA = { lat: -39.5, lng: 41.5 };
const DIVISA = { lat: -39.5, lng: 41 };
const FORA = { lat: -10, lng: -10 };

let tenantId: string;
let otherTenantId: string;
let categoryId: string;

async function seedTenant(label: string, ibgeCode: string) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Bairros ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'MG',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const [department] = await owner.db
    .insert(departments)
    .values({ tenantId: tenant!.id, name: 'Obras' })
    .returning();
  const [category] = await owner.db
    .insert(categories)
    .values({ tenantId: tenant!.id, departmentId: department!.id, name: 'Buraco' })
    .returning();
  return { tenantId: tenant!.id, categoryId: category!.id };
}

async function newOccurrence(point: { lat: number; lng: number }) {
  const [row] = await owner.db
    .insert(occurrences)
    .values({ tenantId, categoryId, location: geoPoint(point) })
    .returning();
  return row!;
}

async function neighborhoodOf(id: string) {
  const [row] = await owner.db
    .select({ neighborhood: occurrences.neighborhood })
    .from(occurrences)
    .where(eq(occurrences.id, id));
  return row!.neighborhood;
}

const SQUARE = (x: number, y: number, size = 1) => ({
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

function asRole(platformRole: 'admin' | 'support', fn: string, args: ReturnType<typeof sql>) {
  return withContext(app.db, { platformRole }, (tx) =>
    tx.execute(sql`select ${sql.raw(fn)}(${args}) as result`),
  );
}

async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${(error as Error).message} ${cause?.message ?? ''}`;
  }
  throw new Error('Esperava um erro do banco, mas a operação passou');
}

beforeAll(async () => {
  ({ tenantId, categoryId } = await seedTenant('Vila Bairros', '9999801'));
  ({ tenantId: otherTenantId } = await seedTenant('Outra Vila', '9999803'));
  await upsertIbgeNeighborhoods(owner.db, parseIbgeNeighborhoods(geojson));
});

describe('parseIbgeNeighborhoods', () => {
  it('parseIbgeNeighborhoods lê CD_MUN, CD_BAIRRO e NM_BAIRRO', () => {
    const rows = parseIbgeNeighborhoods(geojson);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ibgeCode: '9999801',
      code: '999980100001',
      name: 'Centro',
    });
    expect(rows[1]).toMatchObject({ code: '999980100002', name: 'Alvorada' });
    for (const row of rows) expect(row.geometry.type).toBe('MultiPolygon');
    expect(rows[0]!.geometry.coordinates).toHaveLength(1);
  });

  it('recusa feição sem nome do bairro', () => {
    const broken = {
      features: [{ properties: { CD_MUN: '9999801', CD_BAIRRO: '1' }, geometry: SQUARE(0, 0) }],
    };
    expect(() => parseIbgeNeighborhoods(broken)).toThrow(/NM_BAIRRO/);
  });
});

describe('bairro da ocorrência', () => {
  it('ocorrência nasce com o bairro do ponto', async () => {
    const centro = await newOccurrence(CENTRO);
    const alvorada = await newOccurrence(ALVORADA);
    expect(centro.neighborhood).toBe('Centro');
    expect(alvorada.neighborhood).toBe('Alvorada');
  });

  it('ponto fora de todos os bairros fica sem bairro', async () => {
    const fora = await newOccurrence(FORA);
    expect(fora.neighborhood).toBeNull();
  });

  it('ponto na divisa de dois bairros recebe um só', async () => {
    const divisa = await newOccurrence(DIVISA);
    // Os dois cobrem a divisa; vence o primeiro em ordem alfabética.
    expect(divisa.neighborhood).toBe('Alvorada');
  });

  it('mover o ponto recalcula o bairro', async () => {
    const occurrence = await newOccurrence(CENTRO);
    expect(occurrence.neighborhood).toBe('Centro');
    await owner.db
      .update(occurrences)
      .set({ location: geoPoint(ALVORADA) })
      .where(eq(occurrences.id, occurrence.id));
    expect(await neighborhoodOf(occurrence.id)).toBe('Alvorada');
  });
});

describe('camada da prefeitura', () => {
  it('camada da prefeitura vale no lugar da malha do IBGE e apagar a camada própria volta para o IBGE', async () => {
    const occurrence = await newOccurrence(CENTRO);
    expect(occurrence.neighborhood).toBe('Centro');

    const features = [{ name: 'Distrito Novo', geometry: SQUARE(40, -40, 2) }];
    const loaded = await asRole(
      'admin',
      'replace_tenant_neighborhoods',
      sql`${tenantId}::uuid, ${JSON.stringify(features)}::jsonb`,
    );
    expect(Number(loaded.rows[0]!.result)).toBe(1);

    // A camada própria vale: o bairro das ocorrências existentes foi recalculado.
    expect(await neighborhoodOf(occurrence.id)).toBe('Distrito Novo');
    expect((await newOccurrence(ALVORADA)).neighborhood).toBe('Distrito Novo');
    const layer = await withContext(app.db, { tenantId }, (tx) =>
      tx.execute(sql`select name, source from effective_neighborhoods(${tenantId}::uuid)`),
    );
    expect(layer.rows).toEqual([{ name: 'Distrito Novo', source: 'tenant' }]);

    await asRole('admin', 'clear_tenant_neighborhoods', sql`${tenantId}::uuid`);
    expect(await neighborhoodOf(occurrence.id)).toBe('Centro');
    expect((await newOccurrence(ALVORADA)).neighborhood).toBe('Alvorada');
    const back = await withContext(app.db, { tenantId }, (tx) =>
      tx.execute(sql`select source from effective_neighborhoods(${tenantId}::uuid)`),
    );
    expect(back.rows.map((r) => r.source)).toEqual(['ibge', 'ibge']);
  });

  it('app_user de outra prefeitura não lê tenant_neighborhoods', async () => {
    const features = [{ name: 'Distrito Secreto', geometry: SQUARE(40, -40) }];
    await asRole(
      'admin',
      'replace_tenant_neighborhoods',
      sql`${tenantId}::uuid, ${JSON.stringify(features)}::jsonb`,
    );
    try {
      const own = await withContext(app.db, { tenantId }, (tx) =>
        tx.select().from(tenantNeighborhoods),
      );
      expect(own).toHaveLength(1);
      const other = await withContext(app.db, { tenantId: otherTenantId }, (tx) =>
        tx.select().from(tenantNeighborhoods),
      );
      expect(other).toHaveLength(0);
      // Nem pela função de camada efetiva.
      const viaFunction = await withContext(app.db, { tenantId: otherTenantId }, (tx) =>
        tx.execute(sql`select name from effective_neighborhoods(${tenantId}::uuid)`),
      );
      expect(viaFunction.rows).toHaveLength(0);
    } finally {
      await asRole('admin', 'clear_tenant_neighborhoods', sql`${tenantId}::uuid`);
    }
  });

  it('suporte não carrega bairros, admin carrega', async () => {
    const features = [{ name: 'Distrito Novo', geometry: SQUARE(40, -40) }];
    const args = sql`${tenantId}::uuid, ${JSON.stringify(features)}::jsonb`;
    expect(await dbError(asRole('support', 'replace_tenant_neighborhoods', args))).toMatch(
      /admin da plataforma/,
    );
    expect(
      await dbError(asRole('support', 'clear_tenant_neighborhoods', sql`${tenantId}::uuid`)),
    ).toMatch(/admin da plataforma/);
    expect(
      await dbError(
        withContext(app.db, { platformRole: 'support' }, (tx) =>
          tx.insert(tenantNeighborhoods).values({
            tenantId,
            name: 'Direto',
            boundary: sql`ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))', 4326))`,
          }),
        ),
      ),
    ).toMatch(/row-level security/);

    // O suporte lê a camada; o admin carrega.
    const loaded = await asRole('admin', 'replace_tenant_neighborhoods', args);
    expect(Number(loaded.rows[0]!.result)).toBe(1);
    try {
      const seen = await withContext(app.db, { platformRole: 'support' }, (tx) =>
        tx.select().from(tenantNeighborhoods),
      );
      expect(seen.map((r) => r.name)).toEqual(['Distrito Novo']);
    } finally {
      await asRole('admin', 'clear_tenant_neighborhoods', sql`${tenantId}::uuid`);
    }
  });

  it('refresh_occurrence_neighborhoods só roda para o admin ou o dono do banco', async () => {
    expect(
      await dbError(
        withContext(app.db, { tenantId }, (tx) =>
          tx.execute(sql`select refresh_occurrence_neighborhoods(${tenantId}::uuid)`),
        ),
      ),
    ).toMatch(/admin da plataforma/);
    const asOwner = await owner.db.execute(
      sql`select refresh_occurrence_neighborhoods(${tenantId}::uuid) as changed`,
    );
    expect(Number(asOwner.rows[0]!.changed)).toBe(0);
  });

  it('ST_MakeValid conserta laço sem derrubar a carga', async () => {
    // Gravata-borboleta: o anel cruza a si mesmo.
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [40, -40],
          [42, -39],
          [42, -40],
          [40, -39],
          [40, -40],
        ],
      ],
    };
    const features = [
      { name: 'Laço', geometry: bowtie },
      { name: 'Quadrado', geometry: SQUARE(44, -40) },
    ];
    const loaded = await asRole(
      'admin',
      'replace_tenant_neighborhoods',
      sql`${tenantId}::uuid, ${JSON.stringify(features)}::jsonb`,
    );
    try {
      expect(Number(loaded.rows[0]!.result)).toBe(2);
      const valid = await owner.db.execute(sql`
        select bool_and(ST_IsValid(boundary)) as ok from tenant_neighborhoods where tenant_id = ${tenantId}
      `);
      expect(valid.rows[0]!.ok).toBe(true);
    } finally {
      await asRole('admin', 'clear_tenant_neighborhoods', sql`${tenantId}::uuid`);
    }
  });

  it('polígono degenerado (anel de área zero) é recusado com 22023 e não altera a camada', async () => {
    const line = {
      type: 'Polygon',
      coordinates: [
        [
          [40, -40],
          [41, -40],
          [42, -40],
          [40, -40],
        ],
      ],
    };
    const features = [{ name: 'Degenerado', geometry: line }];
    const outcome = await asRole(
      'admin',
      'replace_tenant_neighborhoods',
      sql`${tenantId}::uuid, ${JSON.stringify(features)}::jsonb`,
    ).then(
      () => 'accepted',
      (error: unknown) => {
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code ?? String(error);
      },
    );
    expect(outcome).toBe('22023');
    const rows = await owner.db.execute(
      sql`select count(*)::int as n from tenant_neighborhoods where tenant_id = ${tenantId}`,
    );
    expect(rows.rows[0]!.n).toBe(0);
  });
});
