import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type DbContext } from './client.js';
import { departments, memberships, teams, tenants, users } from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Cadastro de agentes e gestores pelo painel: funções SECURITY DEFINER (o RLS de users não deixa
// o gestor achar nem criar a conta de outra pessoa) e o nome de equipe único na prefeitura.
// O dono prepara os dados; as funções rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

let tenantA: string;
let tenantB: string;
let departmentA: string;
let managerId: string;
let adminId: string;
let agentId: string;
let citizenId: string;
let inactiveManagerId: string;
let otherTenantManagerId: string;
let otherTenantAdminId: string;
let otherTenantAgentId: string;

let phoneSeq = 0;
/** Telefone novo a cada chamada, para os testes não colidirem no índice único. */
function newPhone(): string {
  phoneSeq += 1;
  return `+55119770${String(phoneSeq).padStart(5, '0')}`;
}

let cpfSeq = 0;
function newCpf(): string {
  cpfSeq += 1;
  return `770${String(cpfSeq).padStart(8, '0')}`;
}

async function createTenant(label: string, ibgeCode: string): Promise<string> {
  const [tenant] = await owner.db
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
  return tenant!.id;
}

async function createUser(values: typeof users.$inferInsert): Promise<string> {
  const [user] = await owner.db.insert(users).values(values).returning();
  return user!.id;
}

async function link(
  tenantId: string,
  userId: string,
  role: 'citizen' | 'field_agent' | 'manager' | 'tenant_admin',
  status: 'active' | 'invited' | 'inactive' = 'active',
): Promise<void> {
  await owner.db.insert(memberships).values({ tenantId, userId, role, status });
}

interface PgError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Drizzle embrulha o erro do Postgres; devolve o erro original (código, mensagem, restrição). */
async function pgError(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: PgError }).cause;
    return cause ?? (error as PgError);
  }
  throw new Error('Era esperado que o banco recusasse a operação');
}

const asManager = (): DbContext => ({ tenantId: tenantA, userId: managerId });
const asAdmin = (): DbContext => ({ tenantId: tenantA, userId: adminId });

function findOrCreateAgent(context: DbContext, name: string, phone: string) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<{ id: string }>(
      sql`select panel_find_or_create_agent_user(${name}, ${phone}) as id`,
    );
    return result.rows[0]!.id;
  });
}

function findOrCreateManager(context: DbContext, name: string, cpf: string, email: string) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<{ id: string; email: string | null }>(
      sql`select id, email from panel_find_or_create_manager_user(${name}, ${cpf}, ${email})`,
    );
    return result.rows[0]!;
  });
}

function changeAgentPhone(context: DbContext, userId: string, phone: string) {
  return withContext(app.db, context, (tx) =>
    tx.execute(sql`select panel_change_agent_phone(${userId}, ${phone})`),
  );
}

function changeManagerEmail(context: DbContext, userId: string, email: string) {
  return withContext(app.db, context, (tx) =>
    tx.execute(sql`select panel_change_manager_email(${userId}, ${email})`),
  );
}

async function userRow(id: string) {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  return row!;
}

