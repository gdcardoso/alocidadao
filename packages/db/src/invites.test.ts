import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type DbContext } from './client.js';
import {
  departments,
  inviteDeliveries,
  memberships,
  teamMembers,
  teams,
  tenants,
  users,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Convites: e-mail do agente no cadastro e na troca pelo painel, registro das entregas
// (invite_deliveries) e a lista de agentes que ainda não receberam o convite. Funções SECURITY
// DEFINER; o dono prepara os dados e as funções rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

let phoneSeq = 0;
function newPhone(): string {
  phoneSeq += 1;
  return `+55119330${String(phoneSeq).padStart(5, '0')}`;
}
let cpfSeq = 0;
function newCpf(): string {
  cpfSeq += 1;
  return `330${String(cpfSeq).padStart(8, '0')}`;
}
let emailSeq = 0;
function newEmail(): string {
  emailSeq += 1;
  return `pessoa${emailSeq}@convites.dev`;
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

async function createTenant(label: string, ibgeCode: string) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'GO',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const tenantId = tenant!.id;
  const [department] = await owner.db
    .insert(departments)
    .values({ tenantId, name: 'Obras' })
    .returning();
  const [team] = await owner.db
    .insert(teams)
    .values({ tenantId, departmentId: department!.id, name: `Equipe ${label}` })
    .returning();
  return { tenantId, teamId: team!.id };
}

async function createUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Pessoa', phone: newPhone(), ...values })
    .returning();
  return user!.id;
}

async function userRow(id: string) {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  return row!;
}

async function link(
  tenantId: string,
  userId: string,
  role: 'citizen' | 'field_agent' | 'manager' | 'tenant_admin',
  status: 'active' | 'invited' | 'inactive' = 'active',
): Promise<void> {
  await owner.db.insert(memberships).values({ tenantId, userId, role, status });
}

function call<T extends Record<string, unknown>>(
  context: DbContext,
  query: ReturnType<typeof sql>,
) {
  return withContext(app.db, context, async (tx) => (await tx.execute<T>(query)).rows);
}

function findOrCreateAgent(context: DbContext, name: string, phone: string, email: string | null) {
  return call<{ id: string; email: string | null }>(
    context,
    sql`select id, email from panel_find_or_create_agent_user(${name}, ${phone}, ${email})`,
  ).then((rows) => rows[0]!);
}

function changeAgentEmail(context: DbContext, userId: string, email: string) {
  return call(context, sql`select panel_change_agent_email(${userId}, ${email})`);
}

function record(
  context: DbContext,
  userId: string,
  tenantId: string | null,
  kind: 'panel' | 'agent' | 'staff',
  minIntervalSeconds: number | null,
) {
  return call<{ wait: number }>(
    context,
    sql`select invite_record(${userId}, ${tenantId}, ${kind}::invite_kind, ${minIntervalSeconds}) as wait`,
  ).then((rows) => rows[0]!.wait);
}

function deliveries(userId: string) {
  return owner.db.select().from(inviteDeliveries).where(eq(inviteDeliveries.userId, userId));
}

let a: { tenantId: string; teamId: string };
let b: { tenantId: string; teamId: string };
let managerA: string;
let adminA: string;
let inactiveManagerA: string;
let managerB: string;
let agentA: string;
let supportId: string;
let platformAdminId: string;

const asManagerA = (): DbContext => ({ tenantId: a.tenantId, userId: managerA });
const asAdminA = (): DbContext => ({ tenantId: a.tenantId, userId: adminA });
const asManagerB = (): DbContext => ({ tenantId: b.tenantId, userId: managerB });
const asSupport = (tenantId?: string): DbContext => ({
  tenantId,
  userId: supportId,
  platformRole: 'support',
});
const asPlatformAdmin = (tenantId?: string): DbContext => ({
  tenantId,
  userId: platformAdminId,
  platformRole: 'admin',
});

