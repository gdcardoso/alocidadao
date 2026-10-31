import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activateInvitations,
  changePhone,
  deleteAccount,
  findUserByPhone,
  freezeStaleAccount,
  sessionForRefresh,
} from './auth.js';
import { createDatabase, geoPoint, withContext, type Database } from './client.js';
import {
  categories,
  departments,
  devices,
  memberships,
  occurrences,
  requests,
  sessions,
  tenants,
  users,
  verificationCodes,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Conta: troca de número, exclusão, congelamento do número reaproveitado e escrita só
// na própria conta. O dono do banco prepara os dados; os testes rodam como app_user.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const LOCATION = { lat: -23.55, lng: -46.63 };

let tenantId: string;
let categoryId: string;
let supportId: string;
let adminId: string;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function createUser(db: Database, values: typeof users.$inferInsert) {
  const [user] = await db.insert(users).values(values).returning();
  return user!.id;
}

async function createSession(userId: string) {
  const tokenHash = randomUUID();
  await owner.db.insert(sessions).values({ userId, audience: 'app', refreshTokenHash: tokenHash });
  return tokenHash;
}

/** Drizzle embrulha o erro do Postgres; devolve a mensagem e o código originais. */
async function dbError(promise: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string; code?: string } }).cause;
    return {
      message: cause?.message ?? (error as Error).message,
      code: cause?.code ?? (error as { code?: string }).code,
    };
  }
  throw new Error('Era esperado que o banco recusasse a operação');
}

