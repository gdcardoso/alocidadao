import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type Database } from './client.js';
import { seedDev } from './seed-dev-data.js';
import { clientActions, tenants, users } from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono prepara os dados; os testes rodam como app_user (mesma conexão da API).

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const ACTION_ID = randomUUID();
let a: { tenantId: string; userId: string };
let b: { tenantId: string; userId: string };

async function seedTenant(db: Database, label: string, ibgeCode: string) {
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
  const [user] = await db
    .insert(users)
    .values({
      name: `Agente ${label}`,
      email: `agente.${label}@acoes.dev`,
      phone: `+551193${ibgeCode}`,
    })
    .returning();
  return { tenantId: tenant!.id, userId: user!.id };
}

function insertAction(seed: { tenantId: string; userId: string }, id: string) {
  return withContext(app.db, { tenantId: seed.tenantId, userId: seed.userId }, (tx) =>
    tx.insert(clientActions).values({
      id,
      tenantId: seed.tenantId,
      userId: seed.userId,
      kind: 'work_order.start',
      targetId: randomUUID(),
      response: { ok: true },
    }),
  );
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
  a = await seedTenant(owner.db, 'acoes-a', '0000011');
  b = await seedTenant(owner.db, 'acoes-b', '0000012');
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('registro de ações do aparelho', () => {
  it('recusa repetir o id de uma ação', async () => {
    await insertAction(a, ACTION_ID);
    expect(await dbError(insertAction(a, ACTION_ID))).toMatch(/duplicate key/);
  });

  it('esconde ações de outra prefeitura', async () => {
    const id = randomUUID();
    await insertAction(a, id);
    const visible = (tenantId: string) =>
      withContext(app.db, { tenantId }, (tx) =>
        tx.select({ id: clientActions.id }).from(clientActions),
      );
    expect((await visible(a.tenantId)).map((r) => r.id)).toContain(id);
    expect((await visible(b.tenantId)).map((r) => r.id)).not.toContain(id);
  });

  it('recusa gravar ação com tenant_id de outra prefeitura', async () => {
    const message = await dbError(
      withContext(app.db, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
        tx.insert(clientActions).values({
          id: randomUUID(),
          tenantId: b.tenantId,
          userId: a.userId,
          kind: 'work_order.start',
          response: { ok: true },
        }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('não permite reescrever uma ação', async () =>
    expect(
      await dbError(
        withContext(app.db, { tenantId: a.tenantId }, (tx) =>
          tx.update(clientActions).set({ response: {} }),
        ),
      ),
    ).toMatch(/permission denied/));

  it('não permite apagar uma ação', async () =>
    expect(
      await dbError(
        withContext(app.db, { tenantId: a.tenantId }, (tx) => tx.delete(clientActions)),
      ),
    ).toMatch(/permission denied/));
});

describe('dados de demonstração', () => {
  it('cria a prefeitura de demonstração uma vez só', async () => {
    const first = await seedDev(owner.db);
    const second = await seedDev(owner.db);
    expect(second).toEqual(first);
    expect(first.workOrderIds).toHaveLength(3);
  });
});