beforeAll(async () => {
  a = await createTenant('Convite A', '0000401');
  b = await createTenant('Convite B', '0000402');
  managerA = await createUser({ name: 'Gestor A', cpf: newCpf(), email: newEmail() });
  await link(a.tenantId, managerA, 'manager');
  adminA = await createUser({ name: 'Admin A', cpf: newCpf(), email: newEmail() });
  await link(a.tenantId, adminA, 'tenant_admin');
  inactiveManagerA = await createUser({ name: 'Gestor saiu', cpf: newCpf(), email: newEmail() });
  await link(a.tenantId, inactiveManagerA, 'manager', 'inactive');
  managerB = await createUser({ name: 'Gestor B', cpf: newCpf(), email: newEmail() });
  await link(b.tenantId, managerB, 'manager');
  agentA = await createUser({ name: 'Agente A', email: newEmail() });
  await link(a.tenantId, agentA, 'field_agent');
  supportId = await createUser({
    name: 'Suporte',
    cpf: newCpf(),
    email: newEmail(),
    platformRole: 'support',
  });
  platformAdminId = await createUser({
    name: 'Admin plataforma',
    cpf: newCpf(),
    email: newEmail(),
    platformRole: 'admin',
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('cadastro do agente com e-mail', () => {
  it('cria agente novo já com e-mail', async () => {
    const email = newEmail();
    const found = await findOrCreateAgent(asManagerA(), 'Novo', newPhone(), email);
    expect(found.email).toBe(email);
    expect((await userRow(found.id)).email).toBe(email);
  });

  it('pessoa achada pelo celular sem e-mail recebe o e-mail', async () => {
    const phone = newPhone();
    const citizen = await createUser({ name: 'Cidadão', phone });
    const email = newEmail();
    const found = await findOrCreateAgent(asManagerA(), 'Outro nome', phone, email);
    expect(found).toEqual({ id: citizen, email });
    const row = await userRow(citizen);
    expect(row.email).toBe(email);
    expect(row.name).toBe('Cidadão');
  });

  it('pessoa achada com outro e-mail devolve o e-mail existente sem trocar', async () => {
    const phone = newPhone();
    const existing = newEmail();
    const citizen = await createUser({ phone, email: existing });
    const found = await findOrCreateAgent(asManagerA(), 'X', phone, newEmail());
    expect(found).toEqual({ id: citizen, email: existing });
    expect((await userRow(citizen)).email).toBe(existing);
  });

  it('e-mail nulo acha ou cria sem mexer no e-mail', async () => {
    const created = await findOrCreateAgent(asManagerA(), 'Sem e-mail', newPhone(), null);
    expect(created.email).toBeNull();

    const phone = newPhone();
    const existing = newEmail();
    const citizen = await createUser({ phone, email: existing });
    expect(await findOrCreateAgent(asManagerA(), 'X', phone, null)).toEqual({
      id: citizen,
      email: existing,
    });
  });

  it('e-mail de outra conta cai no índice único', async () => {
    const taken = newEmail();
    await createUser({ email: taken });
    expect(
      await pgError(findOrCreateAgent(asManagerA(), 'X', newPhone(), taken.toUpperCase())),
    ).toMatchObject({ code: '23505', constraint: 'users_email_lower_idx' });
  });

  it('pessoa achada sem e-mail, agente de outra prefeitura: recusa gravar o e-mail', async () => {
    const phone = newPhone();
    const person = await createUser({ phone });
    await link(b.tenantId, person, 'field_agent');
    expect(await pgError(findOrCreateAgent(asManagerA(), 'X', phone, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
    expect((await userRow(person)).email).toBeNull();
  });

  it('pessoa achada sem e-mail, cidadã de outra prefeitura: recusa gravar o e-mail', async () => {
    const phone = newPhone();
    const person = await createUser({ phone });
    await link(b.tenantId, person, 'citizen');
    expect(await pgError(findOrCreateAgent(asManagerA(), 'X', phone, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
    expect((await userRow(person)).email).toBeNull();
  });

  it('pessoa achada sem e-mail com acesso de gestão: recusa', async () => {
    for (const tenantId of [a.tenantId, b.tenantId]) {
      const phone = newPhone();
      const person = await createUser({ phone, cpf: newCpf() });
      await link(tenantId, person, 'manager');
      expect(await pgError(findOrCreateAgent(asManagerA(), 'X', phone, newEmail()))).toMatchObject({
        code: '23514',
        message: 'email_change_not_allowed',
      });
      expect((await userRow(person)).email).toBeNull();
    }
  });

  it('modo suporte grava', async () => {
    const phone = newPhone();
    const person = await createUser({ phone });
    await link(b.tenantId, person, 'field_agent');
    const email = newEmail();
    expect(await findOrCreateAgent(asSupport(a.tenantId), 'X', phone, email)).toEqual({
      id: person,
      email,
    });
  });

  it('pessoa achada com e-mail e travada devolve o e-mail sem recusar', async () => {
    const phone = newPhone();
    const existing = newEmail();
    const person = await createUser({ phone, email: existing });
    await link(b.tenantId, person, 'field_agent');
    expect(await findOrCreateAgent(asManagerA(), 'X', phone, newEmail())).toEqual({
      id: person,
      email: existing,
    });
  });

  it('recusa quem não é gestor da prefeitura', async () => {
    const asAgent: DbContext = { tenantId: a.tenantId, userId: agentA };
    expect((await pgError(findOrCreateAgent(asAgent, 'X', newPhone(), newEmail()))).code).toBe(
      '42501',
    );
  });
});

describe('troca de e-mail do agente', () => {
  it('troca de e-mail do agente recusa gestor de outra prefeitura', async () => {
    const person = await createUser({ email: newEmail() });
    await link(a.tenantId, person, 'field_agent');
    await link(b.tenantId, person, 'manager');
    expect(await pgError(changeAgentEmail(asManagerA(), person, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
  });

  it('recusa agente que também tem acesso de gestão nesta prefeitura', async () => {
    const person = await createUser({ email: newEmail() });
    await link(a.tenantId, person, 'field_agent');
    await link(a.tenantId, person, 'tenant_admin');
    expect(await pgError(changeAgentEmail(asManagerA(), person, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
  });

  it('troca de e-mail do agente recusa cidadã de outra prefeitura', async () => {
    const person = await createUser();
    await link(a.tenantId, person, 'field_agent');
    await link(b.tenantId, person, 'citizen');
    expect(await pgError(changeAgentEmail(asManagerA(), person, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
    expect((await userRow(person)).email).toBeNull();
  });

  it('recusa agente de outra prefeitura', async () => {
    const person = await createUser({ email: newEmail() });
    await link(a.tenantId, person, 'field_agent', 'invited');
    await link(b.tenantId, person, 'field_agent', 'invited');
    expect(await pgError(changeAgentEmail(asManagerA(), person, newEmail()))).toMatchObject({
      code: '23514',
      message: 'email_change_not_allowed',
    });
  });

  it('aceita agente só desta prefeitura', async () => {
    const person = await createUser();
    await link(a.tenantId, person, 'field_agent');
    const email = newEmail();
    await changeAgentEmail(asManagerA(), person, email);
    expect((await userRow(person)).email).toBe(email);
  });

  it('equipe interna em modo suporte troca', async () => {
    const person = await createUser({ email: newEmail() });
    await link(a.tenantId, person, 'field_agent');
    await link(b.tenantId, person, 'field_agent');
    const email = newEmail();
    await changeAgentEmail(asSupport(a.tenantId), person, email);
    expect((await userRow(person)).email).toBe(email);
  });

  it('conta da equipe interna nunca troca', async () => {
    // Vínculo de antes de entrar na equipe (o gatilho barra vínculo novo de conta da equipe).
    const person = await createUser({ email: newEmail() });
    await link(a.tenantId, person, 'field_agent');
    await owner.db.update(users).set({ platformRole: 'support' }).where(eq(users.id, person));
    expect(
      await pgError(changeAgentEmail(asPlatformAdmin(a.tenantId), person, newEmail())),
    ).toMatchObject({ code: '23514', message: 'email_change_not_allowed' });
  });

  it('agente de outra prefeitura não é achado', async () => {
    const person = await createUser();
    await link(b.tenantId, person, 'field_agent');
    expect((await pgError(changeAgentEmail(asManagerA(), person, newEmail()))).code).toBe('P0002');
  });

  it('e-mail de outra conta cai no índice único', async () => {
    const taken = newEmail();
    await createUser({ email: taken });
    const person = await createUser();
    await link(a.tenantId, person, 'field_agent');
    expect(await pgError(changeAgentEmail(asManagerA(), person, taken))).toMatchObject({
      code: '23505',
      constraint: 'users_email_lower_idx',
    });
  });
});

describe('registro dos convites', () => {
  it('invite_record devolve os segundos que faltam dentro do intervalo', async () => {
    const person = await createUser();
    await link(a.tenantId, person, 'field_agent');
    expect(await record(asManagerA(), person, a.tenantId, 'agent', 60)).toBe(0);
    const wait = await record(asManagerA(), person, a.tenantId, 'agent', 60);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);

    const rows = await deliveries(person);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: a.tenantId, kind: 'agent', sentBy: managerA });

    // O intervalo é por tipo e prefeitura.
    expect(await record(asManagerA(), person, a.tenantId, 'panel', 60)).toBe(0);
  });

  it('libera depois do intervalo', async () => {
    const person = await createUser();
    await owner.db.insert(inviteDeliveries).values({
      userId: person,
      tenantId: a.tenantId,
      kind: 'panel',
      sentAt: new Date(Date.now() - 61_000),
    });
    expect(await record(asAdminA(), person, a.tenantId, 'panel', 60)).toBe(0);
    expect(await deliveries(person)).toHaveLength(2);
  });

  it('aceita com intervalo zero', async () => {
    const person = await createUser();
    expect(await record(asManagerA(), person, a.tenantId, 'agent', 0)).toBe(0);
    expect(await record(asManagerA(), person, a.tenantId, 'agent', 0)).toBe(0);
    expect(await deliveries(person)).toHaveLength(2);
  });

  it('equipe interna registra em qualquer prefeitura', async () => {
    const person = await createUser();
    expect(await record(asSupport(), person, b.tenantId, 'panel', 0)).toBe(0);
    const [row] = await deliveries(person);
    expect(row).toMatchObject({ tenantId: b.tenantId, sentBy: supportId });
  });

  it('recusa quem não é da prefeitura', async () => {
    const person = await createUser();
    const asAgentA: DbContext = { tenantId: a.tenantId, userId: agentA };
    const asInactive: DbContext = { tenantId: a.tenantId, userId: inactiveManagerA };
    // Gestor de B com o contexto de A também não passa: vale o vínculo, não o contexto.
    const asManagerBInA: DbContext = { tenantId: a.tenantId, userId: managerB };
    for (const context of [asManagerB(), asAgentA, asInactive, asManagerBInA, {}]) {
      expect((await pgError(record(context, person, a.tenantId, 'agent', 0))).code).toBe('42501');
    }
    expect(await deliveries(person)).toHaveLength(0);
  });

  it('convite da equipe interna só pelo admin da plataforma', async () => {
    const person = await createUser();
    for (const context of [asManagerA(), asSupport()]) {
      expect((await pgError(record(context, person, null, 'staff', 0))).code).toBe('42501');
    }
    expect(await record(asPlatformAdmin(), person, null, 'staff', 60)).toBe(0);
    expect(await record(asPlatformAdmin(), person, null, 'staff', 60)).toBeGreaterThan(0);
    const rows = await deliveries(person);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: null, kind: 'staff', sentBy: platformAdminId });
  });

  it('recusa prefeitura que não combina com o tipo', async () => {
    const person = await createUser();
    expect((await pgError(record(asPlatformAdmin(), person, a.tenantId, 'staff', 0))).code).toBe(
      '22023',
    );
    expect((await pgError(record(asPlatformAdmin(), person, null, 'agent', 0))).code).toBe('22023');
  });

  it('recusa intervalo nulo', async () => {
    const person = await createUser();
    expect((await pgError(record(asManagerA(), person, a.tenantId, 'agent', null))).code).toBe(
      '22023',
    );
    expect(await deliveries(person)).toHaveLength(0);
  });

  it('app_user não lê invite_deliveries diretamente', async () => {
    for (const context of [asManagerA(), asPlatformAdmin()]) {
      expect(
        (await pgError(withContext(app.db, context, (tx) => tx.select().from(inviteDeliveries))))
          .code,
      ).toBe('42501');
    }
  });
});

describe('agentes com convite pendente', () => {
  it('pendentes: inclui convidado com e-mail sem entrega; exclui desativado, sem e-mail e já entregue', async () => {
    const c = await createTenant('Convite C', '0000403');
    const agent = async (
      name: string,
      values: Partial<typeof users.$inferInsert>,
      status: 'active' | 'invited' | 'inactive',
      team = true,
    ) => {
      const id = await createUser({ name, ...values });
      await link(c.tenantId, id, 'field_agent', status);
      if (team)
        await owner.db
          .insert(teamMembers)
          .values({ tenantId: c.tenantId, teamId: c.teamId, userId: id });
      return id;
    };
    const invitedPhone = newPhone();
    const invited = await agent('Convidado', { email: newEmail(), phone: invitedPhone }, 'invited');
    const activeNoTeam = await agent('Ativo sem equipe', { email: newEmail() }, 'active', false);
    const panelOnly = await agent('Só convite de gestão', { email: newEmail() }, 'active');
    await agent('Sem e-mail', {}, 'invited');
    await agent('Vínculo desativado', { email: newEmail() }, 'inactive');
    await agent('Conta congelada', { email: newEmail(), accountStatus: 'frozen' }, 'active');
    const delivered = await agent('Já recebeu', { email: newEmail() }, 'active');
    await owner.db.insert(inviteDeliveries).values([
      { userId: delivered, tenantId: c.tenantId, kind: 'agent' },
      { userId: panelOnly, tenantId: c.tenantId, kind: 'panel' },
      // Convite de agente em outra prefeitura não conta para esta.
      { userId: invited, tenantId: a.tenantId, kind: 'agent' },
    ]);
    // Gestor da prefeitura não aparece.
    const manager = await createUser({ cpf: newCpf(), email: newEmail() });
    await link(c.tenantId, manager, 'manager');

    const rows = await call<{
      user_id: string;
      name: string;
      email: string;
      phone: string;
      team_name: string | null;
    }>(asPlatformAdmin(), sql`select * from invite_pending_agents(${c.tenantId}) order by name`);
    expect(rows.map((r) => r.user_id)).toEqual([activeNoTeam, invited, panelOnly]);
    expect(rows[1]).toMatchObject({
      name: 'Convidado',
      email: (await userRow(invited)).email,
      phone: invitedPhone,
      team_name: 'Equipe Convite C',
    });
    expect(rows[0]!.team_name).toBeNull();
  });

  it('pendentes só para o admin da plataforma', async () => {
    for (const context of [asSupport(a.tenantId), asAdminA()]) {
      expect(
        (await pgError(call(context, sql`select * from invite_pending_agents(${a.tenantId})`)))
          .code,
      ).toBe('42501');
    }
  });
});
