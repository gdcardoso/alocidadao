import { DEFAULT_SITE_CONTACT } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type Database } from './client.js';
import { memberships, siteContact, tenants, users } from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Contato da página de apresentação: uma linha só, leitura livre, só o admin da plataforma altera.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

let adminId: string;
let supportId: string;
let managerId: string;
let tenantId: string;

async function createUser(db: Database, values: typeof users.$inferInsert) {
  const [user] = await db.insert(users).values(values).returning();
  return user!.id;
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

const readContact = () =>
  owner.db
    .select({
      whatsapp: siteContact.whatsapp,
      email: siteContact.email,
      responseNote: siteContact.responseNote,
      updatedBy: siteContact.updatedBy,
    })
    .from(siteContact);

beforeAll(async () => {
  adminId = await createUser(owner.db, {
    name: 'Admin do site',
    phone: '+5511940009001',
    platformRole: 'admin',
  });
  supportId = await createUser(owner.db, {
    name: 'Suporte do site',
    phone: '+5511940009002',
    platformRole: 'support',
  });
  managerId = await createUser(owner.db, { name: 'Gestor do site', phone: '+5511940009003' });
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município do Site',
      displayName: 'Prefeitura do Site',
      city: 'Site',
      state: 'GO',
      ibgeCode: '0000901',
      status: 'active',
    })
    .returning();
  tenantId = tenant!.id;
  await withContext(owner.db, { tenantId }, (tx) =>
    tx.insert(memberships).values({ tenantId, userId: managerId, role: 'manager' }),
  );
});

afterAll(async () => {
  // Volta aos valores iniciais: outros testes podem contar com eles.
  await owner.db
    .update(siteContact)
    .set({ ...DEFAULT_SITE_CONTACT, updatedBy: null })
    .where(eq(siteContact.id, 1));
  await owner.pool.end();
  await app.pool.end();
});

describe('contato do site', () => {
  it('linha inicial tem os valores de teste', async () => {
    expect(await readContact()).toEqual([{ ...DEFAULT_SITE_CONTACT, updatedBy: null }]);
  });

  it('app_user lê o contato sem contexto', async () => {
    const rows = await withContext(app.db, {}, (tx) =>
      tx
        .select({
          whatsapp: siteContact.whatsapp,
          email: siteContact.email,
          responseNote: siteContact.responseNote,
        })
        .from(siteContact),
    );
    expect(rows).toEqual([DEFAULT_SITE_CONTACT]);
  });

  it('admin da plataforma altera', async () => {
    const changed = await withContext(app.db, { userId: adminId, platformRole: 'admin' }, (tx) =>
      tx
        .update(siteContact)
        .set({ responseNote: 'Resposta em até 1 dia útil', updatedBy: adminId })
        .where(eq(siteContact.id, 1))
        .returning({ id: siteContact.id }),
    );
    expect(changed).toHaveLength(1);
    const [row] = await readContact();
    expect(row).toMatchObject({ responseNote: 'Resposta em até 1 dia útil', updatedBy: adminId });
  });

  it('suporte não altera', async () => {
    const before = await readContact();
    const changed = await withContext(
      app.db,
      { userId: supportId, platformRole: 'support' },
      (tx) =>
        tx
          .update(siteContact)
          .set({ responseNote: 'Mudou pelo suporte' })
          .where(eq(siteContact.id, 1))
          .returning({ id: siteContact.id }),
    );
    expect(changed).toHaveLength(0);
    expect(await readContact()).toEqual(before);
  });

  it('gestor de prefeitura não altera', async () => {
    const before = await readContact();
    const changed = await withContext(app.db, { tenantId, userId: managerId }, (tx) =>
      tx
        .update(siteContact)
        .set({ responseNote: 'Mudou pelo gestor' })
        .where(eq(siteContact.id, 1))
        .returning({ id: siteContact.id }),
    );
    expect(changed).toHaveLength(0);
    expect(await readContact()).toEqual(before);
  });

  it('não dá para inserir segunda linha', async () => {
    const asAdmin = await dbError(
      withContext(app.db, { userId: adminId, platformRole: 'admin' }, (tx) =>
        tx.insert(siteContact).values({ id: 2, ...DEFAULT_SITE_CONTACT }),
      ),
    );
    expect(asAdmin).toMatch(/permission denied/);
    // Nem o dono do banco: a chave só aceita 1.
    expect(
      await dbError(owner.db.insert(siteContact).values({ id: 2, ...DEFAULT_SITE_CONTACT })),
    ).toMatch(/site_contact_single_row_check/);
    expect(await dbError(owner.db.insert(siteContact).values(DEFAULT_SITE_CONTACT))).toMatch(
      /site_contact_pkey/,
    );
  });

  it('app_user não apaga o contato', async () => {
    const error = await dbError(
      withContext(app.db, { userId: adminId, platformRole: 'admin' }, (tx) =>
        tx.delete(siteContact).where(eq(siteContact.id, 1)),
      ),
    );
    expect(error).toMatch(/permission denied/);
  });
});
