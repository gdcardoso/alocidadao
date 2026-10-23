import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext, type Database } from './client.js';
import {
  categories,
  departments,
  memberships,
  occurrences,
  requests,
  statusEvents,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco (superusuário) prepara os dados; os testes rodam como app_user,
// a mesma conexão que a API usa, e provam que o banco barra o acesso cruzado
// mesmo quando a consulta "esquece" de filtrar pela prefeitura.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const LOCATION = { lat: -23.55, lng: -46.63 };

interface TenantSeed {
  tenantId: string;
  citizenId: string;
  categoryId: string;
  occurrenceId: string;
  requestId: string;
}

let a: TenantSeed;
let b: TenantSeed;
let managerAId: string;

async function seedTenant(db: Database, label: string, ibgeCode: string): Promise<TenantSeed> {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const tenantId = tenant!.id;

  const [citizen] = await db
    .insert(users)
    .values({
      name: `Cidadão ${label}`,
      email: `cidadao.${label}@teste.dev`,
      phone: `+551191${ibgeCode}`,
    })
    .returning();
  const citizenId = citizen!.id;

  return withContext(db, { tenantId }, async (tx) => {
    await tx.insert(memberships).values({ tenantId, userId: citizenId, role: 'citizen' });
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    const [category] = await tx
      .insert(categories)
      .values({ tenantId, departmentId: department!.id, name: 'Buraco na via' })
      .returning();
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId, categoryId: category!.id, location: geoPoint(LOCATION) })
      .returning();
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId,
        citizenId,
        categoryId: category!.id,
        occurrenceId: occurrence!.id,
        description: `Buraco grande na rua principal de ${label}`,
        location: geoPoint(LOCATION),
        gpsLocation: geoPoint(LOCATION),
      })
      .returning();
    return {
      tenantId,
      citizenId,
      categoryId: category!.id,
      occurrenceId: occurrence!.id,
      requestId: request!.id,
    };
  });
}

