import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type Database } from './client.js';
import {
  cityInterest,
  memberships,
  municipalityLeads,
  staffAuditEvents,
  tenantContracts,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Contas sem senha, papéis da equipe interna, contrato, auditoria e interesse por cidade.
// O dono do banco prepara os dados; os testes rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

let tenantA: string;
let tenantB: string;
let citizenId: string;
let otherCitizenId: string;
let supportId: string;
let adminId: string;

async function createTenant(db: Database, label: string, ibgeCode: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: `Município de ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status: 'active',
    })
    .returning();
  return tenant!.id;
}

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

beforeAll(async () => {
  tenantA = await createTenant(owner.db, 'Plataforma A', '0000101');
  tenantB = await createTenant(owner.db, 'Plataforma B', '0000102');
  citizenId = await createUser(owner.db, {
    name: 'Cidadã',
    phone: '+5511940000001',
    cpf: '12345678901',
    email: 'cidada@plataforma.dev',
  });
  otherCitizenId = await createUser(owner.db, { name: 'Outro cidadão', phone: '+5511940000002' });
  supportId = await createUser(owner.db, {
    name: 'Suporte',
    phone: '+5511940000003',
    cpf: '12345678903',
    platformRole: 'support',
  });
  adminId = await createUser(owner.db, {
    name: 'Admin',
    phone: '+5511940000004',
    platformRole: 'admin',
  });
  await withContext(owner.db, { tenantId: tenantA }, (tx) =>
    tx.insert(memberships).values({ tenantId: tenantA, userId: citizenId, role: 'citizen' }),
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('contas', () => {
  it('número reaproveitado: só uma conta ativa por telefone', async () => {
    const phone = '+5511940000099';
    const firstId = await createUser(owner.db, { name: 'Dono antigo', phone });
    const duplicate = await dbError(createUser(owner.db, { name: 'Dono novo', phone }));
    expect(duplicate).toMatch(/users_phone_active_idx/);

    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, firstId));
    const secondId = await createUser(owner.db, { name: 'Dono novo', phone });
    expect(secondId).not.toBe(firstId);
  });

  it('recusa telefone fora do E.164 e CPF com pontuação', async () => {
    expect(await dbError(createUser(owner.db, { name: 'X', phone: '11 94000-0000' }))).toMatch(
      /users_phone_check/,
    );
    expect(
      await dbError(
        createUser(owner.db, { name: 'X', phone: '+5511940000098', cpf: '123.456.789-01' }),
      ),
    ).toMatch(/users_cpf_check/);
    expect(await dbError(createUser(owner.db, { name: 'X', email: 'so@email.dev' }))).toMatch(
      /users_phone_or_cpf_check/,
    );
  });

  it('o usuário não consegue se dar papel interno nem mudar o estado da conta', async () => {
    const role = await dbError(
      withContext(app.db, { userId: citizenId }, (tx) =>
        tx.update(users).set({ platformRole: 'admin' }).where(eq(users.id, citizenId)),
      ),
    );
    const status = await dbError(
      withContext(app.db, { userId: citizenId }, (tx) =>
        tx.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, citizenId)),
      ),
    );
    expect(role).toMatch(/permission denied/);
    expect(status).toMatch(/permission denied/);
  });

  it('login acha a conta ativa pelo telefone e pelo CPF, sem contexto', async () => {
    const byPhone = await withContext(app.db, {}, (tx) =>
      tx.execute(sql`select * from auth_find_user_by_phone(${'+5511940000001'})`),
    );
    expect(byPhone.rows).toEqual([{ id: citizenId, last_active_at: null, has_email: true }]);

    const byCpf = await withContext(app.db, {}, (tx) =>
      tx.execute(sql`select * from auth_find_user_by_cpf(${'12345678903'})`),
    );
    expect(byCpf.rows).toEqual([{ id: supportId, email: null, platform_role: 'support' }]);

    const frozenPhone = '+5511940000097';
    const frozenId = await createUser(owner.db, { name: 'Congelado', phone: frozenPhone });
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenId));
    const frozen = await withContext(app.db, {}, (tx) =>
      tx.execute(sql`select * from auth_find_user_by_phone(${frozenPhone})`),
    );
    expect(frozen.rows).toEqual([]);
  });

  it('conta congelada não aparece no login por CPF', async () => {
    const cpf = '12345678999';
    const id = await createUser(owner.db, { name: 'Congelada', phone: '+5511940000096', cpf });
    const active = await withContext(app.db, {}, (tx) =>
      tx.execute(sql`select * from auth_find_user_by_cpf(${cpf})`),
    );
    expect(active.rows).toHaveLength(1);

    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, id));
    const frozen = await withContext(app.db, {}, (tx) =>
      tx.execute(sql`select * from auth_find_user_by_cpf(${cpf})`),
    );
    expect(frozen.rows).toEqual([]);
  });
});

describe('equipe interna', () => {
  const newTenant = (ibgeCode: string) => ({
    name: 'Município Novo',
    displayName: 'Prefeitura Nova',
    city: 'Nova',
    state: 'MG',
    ibgeCode,
  });
  const newContract = () => ({
    tenantId: tenantA,
    plan: 'essencial',
    startsOn: '2026-11-01',
    includedPanelUsers: 10,
  });

  it('suporte não mexe em prefeitura nem contrato', async () => {
    const support = { userId: supportId, platformRole: 'support' } as const;
    const admin = { userId: adminId, platformRole: 'admin' } as const;

    expect(
      await dbError(
        withContext(app.db, support, (tx) => tx.insert(tenants).values(newTenant('0000103'))),
      ),
    ).toMatch(/row-level security/);
    expect(
      await dbError(
        withContext(app.db, support, (tx) => tx.insert(tenantContracts).values(newContract())),
      ),
    ).toMatch(/row-level security/);

    await withContext(app.db, admin, async (tx) => {
      await tx.insert(tenants).values(newTenant('0000104'));
      await tx.insert(tenantContracts).values(newContract());
    });

    const contracts = await withContext(app.db, support, (tx) => tx.select().from(tenantContracts));
    expect(contracts.map((c) => c.tenantId)).toEqual([tenantA]);

    // Cidadão não vê contrato.
    const hidden = await withContext(app.db, { userId: citizenId, tenantId: tenantA }, (tx) =>
      tx.select().from(tenantContracts),
    );
    expect(hidden).toHaveLength(0);
  });

  it('suporte não altera conta da equipe interna', async () => {
    const support = { userId: supportId, platformRole: 'support' } as const;
    const admin = { userId: adminId, platformRole: 'admin' } as const;

    // Sem isso o suporte trocaria o e-mail do admin e receberia o código de login do painel.
    const blocked = await withContext(app.db, support, (tx) =>
      tx
        .update(users)
        .set({ email: 'suporte-no-controle@evil.dev' })
        .where(eq(users.id, adminId))
        .returning({ id: users.id }),
    );
    expect(blocked).toHaveLength(0);
    const ownAccount = await withContext(app.db, support, (tx) =>
      tx
        .update(users)
        .set({ name: 'Renomeado' })
        .where(eq(users.id, supportId))
        .returning({ id: users.id }),
    );
    // A própria conta continua editável.
    expect(ownAccount).toHaveLength(1);
    const [untouched] = await owner.db.select().from(users).where(eq(users.id, adminId));
    expect(untouched!.email).toBeNull();

    const changed = await withContext(app.db, admin, (tx) =>
      tx
        .update(users)
        .set({ email: 'admin@plataforma.dev' })
        .where(eq(users.id, adminId))
        .returning({ id: users.id }),
    );
    expect(changed).toHaveLength(1);

    const citizen = await withContext(app.db, support, (tx) =>
      tx
        .update(users)
        .set({ name: 'Cidadã Atendida' })
        .where(eq(users.id, citizenId))
        .returning({ id: users.id }),
    );
    expect(citizen).toHaveLength(1);
  });

  it('suporte não altera contrato', async () => {
    const support = { userId: supportId, platformRole: 'support' } as const;
    const admin = { userId: adminId, platformRole: 'admin' } as const;
    await owner.db.delete(tenantContracts).where(eq(tenantContracts.tenantId, tenantB));
    await owner.db.insert(tenantContracts).values({
      tenantId: tenantB,
      plan: 'essencial',
      startsOn: '2026-11-01',
      includedPanelUsers: 5,
    });

    const blocked = await withContext(app.db, support, (tx) =>
      tx
        .update(tenantContracts)
        .set({ includedPanelUsers: 99 })
        .where(eq(tenantContracts.tenantId, tenantB))
        .returning({ id: tenantContracts.id }),
    );
    expect(blocked).toHaveLength(0);

    const allowed = await withContext(app.db, admin, (tx) =>
      tx
        .update(tenantContracts)
        .set({ includedPanelUsers: 6 })
        .where(eq(tenantContracts.tenantId, tenantB))
        .returning({ id: tenantContracts.id }),
    );
    expect(allowed).toHaveLength(1);
  });

  it('contrato não termina antes de começar nem tem zero usuários de painel', async () => {
    expect(
      await dbError(
        owner.db.insert(tenantContracts).values({ ...newContract(), endsOn: '2026-10-31' }),
      ),
    ).toMatch(/check constraint/);
    expect(
      await dbError(
        owner.db.insert(tenantContracts).values({ ...newContract(), includedPanelUsers: 0 }),
      ),
    ).toMatch(/check constraint/);
  });

  it('suporte dentro da prefeitura enxerga os usuários dela', async () => {
    const rows = await withContext(
      app.db,
      { tenantId: tenantA, userId: supportId, platformRole: 'support' },
      (tx) => tx.select({ id: users.id }).from(users),
    );
    expect(rows.map((r) => r.id)).toContain(citizenId);
  });

  it('auditoria: só a equipe interna grava, a prefeitura lê, ninguém altera', async () => {
    const event = (staffUserId: string) => ({
      tenantId: tenantA,
      staffUserId,
      action: 'request.view',
      targetType: 'request',
    });

    expect(
      await dbError(
        withContext(app.db, { tenantId: tenantA, userId: citizenId }, (tx) =>
          tx.insert(staffAuditEvents).values(event(citizenId)),
        ),
      ),
    ).toMatch(/row-level security/);

    const support = { tenantId: tenantA, userId: supportId, platformRole: 'support' } as const;
    // Suporte não grava em nome de outra pessoa.
    expect(
      await dbError(
        withContext(app.db, support, (tx) => tx.insert(staffAuditEvents).values(event(adminId))),
      ),
    ).toMatch(/row-level security/);
    await withContext(app.db, support, (tx) =>
      tx.insert(staffAuditEvents).values(event(supportId)),
    );

    const readByTenant = await withContext(app.db, { tenantId: tenantA, userId: citizenId }, (tx) =>
      tx.select().from(staffAuditEvents),
    );
    expect(readByTenant.map((e) => e.staffUserId)).toEqual([supportId]);

    const readByOther = await withContext(app.db, { tenantId: tenantB }, (tx) =>
      tx.select().from(staffAuditEvents),
    );
    expect(readByOther).toHaveLength(0);

    const updateError = await dbError(
      withContext(app.db, support, (tx) => tx.update(staffAuditEvents).set({ action: 'apagado' })),
    );
    const deleteError = await dbError(
      withContext(app.db, support, (tx) => tx.delete(staffAuditEvents)),
    );
    expect(updateError).toMatch(/permission denied/);
    expect(deleteError).toMatch(/permission denied/);
  });
});

describe('interesse e situação comercial do município', () => {
  const IBGE = '3550308';

  it('interesse por cidade: cada um registra o seu, uma vez por município', async () => {
    await withContext(app.db, { userId: citizenId }, (tx) =>
      tx.insert(cityInterest).values({ ibgeCode: IBGE, userId: citizenId }),
    );
    expect(
      await dbError(
        withContext(app.db, { userId: citizenId }, (tx) =>
          tx.insert(cityInterest).values({ ibgeCode: IBGE, userId: citizenId }),
        ),
      ),
    ).toMatch(/duplicate key/);
    expect(
      await dbError(
        withContext(app.db, { userId: citizenId }, (tx) =>
          tx.insert(cityInterest).values({ ibgeCode: IBGE, userId: otherCitizenId }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await dbError(
        withContext(app.db, { userId: otherCitizenId }, (tx) =>
          tx.insert(cityInterest).values({ ibgeCode: '355030', userId: otherCitizenId }),
        ),
      ),
    ).toMatch(/check constraint/);
    await withContext(app.db, { userId: otherCitizenId }, (tx) =>
      tx.insert(cityInterest).values({ ibgeCode: IBGE, userId: otherCitizenId }),
    );

    const own = await withContext(app.db, { userId: otherCitizenId }, (tx) =>
      tx.select().from(cityInterest),
    );
    expect(own.map((r) => r.userId)).toEqual([otherCitizenId]);

    const all = await withContext(app.db, { userId: supportId, platformRole: 'support' }, (tx) =>
      tx.select().from(cityInterest).where(eq(cityInterest.ibgeCode, IBGE)),
    );
    expect(all.map((r) => r.userId).toSorted()).toEqual([citizenId, otherCitizenId].toSorted());
  });

  it('situação comercial do município: só a equipe interna lê e grava', async () => {
    const support = { userId: supportId, platformRole: 'support' } as const;
    await withContext(app.db, support, (tx) =>
      tx.insert(municipalityLeads).values({ ibgeCode: IBGE, updatedBy: supportId }),
    );
    await withContext(app.db, support, (tx) =>
      tx
        .update(municipalityLeads)
        .set({ commercialStatus: 'contacted' })
        .where(eq(municipalityLeads.ibgeCode, IBGE)),
    );
    const [lead] = await withContext(app.db, support, (tx) => tx.select().from(municipalityLeads));
    expect(lead!.commercialStatus).toBe('contacted');

    const hidden = await withContext(app.db, { userId: citizenId }, (tx) =>
      tx.select().from(municipalityLeads),
    );
    expect(hidden).toHaveLength(0);
    expect(
      await dbError(
        withContext(app.db, { userId: citizenId }, (tx) =>
          tx.insert(municipalityLeads).values({ ibgeCode: '3304557', updatedBy: citizenId }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