beforeAll(async () => {
  tenantA = await createTenant('Pessoas A', '0000061');
  tenantB = await createTenant('Pessoas B', '0000062');
  const [department] = await owner.db
    .insert(departments)
    .values({ tenantId: tenantA, name: 'Obras' })
    .returning();
  departmentA = department!.id;

  managerId = await createUser({ name: 'Gestora A', cpf: newCpf(), email: 'gestora@pessoas.dev' });
  await link(tenantA, managerId, 'manager');
  adminId = await createUser({ name: 'Admin A', cpf: newCpf(), email: 'admin@pessoas.dev' });
  await link(tenantA, adminId, 'tenant_admin');
  agentId = await createUser({ name: 'Agente A', phone: newPhone() });
  await link(tenantA, agentId, 'field_agent');
  citizenId = await createUser({ name: 'Cidadã A', phone: newPhone() });
  await link(tenantA, citizenId, 'citizen');
  inactiveManagerId = await createUser({ name: 'Gestor inativo', cpf: newCpf() });
  await link(tenantA, inactiveManagerId, 'manager', 'inactive');
  otherTenantManagerId = await createUser({ name: 'Gestor B', cpf: newCpf() });
  await link(tenantB, otherTenantManagerId, 'manager');
  otherTenantAdminId = await createUser({ name: 'Admin B', cpf: newCpf() });
  await link(tenantB, otherTenantAdminId, 'tenant_admin');
  otherTenantAgentId = await createUser({ name: 'Agente B', phone: newPhone() });
  await link(tenantB, otherTenantAgentId, 'field_agent', 'invited');
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('cadastro de agentes pelo painel', () => {
  it('agente com celular novo cria a conta', async () => {
    const phone = newPhone();
    const id = await findOrCreateAgent(asManager(), 'Joana Campos', phone);
    expect(await userRow(id)).toMatchObject({
      name: 'Joana Campos',
      phone,
      email: null,
      cpf: null,
      accountStatus: 'active',
      lastActiveAt: null,
    });
    // Chamada repetida acha a mesma conta.
    expect(await findOrCreateAgent(asAdmin(), 'Outro nome', phone)).toBe(id);
  });

  it('agente com celular de cidadão usa a conta existente', async () => {
    const phone = newPhone();
    const existing = await createUser({ name: 'Cidadão Antigo', phone });
    const id = await findOrCreateAgent(asManager(), 'Nome digitado', phone);
    expect(id).toBe(existing);
    // A conta que já existe mantém o próprio nome.
    expect((await userRow(id)).name).toBe('Cidadão Antigo');

    // Conta congelada com o mesmo número não conta: nasce outra.
    const frozenPhone = newPhone();
    const frozen = await createUser({
      name: 'Congelada',
      phone: frozenPhone,
      accountStatus: 'frozen',
    });
    const fresh = await findOrCreateAgent(asManager(), 'Conta nova', frozenPhone);
    expect(fresh).not.toBe(frozen);
  });

  it('quem não é do painel não chama as funções de cadastro', async () => {
    const callers: DbContext[] = [
      // Agente e cidadão da prefeitura.
      { tenantId: tenantA, userId: agentId },
      { tenantId: tenantA, userId: citizenId },
      // Gestor desativado.
      { tenantId: tenantA, userId: inactiveManagerId },
      // Gestor e admin de outra prefeitura, com esta no contexto.
      { tenantId: tenantA, userId: otherTenantManagerId },
      { tenantId: tenantA, userId: otherTenantAdminId },
      // Sem usuário no contexto.
      { tenantId: tenantA },
    ];
    for (const context of callers) {
      const errors = [
        await pgError(findOrCreateAgent(context, 'Fulano', newPhone())),
        await pgError(findOrCreateManager(context, 'Fulano', newCpf(), 'fulano@pessoas.dev')),
        await pgError(changeAgentPhone(context, agentId, newPhone())),
        await pgError(changeManagerEmail(context, managerId, 'outro@pessoas.dev')),
      ];
      for (const error of errors) expect(error.code).toBe('42501');
    }
    // Nada mudou.
    expect((await userRow(managerId)).email).toBe('gestora@pessoas.dev');
  });

  it('troca de número recusada para quem já entrou', async () => {
    // Quem nunca entrou troca.
    const newAgent = await findOrCreateAgent(asManager(), 'Pedro Lima', newPhone());
    await link(tenantA, newAgent, 'field_agent', 'invited');
    const phone = newPhone();
    await changeAgentPhone(asManager(), newAgent, phone);
    expect((await userRow(newAgent)).phone).toBe(phone);

    // Quem já entrou no app troca no Perfil.
    await owner.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, newAgent));
    const refused = await pgError(changeAgentPhone(asManager(), newAgent, newPhone()));
    expect(refused).toMatchObject({ code: '23514', message: 'phone_change_not_allowed' });
    expect((await userRow(newAgent)).phone).toBe(phone);

    // Só para agentes desta prefeitura: cidadão, gestor e agente de outra prefeitura não.
    for (const target of [citizenId, managerId, otherTenantAgentId]) {
      const notAgent = await pgError(changeAgentPhone(asManager(), target, newPhone()));
      expect(notAgent.code).toBe('P0002');
    }
  });

  it('troca de número recusada para agente que também é de outra prefeitura', async () => {
    // Convidado nas duas e nunca entrou: o login é global, a troca mexeria no acesso da outra.
    const shared = await findOrCreateAgent(asManager(), 'Rui Prado', newPhone());
    await link(tenantA, shared, 'field_agent', 'invited');
    await link(tenantB, shared, 'field_agent', 'invited');
    const before = (await userRow(shared)).phone;
    const refused = await pgError(changeAgentPhone(asManager(), shared, newPhone()));
    expect(refused).toMatchObject({ code: '23514', message: 'phone_change_not_allowed' });
    expect((await userRow(shared)).phone).toBe(before);

    // Vínculo de outro papel (cidadão) em outra prefeitura também conta.
    const citizenElsewhere = await findOrCreateAgent(asManager(), 'Lia Matos', newPhone());
    await link(tenantA, citizenElsewhere, 'field_agent', 'invited');
    await link(tenantB, citizenElsewhere, 'citizen', 'inactive');
    expect(await pgError(changeAgentPhone(asAdmin(), citizenElsewhere, newPhone()))).toMatchObject({
      code: '23514',
      message: 'phone_change_not_allowed',
    });
  });

  it('troca de número para um número em uso cai no índice único', async () => {
    const target = await findOrCreateAgent(asManager(), 'Ana Souza', newPhone());
    await link(tenantA, target, 'field_agent', 'invited');
    const taken = (await userRow(citizenId)).phone!;
    const error = await pgError(changeAgentPhone(asManager(), target, taken));
    expect(error).toMatchObject({ code: '23505', constraint: 'users_phone_active_idx' });
  });
});