/** Drizzle embrulha o erro do Postgres; devolve a mensagem original. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('Era esperado que o banco recusasse a operação');
}

beforeAll(async () => {
  a = await seedTenant(owner.db, 'a', '0000001');
  b = await seedTenant(owner.db, 'b', '0000002');

  const [manager] = await owner.db
    .insert(users)
    .values({ name: 'Gestor A', email: 'gestor.a@teste.dev', phone: '+5511919999999' })
    .returning();
  managerAId = manager!.id;
  await withContext(owner.db, { tenantId: a.tenantId }, (tx) =>
    tx.insert(memberships).values({ tenantId: a.tenantId, userId: managerAId, role: 'manager' }),
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('isolamento por prefeitura (RLS)', () => {
  it('sem contexto, não enxerga nenhum dado de prefeitura', async () => {
    const rows = await withContext(app.db, {}, async (tx) => ({
      requests: await tx.select().from(requests),
      categories: await tx.select().from(categories),
    }));
    expect(rows.requests).toHaveLength(0);
    expect(rows.categories).toHaveLength(0);
  });

  it('uma consulta sem filtro devolve só a prefeitura do contexto', async () => {
    const rows = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select().from(requests),
    );
    expect(rows.map((r) => r.id)).toEqual([a.requestId]);
  });

  it('não lê registro de outra prefeitura nem pelo id', async () => {
    const rows = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select().from(requests).where(eq(requests.id, b.requestId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('não altera nem apaga registro de outra prefeitura', async () => {
    const result = await withContext(app.db, { tenantId: a.tenantId }, async (tx) => ({
      updated: await tx
        .update(requests)
        .set({ description: 'alterado por outra prefeitura' })
        .where(eq(requests.id, b.requestId))
        .returning(),
      deleted: await tx.delete(categories).where(eq(categories.id, b.categoryId)).returning(),
    }));
    expect(result.updated).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);

    const [original] = await owner.db.select().from(requests).where(eq(requests.id, b.requestId));
    expect(original!.description).toContain('principal de b');
  });

  it('o contexto não vaza para a próxima consulta na mesma conexão', async () => {
    const single = createDatabase(TEST_APP_URL);
    single.pool.options.max = 1;
    try {
      await withContext(single.db, { tenantId: a.tenantId }, (tx) => tx.select().from(requests));
      expect(await single.db.select().from(requests)).toHaveLength(0);
    } finally {
      await single.pool.end();
    }
  });

  it('recusa gravar com tenant_id de outra prefeitura', async () => {
    const message = await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.insert(departments).values({ tenantId: b.tenantId, name: 'Invasão' }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('recusa apontar para registro de outra prefeitura (FK composta)', async () => {
    const message = await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.insert(requests).values({
          tenantId: a.tenantId,
          citizenId: a.citizenId,
          categoryId: b.categoryId,
          occurrenceId: a.occurrenceId,
          description: 'Categoria de outra prefeitura',
          location: geoPoint(LOCATION),
          gpsLocation: geoPoint(LOCATION),
        }),
      ),
    );
    expect(message).toMatch(/foreign key/);
  });
});

describe('regras no banco', () => {
  it('gera protocolo sequencial separado por prefeitura', async () => {
    const insertRequest = (seed: TenantSeed) =>
      withContext(app.db, { tenantId: seed.tenantId }, async (tx) => {
        const [row] = await tx
          .insert(requests)
          .values({
            tenantId: seed.tenantId,
            citizenId: seed.citizenId,
            categoryId: seed.categoryId,
            occurrenceId: seed.occurrenceId,
            description: 'Lâmpada queimada no poste',
            location: geoPoint(LOCATION),
            gpsLocation: geoPoint(LOCATION),
          })
          .returning({ protocol: requests.protocol });
        return row!.protocol;
      });

    const year = new Date().getFullYear();
    expect(await insertRequest(a)).toBe(`${year}-000002`);
    expect(await insertRequest(a)).toBe(`${year}-000003`);
    expect(await insertRequest(b)).toBe(`${year}-000002`);
  });

  it('histórico de status não pode ser alterado nem apagado', async () => {
    await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.insert(statusEvents).values({
        tenantId: a.tenantId,
        occurrenceId: a.occurrenceId,
        requestId: a.requestId,
        toStatus: 'open',
      }),
    );
    const updateError = await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.update(statusEvents).set({ comment: 'reescrevendo a história' }),
      ),
    );
    const deleteError = await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) => tx.delete(statusEvents)),
    );
    expect(updateError).toMatch(/permission denied/);
    expect(deleteError).toMatch(/permission denied/);
  });
});

describe('usuários e prefeituras', () => {
  it('só enxerga usuários com vínculo na prefeitura do contexto', async () => {
    const rows = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a.citizenId, managerAId]));
    expect(ids).not.toContain(b.citizenId);
  });

  it('o usuário não consegue se promover a admin da plataforma', async () => {
    const message = await dbError(
      withContext(app.db, { userId: a.citizenId }, (tx) =>
        tx.update(users).set({ platformRole: 'admin' }).where(eq(users.id, a.citizenId)),
      ),
    );
    expect(message).toMatch(/permission denied/);
  });

  it('o usuário vê os próprios vínculos, sem contexto de prefeitura', async () => {
    const rows = await withContext(app.db, { userId: a.citizenId }, (tx) =>
      tx.select().from(memberships),
    );
    expect(rows.map((r) => r.userId)).toEqual([a.citizenId]);
  });

  it('só o admin da plataforma cria prefeituras', async () => {
    const newTenant = () => ({
      name: 'Município Novo',
      displayName: 'Prefeitura Nova',
      city: 'Nova',
      state: 'MG',
      ibgeCode: randomUUID(),
    });
    const message = await dbError(
      withContext(app.db, { userId: a.citizenId }, (tx) => tx.insert(tenants).values(newTenant())),
    );
    expect(message).toMatch(/row-level security/);

    const created = await withContext(app.db, { platformRole: 'admin' }, (tx) =>
      tx.insert(tenants).values(newTenant()).returning(),
    );
    expect(created).toHaveLength(1);
  });
});