beforeAll(async () => {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município de Conta',
      displayName: 'Prefeitura Conta',
      city: 'Conta',
      state: 'SP',
      ibgeCode: '0000301',
      status: 'active',
    })
    .returning();
  tenantId = tenant!.id;
  categoryId = await withContext(owner.db, { tenantId }, async (tx) => {
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    const [category] = await tx
      .insert(categories)
      .values({ tenantId, departmentId: department!.id, name: 'Buraco na via' })
      .returning();
    return category!.id;
  });
  supportId = await createUser(owner.db, {
    name: 'Suporte',
    phone: '+5511960000001',
    platformRole: 'support',
  });
  adminId = await createUser(owner.db, {
    name: 'Admin',
    phone: '+5511960000002',
    platformRole: 'admin',
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('troca de número', () => {
  it('troca o próprio número', async () => {
    const id = await createUser(owner.db, { name: 'Troca', phone: '+5511960000101' });
    await withContext(app.db, { userId: id }, (tx) => changePhone(tx, '+5511960000102'));

    expect(await findUserByPhone(app.db, '+5511960000102', randomUUID())).toMatchObject({ id });
    expect(await findUserByPhone(app.db, '+5511960000101', randomUUID())).toBeNull();
  });

  it('troca para número em uso falha', async () => {
    await createUser(owner.db, { name: 'Dona do número', phone: '+5511960000103' });
    const id = await createUser(owner.db, { name: 'Quer o número', phone: '+5511960000104' });
    const error = await dbError(
      withContext(app.db, { userId: id }, (tx) => changePhone(tx, '+5511960000103')),
    );
    expect(error.code).toBe('23505');
  });

  it('troca de número exige usuário no contexto', async () => {
    const error = await dbError(withContext(app.db, {}, (tx) => changePhone(tx, '+5511960000105')));
    expect(error.message).toMatch(/usuário/);
  });
});

describe('escrita só na própria conta', () => {
  it('UPDATE direto de telefone ou CPF é negado', async () => {
    const id = await createUser(owner.db, { name: 'Direto', phone: '+5511960000201' });
    const phone = await dbError(
      withContext(app.db, { userId: id }, (tx) =>
        tx.update(users).set({ phone: '+5511960000202' }).where(eq(users.id, id)),
      ),
    );
    const cpf = await dbError(
      withContext(app.db, { userId: id }, (tx) =>
        tx.update(users).set({ cpf: '30000000001' }).where(eq(users.id, id)),
      ),
    );
    expect(phone.message).toMatch(/permission denied/);
    expect(cpf.message).toMatch(/permission denied/);

    // Nome e e-mail continuam mudando por UPDATE direto.
    const own = await withContext(app.db, { userId: id }, (tx) =>
      tx
        .update(users)
        .set({ name: 'Direto Renomeado', email: 'direto@conta.dev' })
        .where(eq(users.id, id))
        .returning({ id: users.id }),
    );
    expect(own).toHaveLength(1);
  });

  it('suporte não altera conta alheia', async () => {
    const id = await createUser(owner.db, { name: 'Atendida', phone: '+5511960000203' });
    const changed = await withContext(
      app.db,
      { userId: supportId, platformRole: 'support' },
      (tx) =>
        tx
          .update(users)
          .set({ name: 'Alterada pelo suporte' })
          .where(eq(users.id, id))
          .returning({ id: users.id }),
    );
    expect(changed).toHaveLength(0);
  });

  it('admin interno também não', async () => {
    const id = await createUser(owner.db, { name: 'Atendida', phone: '+5511960000204' });
    const changed = await withContext(app.db, { userId: adminId, platformRole: 'admin' }, (tx) =>
      tx
        .update(users)
        .set({ name: 'Alterada pelo admin' })
        .where(eq(users.id, id))
        .returning({ id: users.id }),
    );
    expect(changed).toHaveLength(0);
    const [untouched] = await owner.db.select().from(users).where(eq(users.id, id));
    expect(untouched!.name).toBe('Atendida');
  });
});

describe('exclusão de conta', () => {
  it('excluir conta apaga os dados pessoais e encerra o acesso', async () => {
    const id = await createUser(owner.db, {
      name: 'Vai Sair',
      phone: '+5511960000301',
      email: 'vai.sair@conta.dev',
      cpf: '30000000002',
    });
    const tokenHash = await createSession(id);
    await owner.db.insert(devices).values({
      userId: id,
      installationId: randomUUID(),
      platform: 'android',
      appVersion: '1.0.0',
    });
    const requestId = await withContext(owner.db, { tenantId }, async (tx) => {
      await tx.insert(memberships).values([
        { tenantId, userId: id, role: 'citizen' },
        { tenantId, userId: id, role: 'field_agent', status: 'invited' },
      ]);
      const [occurrence] = await tx
        .insert(occurrences)
        .values({ tenantId, categoryId, location: geoPoint(LOCATION) })
        .returning();
      const [request] = await tx
        .insert(requests)
        .values({
          tenantId,
          citizenId: id,
          categoryId,
          occurrenceId: occurrence!.id,
          description: 'Buraco na rua de quem vai sair',
          location: geoPoint(LOCATION),
          gpsLocation: geoPoint(LOCATION),
        })
        .returning();
      return request!.id;
    });

    // Códigos enviados ao telefone e ao e-mail (com e sem conta ligada) e um de outra pessoa.
    const code = (target: string, userId: string | null) => ({
      id: randomUUID(),
      purpose: 'phone_login' as const,
      target,
      userId,
      codeHash: 'hash',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const otherCode = code('+5511960000399', null);
    await owner.db
      .insert(verificationCodes)
      .values([
        code('+5511960000301', null),
        code('+5511960000302', id),
        code('Vai.Sair@conta.dev', null),
        otherCode,
      ]);

    await withContext(app.db, { userId: id }, (tx) => deleteAccount(tx));

    const [user] = await owner.db.select().from(users).where(eq(users.id, id));
    expect(user).toMatchObject({
      name: 'Conta excluída',
      phone: null,
      email: null,
      cpf: null,
      accountStatus: 'frozen',
    });
    expect(user!.deletedAt).toBeInstanceOf(Date);

    expect(await sessionForRefresh(app.db, tokenHash)).toBeNull();
    expect(await owner.db.select().from(devices).where(eq(devices.userId, id))).toEqual([]);
    const links = await owner.db.select().from(memberships).where(eq(memberships.userId, id));
    expect(links).toHaveLength(2);
    expect(links.every((m) => m.status === 'inactive')).toBe(true);
    const kept = await owner.db.select().from(requests).where(eq(requests.id, requestId));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.citizenId).toBe(id);

    // Nenhum código liga a conta excluída ao telefone ou ao e-mail dela.
    const codes = await owner.db.select().from(verificationCodes);
    expect(codes.filter((c) => c.userId === id)).toEqual([]);
    expect(
      codes.filter((c) =>
        ['+5511960000301', 'vai.sair@conta.dev'].includes(c.target.toLowerCase()),
      ),
    ).toEqual([]);
    expect(codes.map((c) => c.id)).toContain(otherCode.id);
  });

  it('excluir conta exige usuário no contexto', async () => {
    const error = await dbError(withContext(app.db, {}, (tx) => deleteAccount(tx)));
    expect(error.message).toMatch(/usuário/);
  });
});

describe('número reaproveitado', () => {
  it('congela conta parada', async () => {
    const phone = '+5511960000401';
    const stale = await createUser(owner.db, {
      name: 'Dono antigo',
      phone,
      lastActiveAt: daysAgo(91),
    });
    const tokenHash = await createSession(stale);
    await owner.db.insert(devices).values({
      userId: stale,
      installationId: randomUUID(),
      platform: 'android',
      appVersion: '1.0.0',
      pushToken: `push-${randomUUID()}`,
    });
    // O contexto é o da conta nova, que está sendo criada na mesma transação.
    const newAccount = randomUUID();

    const frozen = await withContext(app.db, { userId: newAccount }, (tx) =>
      freezeStaleAccount(tx, stale, phone),
    );

    expect(frozen).toBe(true);
    // Congelar revoga as sessões e apaga o token de push dos aparelhos da conta antiga.
    const saved = await owner.db.select().from(devices).where(eq(devices.userId, stale));
    expect(saved.map((d) => d.pushToken)).toEqual([null]);
    expect(await findUserByPhone(app.db, phone, randomUUID())).toBeNull();
    expect(await sessionForRefresh(app.db, tokenHash)).toBeNull();
  });

  it('não congela conta ativa recente', async () => {
    const phone = '+5511960000402';
    const recent = await createUser(owner.db, {
      name: 'Dono atual',
      phone,
      lastActiveAt: daysAgo(10),
    });
    const tokenHash = await createSession(recent);

    const frozen = await withContext(app.db, { userId: randomUUID() }, (tx) =>
      freezeStaleAccount(tx, recent, phone),
    );

    expect(frozen).toBe(false);
    const [user] = await owner.db.select().from(users).where(eq(users.id, recent));
    expect(user!.accountStatus).toBe('active');
    expect(await sessionForRefresh(app.db, tokenHash)).toMatchObject({ userId: recent });
  });

  it('não congela conta parada com outro telefone', async () => {
    const stale = await createUser(owner.db, {
      name: 'Outro número',
      phone: '+5511960000403',
      lastActiveAt: daysAgo(120),
    });
    const frozen = await withContext(app.db, { userId: randomUUID() }, (tx) =>
      freezeStaleAccount(tx, stale, '+5511960000404'),
    );
    expect(frozen).toBe(false);
  });

  it('congelar exige usuário no contexto', async () => {
    const stale = await createUser(owner.db, {
      name: 'Sem contexto',
      phone: '+5511960000405',
      lastActiveAt: daysAgo(120),
    });
    const error = await dbError(
      withContext(app.db, {}, (tx) => freezeStaleAccount(tx, stale, '+5511960000405')),
    );
    expect(error.message).toMatch(/usuário/);
  });
});

describe('convites', () => {
  it('ativa convites', async () => {
    const id = await createUser(owner.db, { name: 'Convidada', phone: '+5511960000501' });
    await withContext(owner.db, { tenantId }, (tx) =>
      tx.insert(memberships).values([
        { tenantId, userId: id, role: 'field_agent', status: 'invited' },
        { tenantId, userId: id, role: 'manager', status: 'inactive' },
      ]),
    );

    await withContext(app.db, { userId: id }, (tx) => activateInvitations(tx));

    const links = await owner.db.select().from(memberships).where(eq(memberships.userId, id));
    expect(Object.fromEntries(links.map((m) => [m.role, m.status]))).toEqual({
      field_agent: 'active',
      manager: 'inactive',
    });
  });
});