describe('cadastro de gestores pelo painel', () => {
  it('gestor com CPF existente mantém o e-mail', async () => {
    // CPF novo: cria a conta com nome, CPF e e-mail.
    const cpf = newCpf();
    const created = await findOrCreateManager(asAdmin(), 'Marta Reis', cpf, 'marta@pessoas.dev');
    expect(created.email).toBe('marta@pessoas.dev');
    expect(await userRow(created.id)).toMatchObject({
      name: 'Marta Reis',
      cpf,
      email: 'marta@pessoas.dev',
      phone: null,
    });

    // CPF existente: devolve o e-mail que a conta já tem; a API compara com o digitado.
    const again = await findOrCreateManager(asAdmin(), 'Outro nome', cpf, 'outro@pessoas.dev');
    expect(again).toEqual({ id: created.id, email: 'marta@pessoas.dev' });
    expect(await userRow(created.id)).toMatchObject({
      name: 'Marta Reis',
      email: 'marta@pessoas.dev',
    });
  });

  it('gestor com CPF existente sem e-mail recebe o digitado', async () => {
    const cpf = newCpf();
    const existing = await createUser({ name: 'Cidadão com CPF', cpf, phone: newPhone() });
    // Só o admin cadastra gestor.
    const byManager = await pgError(
      findOrCreateManager(asManager(), 'Nome digitado', cpf, 'novo@pessoas.dev'),
    );
    expect(byManager.code).toBe('42501');
    expect((await userRow(existing)).email).toBeNull();

    const found = await findOrCreateManager(asAdmin(), 'Nome digitado', cpf, 'novo@pessoas.dev');
    expect(found).toEqual({ id: existing, email: 'novo@pessoas.dev' });
    expect(await userRow(existing)).toMatchObject({
      name: 'Cidadão com CPF',
      email: 'novo@pessoas.dev',
    });

    // E-mail de outra conta cai no índice único, sem diferenciar maiúsculas.
    const inUse = await pgError(
      findOrCreateManager(asAdmin(), 'Fulano', newCpf(), 'GESTORA@pessoas.dev'),
    );
    expect(inUse).toMatchObject({ code: '23505', constraint: 'users_email_lower_idx' });
    const cpfWithoutEmail = newCpf();
    await createUser({ name: 'Sem e-mail', cpf: cpfWithoutEmail });
    const inUseOnUpdate = await pgError(
      findOrCreateManager(asAdmin(), 'Fulano', cpfWithoutEmail, 'admin@pessoas.dev'),
    );
    expect(inUseOnUpdate).toMatchObject({ code: '23505', constraint: 'users_email_lower_idx' });
  });

  it('só o admin troca o e-mail do gestor', async () => {
    const target = await findOrCreateManager(
      asAdmin(),
      'Paulo Neves',
      newCpf(),
      'paulo@pessoas.dev',
    );
    await link(tenantA, target.id, 'manager');

    const byManager = await pgError(changeManagerEmail(asManager(), target.id, 'p@pessoas.dev'));
    expect(byManager.code).toBe('42501');

    await changeManagerEmail(asAdmin(), target.id, 'paulo.neves@pessoas.dev');
    expect((await userRow(target.id)).email).toBe('paulo.neves@pessoas.dev');

    // E-mail de outra conta cai no índice único.
    const inUse = await pgError(changeManagerEmail(asAdmin(), target.id, 'gestora@pessoas.dev'));
    expect(inUse).toMatchObject({ code: '23505', constraint: 'users_email_lower_idx' });

    // Alvo que não é gestor desta prefeitura.
    for (const other of [agentId, otherTenantManagerId]) {
      const notManager = await pgError(changeManagerEmail(asAdmin(), other, 'x@pessoas.dev'));
      expect(notManager.code).toBe('P0002');
    }
  });

  it('troca de e-mail recusada para quem tem outro acesso de gestão', async () => {
    const notAllowed = { code: '23514', message: 'email_change_not_allowed' };
    const manager = async (email: string, values: Partial<typeof users.$inferInsert> = {}) => {
      const id = await createUser({ name: 'Gestor', cpf: newCpf(), email, ...values });
      await link(tenantA, id, 'manager');
      return id;
    };

    // Equipe interna da plataforma.
    const staff = await manager('suporte@pessoas.dev', { platformRole: 'support' });
    // Gestor também em outra prefeitura, mesmo desativado lá.
    const alsoB = await manager('tambem.b@pessoas.dev');
    await link(tenantB, alsoB, 'manager', 'inactive');
    // Admin de outra prefeitura.
    const adminB = await manager('admin.b@pessoas.dev');
    await link(tenantB, adminB, 'tenant_admin');
    // Admin desta prefeitura (e gestor).
    const adminHere = await manager('admin.aqui@pessoas.dev');
    await link(tenantA, adminHere, 'tenant_admin');

    for (const [id, email] of [
      [staff, 'suporte@pessoas.dev'],
      [alsoB, 'tambem.b@pessoas.dev'],
      [adminB, 'admin.b@pessoas.dev'],
      [adminHere, 'admin.aqui@pessoas.dev'],
    ] as const) {
      expect(
        await pgError(changeManagerEmail(asAdmin(), id, 'novo.login@pessoas.dev')),
      ).toMatchObject(notAllowed);
      expect((await userRow(id)).email).toBe(email);
    }

    // Conta congelada não é alvo.
    const frozen = await manager('congelado@pessoas.dev', { accountStatus: 'frozen' });
    expect((await pgError(changeManagerEmail(asAdmin(), frozen, 'y@pessoas.dev'))).code).toBe(
      'P0002',
    );

    // Gestor só desta prefeitura, desativado aqui: troca.
    const onlyHere = await createUser({ name: 'Só aqui', cpf: newCpf(), email: 'so@pessoas.dev' });
    await link(tenantA, onlyHere, 'manager', 'inactive');
    await link(tenantB, onlyHere, 'citizen');
    await changeManagerEmail(asAdmin(), onlyHere, 'so.aqui@pessoas.dev');
    expect((await userRow(onlyHere)).email).toBe('so.aqui@pessoas.dev');
  });
});

describe('equipes', () => {
  it('nome de equipe repetido na prefeitura é recusado sem diferenciar maiúsculas', async () => {
    const newTeam = (tenantId: string, departmentId: string, name: string) =>
      withContext(app.db, { tenantId, userId: managerId }, (tx) =>
        tx.insert(teams).values({ tenantId, departmentId, name }),
      );
    await newTeam(tenantA, departmentA, 'Equipe Vila Nova');
    const repeated = await pgError(newTeam(tenantA, departmentA, 'equipe vila NOVA'));
    expect(repeated).toMatchObject({ code: '23505', constraint: 'teams_tenant_name_idx' });

    // Em outra prefeitura o nome é livre.
    const [departmentB] = await owner.db
      .insert(departments)
      .values({ tenantId: tenantB, name: 'Obras' })
      .returning();
    await newTeam(tenantB, departmentB!.id, 'Equipe Vila Nova');
  });
});
