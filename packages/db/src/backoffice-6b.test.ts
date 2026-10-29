import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext, type DbContext } from './client.js';
import {
  categories,
  cityInterest,
  departments,
  memberships,
  municipalities,
  municipalityLeads,
  occurrences,
  requests,
  sessions,
  staffAuditEvents,
  statusEvents,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Backoffice 6b: interesse por cidade (P5), equipe interna (P6), auditoria (P7), conta congelada e
// as correções sem tela. Funções SECURITY DEFINER; o dono prepara os dados e as funções rodam como
// app_user, a mesma conexão da API. Os outros arquivos de teste usam o mesmo banco: as listas
// globais são filtradas pelos dados deste arquivo.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const DAY_MS = 24 * 60 * 60 * 1000;
const POINT = { lat: -12.5, lng: -42.5 };
const ago = (ms: number) => new Date(Date.now() - ms);

let phoneSeq = 0;
let cpfSeq = 0;
let ibgeSeq = 0;
function newPhone(): string {
  phoneSeq += 1;
  return `+55119660${String(phoneSeq).padStart(5, '0')}`;
}
function newCpf(): string {
  cpfSeq += 1;
  return `660${String(cpfSeq).padStart(8, '0')}`;
}
function newIbge(): string {
  ibgeSeq += 1;
  return `00066${String(ibgeSeq).padStart(2, '0')}`;
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

async function createTenant(label: string, ibgeCode = newIbge()) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'BA',
      ibgeCode,
      status: 'onboarding',
    })
    .returning();
  const tenantId = tenant!.id;
  const [department] = await owner.db
    .insert(departments)
    .values({ tenantId, name: 'Obras' })
    .returning();
  const [category] = await owner.db
    .insert(categories)
    .values({ tenantId, departmentId: department!.id, name: 'Buraco na via' })
    .returning();
  const [team] = await owner.db
    .insert(teams)
    .values({ tenantId, departmentId: department!.id, name: 'Equipe Centro' })
    .returning();
  return {
    tenantId,
    departmentId: department!.id,
    categoryId: category!.id,
    teamId: team!.id,
  };
}

type TenantSeed = Awaited<ReturnType<typeof createTenant>>;

async function link(
  tenantId: string,
  userId: string,
  role: 'citizen' | 'field_agent' | 'manager' | 'tenant_admin',
  status: 'active' | 'invited' | 'inactive' = 'active',
): Promise<void> {
  await owner.db.insert(memberships).values({ tenantId, userId, role, status });
}

async function createMunicipality(name: string, state: string): Promise<string> {
  const ibgeCode = newIbge();
  await owner.db.insert(municipalities).values({
    ibgeCode,
    name,
    state,
    boundary: sql`ST_Multi(ST_MakeEnvelope(-42.6, -12.6, -42.4, -12.4, 4326))`,
  });
  return ibgeCode;
}

async function createOccurrence(seed: TenantSeed): Promise<string> {
  const [occurrence] = await owner.db
    .insert(occurrences)
    .values({
      tenantId: seed.tenantId,
      categoryId: seed.categoryId,
      location: geoPoint(POINT),
      status: 'in_progress',
    })
    .returning();
  return occurrence!.id;
}

/** Solicitação do cidadão na ocorrência; o protocolo sai de next_request_protocol(). */
async function createRequest(
  seed: TenantSeed,
  citizenId: string,
  occurrenceId: string,
  createdAt = new Date(),
): Promise<{ id: string; protocol: string; occurrenceId: string }> {
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId: seed.tenantId,
        citizenId,
        categoryId: seed.categoryId,
        occurrenceId,
        description: 'Buraco grande na rua',
        location: geoPoint(POINT),
        gpsLocation: geoPoint(POINT),
        createdAt,
      })
      .returning();
    return { id: request!.id, protocol: request!.protocol, occurrenceId };
  });
}

function call<T extends Record<string, unknown>>(
  context: DbContext,
  query: ReturnType<typeof sql>,
) {
  return withContext(app.db, context, async (tx) => (await tx.execute<T>(query)).rows);
}

/** Roda `fn` com só estes admins na equipe: os admins dos outros arquivos viram suporte e voltam. */
async function onlyAdmins<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const others = await owner.db
    .update(users)
    .set({ platformRole: 'support' })
    .where(and(eq(users.platformRole, 'admin'), notInArray(users.id, ids)))
    .returning({ id: users.id });
  try {
    return await fn();
  } finally {
    if (others.length > 0) {
      await owner.db
        .update(users)
        .set({ platformRole: 'admin' })
        .where(
          inArray(
            users.id,
            others.map((row) => row.id),
          ),
        );
    }
  }
}

let adminId: string;
let supportId: string;
const asAdmin = (): DbContext => ({ userId: adminId, platformRole: 'admin' });
const asSupport = (): DbContext => ({ userId: supportId, platformRole: 'support' });

beforeAll(async () => {
  adminId = await createUser({ name: 'Admin 6b', cpf: newCpf(), platformRole: 'admin' });
  supportId = await createUser({ name: 'Suporte 6b', cpf: newCpf(), platformRole: 'support' });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

// ── P5: interesse por cidade ──

type InterestRow = {
  ibge_code: string;
  name: string;
  state: string;
  request_count: number;
  last_30_days: number;
  first_at: Date;
  commercial_status: string;
  is_customer: boolean;
};

describe('interesse por cidade', () => {
  it('interesse conta pessoas distintas, os últimos 30 dias e marca município cliente', async () => {
    const big = await createMunicipality('Abaíra', 'BA');
    const small = await createMunicipality('Zabelê', 'PB');
    const tie = await createMunicipality('Andaraí', 'BA');
    const customer = await createMunicipality('Cliente', 'BA');
    await createTenant('Cliente', customer);

    const people = await Promise.all([1, 2, 3].map(() => createUser({ name: 'Cidadão' })));
    const firstAt = ago(60 * DAY_MS);
    await owner.db.insert(cityInterest).values([
      { ibgeCode: big, userId: people[0]!, createdAt: firstAt },
      { ibgeCode: big, userId: people[1]!, createdAt: ago(40 * DAY_MS) },
      { ibgeCode: big, userId: people[2]!, createdAt: ago(2 * DAY_MS) },
      { ibgeCode: small, userId: people[0]!, createdAt: ago(1 * DAY_MS) },
      { ibgeCode: tie, userId: people[1]!, createdAt: ago(50 * DAY_MS) },
      { ibgeCode: customer, userId: people[2]!, createdAt: ago(3 * DAY_MS) },
    ]);
    // O trigger grava quem mudou a partir do contexto.
    await withContext(owner.db, { userId: adminId }, (tx) =>
      tx
        .insert(municipalityLeads)
        .values({ ibgeCode: tie, commercialStatus: 'contacted', updatedBy: adminId }),
    );

    // Só a equipe interna lê.
    for (const context of [{ userId: people[0]! }, { userId: supportId }, {}] as DbContext[]) {
      const error = await pgError(call(context, sql`select * from platform_city_interest()`));
      expect(error.code).toBe('42501');
    }

    for (const context of [asSupport(), asAdmin()]) {
      const rows = (
        await call<InterestRow>(context, sql`select * from platform_city_interest()`)
      ).filter((row) => [big, small, tie, customer].includes(row.ibge_code));
      // Pedidos do maior para o menor; empate pelo nome.
      expect(rows.map((row) => row.ibge_code)).toEqual([big, tie, customer, small]);
      expect(rows[0]).toMatchObject({
        ibge_code: big,
        name: 'Abaíra',
        state: 'BA',
        request_count: 3,
        last_30_days: 1,
        commercial_status: 'new',
        is_customer: false,
      });
      expect(new Date(rows[0]!.first_at).getTime()).toBe(firstAt.getTime());
      expect(rows[1]).toMatchObject({ request_count: 1, commercial_status: 'contacted' });
      expect(rows[2]).toMatchObject({ ibge_code: customer, is_customer: true, last_30_days: 1 });
    }
  });

  it('mudar situação comercial grava quem mudou e uma linha de auditoria sem prefeitura', async () => {
    const ibgeCode = await createMunicipality('Lençóis', 'BA');

    const refused = await pgError(
      call({ userId: adminId }, sql`select platform_set_lead_status(${ibgeCode}, 'won')`),
    );
    expect(refused.code).toBe('42501');

    await call(asSupport(), sql`select platform_set_lead_status(${ibgeCode}, 'proposal_sent')`);
    const [created] = await owner.db
      .select()
      .from(municipalityLeads)
      .where(eq(municipalityLeads.ibgeCode, ibgeCode));
    expect(created).toMatchObject({ commercialStatus: 'proposal_sent', updatedBy: supportId });

    await call(asAdmin(), sql`select platform_set_lead_status(${ibgeCode}, 'negotiating')`);
    const [updated] = await owner.db
      .select()
      .from(municipalityLeads)
      .where(eq(municipalityLeads.ibgeCode, ibgeCode));
    expect(updated).toMatchObject({ commercialStatus: 'negotiating', updatedBy: adminId });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created!.updatedAt.getTime());

    // O trigger força quem mudou, mesmo em UPDATE direto pela política da equipe.
    await call(
      asSupport(),
      sql`update municipality_leads set commercial_status = 'won', updated_by = ${adminId}
          where ibge_code = ${ibgeCode}`,
    );
    const [direct] = await owner.db
      .select()
      .from(municipalityLeads)
      .where(eq(municipalityLeads.ibgeCode, ibgeCode));
    expect(direct!.updatedBy).toBe(supportId);

    const events = await owner.db
      .select()
      .from(staffAuditEvents)
      .where(
        and(
          eq(staffAuditEvents.action, 'lead.update'),
          sql`${staffAuditEvents.details} ->> 'ibgeCode' = ${ibgeCode}`,
        ),
      )
      .orderBy(staffAuditEvents.createdAt);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      tenantId: null,
      staffUserId: supportId,
      targetType: 'municipality',
      targetId: null,
      details: { ibgeCode },
    });
    expect(events[1]!.staffUserId).toBe(adminId);
  });
});

// ── P6: equipe interna ──

type StaffRow = {
  user_id: string;
  name: string;
  cpf: string;
  email: string;
  platform_role: string;
  last_active_at: Date | null;
};

function staffAdd(context: DbContext, name: string, cpf: string, email: string, role: string) {
  return call<{ id: string }>(
    context,
    sql`select platform_staff_add(${name}, ${cpf}, ${email}, ${role}::platform_role) as id`,
  ).then((rows) => rows[0]!.id);
}

function staffSetRole(context: DbContext, userId: string, role: string) {
  return call(context, sql`select platform_staff_set_role(${userId}, ${role}::platform_role)`);
}

function staffRemove(context: DbContext, userId: string) {
  return call(context, sql`select platform_staff_remove(${userId})`);
}

async function auditOf(action: string, targetId: string) {
  return owner.db
    .select()
    .from(staffAuditEvents)
    .where(and(eq(staffAuditEvents.action, action), eq(staffAuditEvents.targetId, targetId)));
}

describe('equipe interna', () => {
  it('equipe lista CPF, e-mail e último acesso só para o admin', async () => {
    const cpf = newCpf();
    const lastActiveAt = ago(DAY_MS);
    const member = await createUser({
      name: 'Equipe Listada',
      cpf,
      email: 'listada@equipe6b.dev',
      platformRole: 'support',
      lastActiveAt,
    });
    // Ex-equipe e conta excluída não aparecem.
    const gone = await createUser({ name: 'Ex-equipe', cpf: newCpf() });

    for (const context of [asSupport(), { userId: adminId }, {}] as DbContext[]) {
      const error = await pgError(call(context, sql`select * from platform_staff_list()`));
      expect(error.code).toBe('42501');
    }

    const rows = await call<StaffRow>(asAdmin(), sql`select * from platform_staff_list()`);
    const row = rows.find((item) => item.user_id === member);
    expect(row).toMatchObject({
      name: 'Equipe Listada',
      cpf,
      email: 'listada@equipe6b.dev',
      platform_role: 'support',
    });
    expect(new Date(row!.last_active_at!).getTime()).toBe(lastActiveAt.getTime());
    expect(rows.some((item) => item.user_id === gone)).toBe(false);
    expect(rows.every((item) => item.platform_role !== null)).toBe(true);
  });

  it('adicionar à equipe cria ou usa a conta pelo CPF e grava a auditoria', async () => {
    // Só o admin.
    const refused = await pgError(
      staffAdd(asSupport(), 'X', newCpf(), 'x@equipe6b.dev', 'support'),
    );
    expect(refused.code).toBe('42501');

    const cpf = newCpf();
    const created = await staffAdd(asAdmin(), 'Nova Pessoa', cpf, 'nova@equipe6b.dev', 'support');
    expect(await userRow(created)).toMatchObject({
      name: 'Nova Pessoa',
      cpf,
      email: 'nova@equipe6b.dev',
      platformRole: 'support',
    });
    expect(await auditOf('staff.create', created)).toMatchObject([
      { tenantId: null, staffUserId: adminId, targetType: 'staff', details: null },
    ]);

    // Já é da equipe.
    expect(
      await pgError(staffAdd(asAdmin(), 'Nova Pessoa', cpf, 'nova@equipe6b.dev', 'admin')),
    ).toMatchObject({ code: '23514', message: 'already_staff' });

    // Conta existente (cidadã) com outro e-mail: recusa sem mudar nada.
    const citizenCpf = newCpf();
    const citizen = await createUser({ name: 'Cidadã', cpf: citizenCpf, email: 'c@equipe6b.dev' });
    expect(
      await pgError(staffAdd(asAdmin(), 'Outro', citizenCpf, 'outro@equipe6b.dev', 'support')),
    ).toMatchObject({ code: '23514', message: 'email_mismatch' });
    expect((await userRow(citizen)).platformRole).toBeNull();
    // Mesmo e-mail, sem diferenciar maiúsculas: ganha o papel e mantém o nome.
    expect(await staffAdd(asAdmin(), 'Outro', citizenCpf, 'C@equipe6b.dev', 'admin')).toBe(citizen);
    expect(await userRow(citizen)).toMatchObject({ name: 'Cidadã', platformRole: 'admin' });

    // Conta sem e-mail recebe o digitado.
    const noEmailCpf = newCpf();
    const noEmail = await createUser({ name: 'Sem e-mail', cpf: noEmailCpf });
    expect(await staffAdd(asAdmin(), 'X', noEmailCpf, 'sem@equipe6b.dev', 'support')).toBe(noEmail);
    expect(await userRow(noEmail)).toMatchObject({ email: 'sem@equipe6b.dev' });

    // CPF de conta congelada cai no CPF único (a API responde cpf_unavailable).
    const frozenCpf = newCpf();
    await createUser({ name: 'Congelada', cpf: frozenCpf, accountStatus: 'frozen' });
    expect(
      await pgError(staffAdd(asAdmin(), 'X', frozenCpf, 'gelo@equipe6b.dev', 'support')),
    ).toMatchObject({ code: '23505', constraint: 'users_cpf_unique' });
  });

  it('adicionar à equipe recusa gestor ou agente ativo', async () => {
    const seed = await createTenant('Equipe vínculo');
    for (const role of ['manager', 'tenant_admin', 'field_agent'] as const) {
      for (const status of ['active', 'invited'] as const) {
        const cpf = newCpf();
        const email = `${role}.${status}@equipe6b.dev`;
        const id = await createUser({ name: 'Da prefeitura', cpf, email });
        await link(seed.tenantId, id, role, status);
        expect(await pgError(staffAdd(asAdmin(), 'X', cpf, email, 'support'))).toMatchObject({
          code: '23514',
          message: 'tenant_member_not_allowed',
        });
        expect((await userRow(id)).platformRole).toBeNull();
      }
    }
    // Cidadão no app não conflita.
    const cpf = newCpf();
    const citizen = await createUser({ name: 'Cidadão', cpf, email: 'cid@equipe6b.dev' });
    await link(seed.tenantId, citizen, 'citizen');
    expect(await staffAdd(asAdmin(), 'X', cpf, 'cid@equipe6b.dev', 'support')).toBe(citizen);
  });

  it('vínculo inativo não impede entrar na equipe', async () => {
    const seed = await createTenant('Equipe inativo');
    const cpf = newCpf();
    const id = await createUser({ name: 'Ex-gestor', cpf, email: 'exgestor@equipe6b.dev' });
    await link(seed.tenantId, id, 'manager', 'inactive');
    await link(seed.tenantId, id, 'field_agent', 'inactive');
    expect(await staffAdd(asAdmin(), 'X', cpf, 'exgestor@equipe6b.dev', 'support')).toBe(id);
    expect((await userRow(id)).platformRole).toBe('support');
  });

  it('ex-equipe pode virar gestor', async () => {
    const seed = await createTenant('Ex-equipe');
    const cpf = newCpf();
    const id = await staffAdd(asAdmin(), 'Ex-equipe', cpf, 'exequipe@equipe6b.dev', 'support');
    await staffRemove(asAdmin(), id);
    expect((await userRow(id)).platformRole).toBeNull();
    expect(await auditOf('staff.remove', id)).toHaveLength(1);

    const manager = await call<{ id: string; email: string }>(
      { tenantId: seed.tenantId, userId: adminId, platformRole: 'admin' },
      sql`select id, email from panel_find_or_create_manager_user('Ex-equipe', ${cpf}, 'exequipe@equipe6b.dev')`,
    );
    expect(manager[0]).toEqual({ id, email: 'exequipe@equipe6b.dev' });
  });

  it('gestor e agente não podem ser da equipe interna', async () => {
    const seed = await createTenant('Sem equipe');
    const inSupport: DbContext = {
      tenantId: seed.tenantId,
      userId: adminId,
      platformRole: 'admin',
    };
    const phone = newPhone();
    const cpf = newCpf();
    await createUser({
      name: 'Suporte',
      phone,
      cpf,
      email: 'sup@equipe6b.dev',
      platformRole: 'support',
    });

    expect(
      await pgError(call(inSupport, sql`select panel_find_or_create_agent_user('X', ${phone})`)),
    ).toMatchObject({ code: '23514', message: 'staff_account_not_allowed' });
    expect(
      await pgError(
        call(
          inSupport,
          sql`select * from panel_find_or_create_manager_user('X', ${cpf}, 'sup@equipe6b.dev')`,
        ),
      ),
    ).toMatchObject({ code: '23514', message: 'staff_account_not_allowed' });
  });

  it('editar e trocar o papel gravam a auditoria', async () => {
    const id = await staffAdd(asAdmin(), 'Editável', newCpf(), 'edit@equipe6b.dev', 'support');

    expect(
      (
        await pgError(
          call(asSupport(), sql`select platform_staff_update(${id}, 'Y', 'y@equipe6b.dev')`),
        )
      ).code,
    ).toBe('42501');
    await call(
      asAdmin(),
      sql`select platform_staff_update(${id}, 'Editada', 'editada@equipe6b.dev')`,
    );
    expect(await userRow(id)).toMatchObject({ name: 'Editada', email: 'editada@equipe6b.dev' });
    expect(await auditOf('staff.update', id)).toMatchObject([{ tenantId: null, details: null }]);

    expect((await pgError(staffSetRole(asSupport(), id, 'admin'))).code).toBe('42501');
    await staffSetRole(asAdmin(), id, 'admin');
    expect((await userRow(id)).platformRole).toBe('admin');
    expect(await auditOf('staff.role_change', id)).toHaveLength(1);

    // Quem não é da equipe não é alvo.
    const outsider = await createUser({ name: 'De fora', cpf: newCpf() });
    for (const query of [
      sql`select platform_staff_update(${outsider}, 'Z', 'z@equipe6b.dev')`,
      sql`select platform_staff_set_role(${outsider}, 'admin')`,
      sql`select platform_staff_remove(${outsider})`,
    ]) {
      expect((await pgError(call(asAdmin(), query))).code).toBe('P0002');
    }
    expect((await userRow(outsider)).platformRole).toBeNull();
  });

  it('ninguém troca o próprio papel nem se remove', async () => {
    const notAllowed = { code: '23514', message: 'self_change_not_allowed' };
    expect(await pgError(staffSetRole(asAdmin(), adminId, 'support'))).toMatchObject(notAllowed);
    expect(await pgError(staffRemove(asAdmin(), adminId))).toMatchObject(notAllowed);
    expect((await userRow(adminId)).platformRole).toBe('admin');
  });

  it('duas remoções simultâneas não deixam a equipe sem admin', async () => {
    const first = await createUser({ name: 'Admin um', cpf: newCpf(), platformRole: 'admin' });
    const second = await createUser({ name: 'Admin dois', cpf: newCpf(), platformRole: 'admin' });
    await onlyAdmins([first, second], async () => {
      const results = await Promise.allSettled([
        staffRemove({ userId: first, platformRole: 'admin' }, second),
        staffRemove({ userId: second, platformRole: 'admin' }, first),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      const cause = (rejected as PromiseRejectedResult).reason.cause as PgError;
      expect(cause).toMatchObject({ code: '23514', message: 'last_platform_admin' });

      const admins = await owner.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.platformRole, 'admin'), inArray(users.id, [first, second])));
      expect(admins).toHaveLength(1);

      // Trocar o papel do último admin também é recusado.
      const remaining = admins[0]!.id;
      const caller = remaining === first ? second : first;
      await owner.db.update(users).set({ platformRole: 'support' }).where(eq(users.id, caller));
      expect(
        await pgError(
          staffSetRole({ userId: caller, platformRole: 'admin' }, remaining, 'support'),
        ),
      ).toMatchObject({ code: '23514', message: 'last_platform_admin' });
    });
  });
});

// ── Exclusão da conta ──

function deleteAccount(userId: string) {
  return call({ userId }, sql`select account_delete()`);
}

describe('exclusão da conta', () => {
  it('excluir conta apaga interesse, papel interno e installation_id', async () => {
    const id = await createUser({ name: 'Vai sair', cpf: newCpf(), platformRole: 'support' });
    const ibgeCode = await createMunicipality('Mucugê', 'BA');
    await owner.db.insert(cityInterest).values({ ibgeCode, userId: id });
    const installationId = randomUUID();
    await owner.db.insert(sessions).values([
      { userId: id, audience: 'app', refreshTokenHash: randomUUID(), installationId },
      {
        userId: id,
        audience: 'app',
        refreshTokenHash: randomUUID(),
        installationId: randomUUID(),
        revokedAt: ago(DAY_MS),
      },
    ]);

    await deleteAccount(id);

    expect(await userRow(id)).toMatchObject({ platformRole: null, cpf: null });
    expect(await owner.db.select().from(cityInterest).where(eq(cityInterest.userId, id))).toEqual(
      [],
    );
    const rows = await owner.db.select().from(sessions).where(eq(sessions.userId, id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.installationId).toBeNull();
      expect(row.revokedAt).not.toBeNull();
    }
  });

  it('último admin não exclui a conta', async () => {
    const last = await createUser({ name: 'Último admin', cpf: newCpf(), platformRole: 'admin' });
    await onlyAdmins([last], async () => {
      expect(await pgError(deleteAccount(last))).toMatchObject({
        code: '23514',
        message: 'last_platform_admin',
      });
      expect(await userRow(last)).toMatchObject({ platformRole: 'admin', deletedAt: null });
    });
    // Com outro admin, exclui.
    await deleteAccount(last);
    expect(await userRow(last)).toMatchObject({ platformRole: null });
  });
});

// ── P7: auditoria ──

type AuditRow = {
  id: string;
  created_at: Date;
  staff_name: string;
  tenant_id: string | null;
  tenant_name: string | null;
  action: string;
  target_type: string | null;
  target_label: string;
  total: string;
};

function auditEvents(
  context: DbContext,
  filters: {
    tenantId?: string | null;
    staffUserId?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
    offset?: number;
  },
) {
  return call<AuditRow>(
    context,
    sql`select * from platform_audit_events(
      ${filters.tenantId ?? null}::uuid,
      ${filters.staffUserId ?? null}::uuid,
      ${filters.from ?? null}::date,
      ${filters.to ?? null}::date,
      ${filters.limit ?? 50},
      ${filters.offset ?? 0}
    )`,
  );
}

describe('auditoria', () => {
  it('auditoria filtra por prefeitura, pessoa e período e resolve o rótulo do alvo', async () => {
    const seed = await createTenant('Auditada');
    const other = await createTenant('Outra auditada');
    const staff = await createUser({ name: 'Auditora', cpf: newCpf(), platformRole: 'support' });
    const otherStaff = await createUser({ name: 'Outra', cpf: newCpf(), platformRole: 'support' });

    const citizen = await createUser({ name: 'Cidadão' });
    const occurrenceId = await createOccurrence(seed);
    const oldest = await createRequest(seed, citizen, occurrenceId, ago(5 * DAY_MS));
    await createRequest(seed, citizen, occurrenceId, ago(DAY_MS));
    const [order] = await owner.db
      .insert(workOrders)
      .values({ tenantId: seed.tenantId, occurrenceId, teamId: seed.teamId })
      .returning();
    const agent = await createUser({ name: 'Agente Rotulado' });
    const deleted = await createUser({ name: 'Nome antigo', deletedAt: new Date(), phone: null });
    const ibgeCode = await createMunicipality('Palmeiras', 'BA');

    // Um evento por hora, do mais antigo ao mais recente, em 10/03/2026 (Brasília).
    const base = Date.UTC(2026, 2, 10, 3); // 10/03 00:00 em Brasília
    const events: (typeof staffAuditEvents.$inferInsert)[] = [
      { tenantId: seed.tenantId, action: 'team.update', targetType: 'team', targetId: seed.teamId },
      {
        tenantId: seed.tenantId,
        action: 'category.update',
        targetType: 'category',
        targetId: seed.categoryId,
      },
      {
        tenantId: seed.tenantId,
        action: 'department.update',
        targetType: 'department',
        targetId: seed.departmentId,
      },
      {
        tenantId: seed.tenantId,
        action: 'occurrence.assign',
        targetType: 'occurrence',
        targetId: occurrenceId,
      },
      {
        tenantId: seed.tenantId,
        action: 'work_order.publish',
        targetType: 'work_order',
        targetId: order!.id,
      },
      { tenantId: seed.tenantId, action: 'agent.update', targetType: 'agent', targetId: agent },
      {
        tenantId: seed.tenantId,
        action: 'manager.update',
        targetType: 'manager',
        targetId: deleted,
      },
      {
        tenantId: seed.tenantId,
        action: 'tenant.activate',
        targetType: 'tenant',
        targetId: seed.tenantId,
      },
      { tenantId: seed.tenantId, action: 'support.enter' },
      {
        tenantId: null,
        action: 'lead.update',
        targetType: 'municipality',
        details: { ibgeCode },
      },
    ].map((event, index) => ({
      ...event,
      staffUserId: staff,
      createdAt: new Date(base + index * 60 * 60 * 1000),
    }));
    await owner.db.insert(staffAuditEvents).values(events);
    // Fora do período (09/03 23:59 e 11/03 00:00 em Brasília), de outra pessoa e de outra prefeitura.
    await owner.db.insert(staffAuditEvents).values([
      {
        tenantId: seed.tenantId,
        staffUserId: staff,
        action: 'support.leave',
        createdAt: new Date(base - 60_000),
      },
      {
        tenantId: seed.tenantId,
        staffUserId: staff,
        action: 'support.leave',
        createdAt: new Date(base + DAY_MS),
      },
      {
        tenantId: seed.tenantId,
        staffUserId: otherStaff,
        action: 'support.enter',
        createdAt: new Date(base),
      },
      {
        tenantId: other.tenantId,
        staffUserId: staff,
        action: 'support.enter',
        createdAt: new Date(base),
      },
    ]);

    // Só o admin.
    for (const context of [asSupport(), { userId: adminId }, {}] as DbContext[]) {
      expect((await pgError(auditEvents(context, { staffUserId: staff }))).code).toBe('42501');
    }

    const period = { staffUserId: staff, from: '2026-03-10', to: '2026-03-10' };
    const rows = await auditEvents(asAdmin(), period);
    expect(rows).toHaveLength(11);
    // Mais recente primeiro.
    expect(rows.map((row) => row.action).slice(0, 2)).toEqual(['lead.update', 'support.enter']);
    expect(Number(rows[0]!.total)).toBe(11);
    const labels = Object.fromEntries(
      rows
        .filter((row) => row.tenant_id !== other.tenantId)
        .map((row) => [row.action, row.target_label]),
    );
    expect(labels).toEqual({
      'team.update': 'Equipe Centro',
      'category.update': 'Buraco na via',
      'department.update': 'Obras',
      'occurrence.assign': oldest.protocol,
      'work_order.publish': oldest.protocol,
      'agent.update': 'Agente Rotulado',
      'manager.update': 'Conta excluída',
      'tenant.activate': 'Prefeitura Auditada',
      'support.enter': '—',
      'lead.update': 'Palmeiras — BA',
    });
    expect(rows[0]).toMatchObject({ staff_name: 'Auditora', tenant_id: null, tenant_name: null });
    expect(rows[1]).toMatchObject({ tenant_name: 'Prefeitura Auditada' });

    // Filtro por prefeitura: some a de outra prefeitura e a sem prefeitura.
    const byTenant = await auditEvents(asAdmin(), { ...period, tenantId: seed.tenantId });
    expect(byTenant).toHaveLength(9);
    expect(byTenant.every((row) => row.tenant_id === seed.tenantId)).toBe(true);

    // Sem período: entram as duas de fora; paginação mantém o total.
    const page = await auditEvents(asAdmin(), { staffUserId: staff, limit: 5, offset: 10 });
    expect(page).toHaveLength(3);
    expect(Number(page[0]!.total)).toBe(13);

    // A política de leitura da prefeitura ignora as linhas sem prefeitura.
    const visible = await withContext(
      app.db,
      { tenantId: seed.tenantId, userId: staff, platformRole: 'support' },
      (tx) => tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.staffUserId, staff)),
    );
    expect(visible.some((row) => row.tenantId === null)).toBe(false);
  });

  it('a equipe grava auditoria sem prefeitura só em nome próprio', async () => {
    const insert = (context: DbContext, staffUserId: string) =>
      withContext(app.db, context, (tx) =>
        tx
          .insert(staffAuditEvents)
          .values({ tenantId: null, staffUserId, action: 'tenant.create' }),
      );
    await insert(asSupport(), supportId);
    expect((await pgError(insert(asSupport(), adminId))).code).toBe('42501');
    expect((await pgError(insert({ userId: supportId }, supportId))).code).toBe('42501');
  });
});

// ── Conta congelada ──

describe('conta congelada', () => {
  it('recover reativa a conta congelada com o e-mail novo e revoga sessões', async () => {
    const seed = await createTenant('Recuperação');
    const cpf = newCpf();
    const phone = newPhone();
    const frozen = await createUser({
      name: 'Congelada',
      cpf,
      phone,
      email: 'antigo@gelo6b.dev',
      accountStatus: 'frozen',
    });
    // O número já é de outra conta ativa (foi por isso que congelou).
    await createUser({ name: 'Dona do número', phone });
    await owner.db.insert(sessions).values({
      userId: frozen,
      audience: 'app',
      refreshTokenHash: randomUUID(),
      installationId: randomUUID(),
    });

    expect(
      (
        await pgError(
          call({ userId: adminId }, sql`select * from platform_frozen_account_by_cpf(${cpf})`),
        )
      ).code,
    ).toBe('42501');
    expect(
      await call(asSupport(), sql`select * from platform_frozen_account_by_cpf(${cpf})`),
    ).toEqual([{ user_id: frozen, email: 'antigo@gelo6b.dev' }]);
    // Conta ativa não é achada.
    const activeCpf = newCpf();
    await createUser({ name: 'Ativa', cpf: activeCpf });
    expect(
      await call(asSupport(), sql`select * from platform_frozen_account_by_cpf(${activeCpf})`),
    ).toEqual([]);

    const inSupport: DbContext = { ...asSupport(), tenantId: seed.tenantId };
    await call(
      inSupport,
      sql`select platform_recover_frozen_account(${frozen}, 'novo@gelo6b.dev', ${seed.tenantId})`,
    );
    const row = await userRow(frozen);
    expect(row).toMatchObject({ accountStatus: 'active', email: 'novo@gelo6b.dev', cpf });
    expect(row.lastActiveAt).not.toBeNull();
    expect(row.phone).toBeNull();
    const active = await owner.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, frozen), isNull(sessions.revokedAt)));
    expect(active).toEqual([]);
    expect(await auditOf('account.recover', frozen)).toMatchObject([
      { tenantId: seed.tenantId, staffUserId: supportId, targetType: 'user', details: null },
    ]);

    // Já não está congelada.
    expect(
      (
        await pgError(
          call(
            asSupport(),
            sql`select platform_recover_frozen_account(${frozen}, 'x@gelo6b.dev', null)`,
          ),
        )
      ).code,
    ).toBe('P0002');
  });

  it('liberar CPF mantém a conta congelada e sem CPF', async () => {
    const cpf = newCpf();
    const frozen = await createUser({
      name: 'Congelada',
      cpf,
      email: 'liberar@gelo6b.dev',
      accountStatus: 'frozen',
    });

    expect(
      (
        await pgError(
          call({ userId: adminId }, sql`select platform_release_frozen_cpf(${cpf}, null)`),
        )
      ).code,
    ).toBe('42501');
    await call(asAdmin(), sql`select platform_release_frozen_cpf(${cpf}, null)`);
    expect(await userRow(frozen)).toMatchObject({
      accountStatus: 'frozen',
      cpf: null,
      email: 'liberar@gelo6b.dev',
    });
    expect(await auditOf('account.release_cpf', frozen)).toMatchObject([
      { tenantId: null, staffUserId: adminId, targetType: 'user', details: null },
    ]);

    // O CPF agora está livre para uma conta nova.
    const fresh = await staffAdd(asAdmin(), 'Nova', cpf, 'nova@gelo6b.dev', 'support');
    expect(fresh).not.toBe(frozen);

    // Sem conta congelada com o CPF.
    expect(
      (await pgError(call(asAdmin(), sql`select platform_release_frozen_cpf(${newCpf()}, null)`)))
        .code,
    ).toBe('P0002');
  });
});

// ── Correções do suporte no painel ──

describe('trocas no modo suporte', () => {
  let a: TenantSeed;
  let b: TenantSeed;
  let managerAdmin: string;
  let sharedManager: string;
  let sharedAgent: string;

  beforeAll(async () => {
    a = await createTenant('Suporte A');
    b = await createTenant('Suporte B');
    // Gestor também admin aqui e gestor na outra prefeitura.
    managerAdmin = await createUser({ name: 'Gestor', cpf: newCpf(), email: 'g@suporte6b.dev' });
    await link(a.tenantId, managerAdmin, 'manager');
    await link(a.tenantId, managerAdmin, 'tenant_admin');
    sharedManager = await createUser({
      name: 'Gestor 2',
      cpf: newCpf(),
      email: 'g2@suporte6b.dev',
    });
    await link(a.tenantId, sharedManager, 'manager');
    await link(b.tenantId, sharedManager, 'manager');
    // Agente convidado nas duas prefeituras.
    sharedAgent = await createUser({ name: 'Agente' });
    await link(a.tenantId, sharedAgent, 'field_agent', 'invited');
    await link(b.tenantId, sharedAgent, 'field_agent', 'invited');
  });

  it('suporte troca e-mail de gestor com outro painel e celular de agente em duas prefeituras', async () => {
    const inSupport: DbContext = { ...asSupport(), tenantId: a.tenantId };
    await call(
      inSupport,
      sql`select panel_change_manager_email(${managerAdmin}, 'g.novo@suporte6b.dev')`,
    );
    await call(
      inSupport,
      sql`select panel_change_manager_email(${sharedManager}, 'g2.novo@suporte6b.dev')`,
    );
    expect((await userRow(managerAdmin)).email).toBe('g.novo@suporte6b.dev');
    expect((await userRow(sharedManager)).email).toBe('g2.novo@suporte6b.dev');

    const phone = newPhone();
    await call(inSupport, sql`select panel_change_agent_phone(${sharedAgent}, ${phone})`);
    expect((await userRow(sharedAgent)).phone).toBe(phone);

    // Quem já entrou no app continua trocando no Perfil.
    const used = await createUser({ name: 'Agente ativo', lastActiveAt: new Date() });
    await link(a.tenantId, used, 'field_agent');
    expect(
      await pgError(call(inSupport, sql`select panel_change_agent_phone(${used}, ${newPhone()})`)),
    ).toMatchObject({ code: '23514', message: 'phone_change_not_allowed' });
  });

  it('gestor continua recusado nessas trocas', async () => {
    const tenantAdmin = await createUser({ name: 'Admin A', cpf: newCpf() });
    await link(a.tenantId, tenantAdmin, 'tenant_admin');
    const asTenantAdmin: DbContext = { tenantId: a.tenantId, userId: tenantAdmin };

    expect(
      await pgError(
        call(
          asTenantAdmin,
          sql`select panel_change_manager_email(${sharedManager}, 'x@suporte6b.dev')`,
        ),
      ),
    ).toMatchObject({ code: '23514', message: 'email_change_not_allowed' });
    expect(
      await pgError(
        call(
          asTenantAdmin,
          sql`select panel_change_manager_email(${managerAdmin}, 'y@suporte6b.dev')`,
        ),
      ),
    ).toMatchObject({ code: '23514', message: 'email_change_not_allowed' });
    expect(
      await pgError(
        call(asTenantAdmin, sql`select panel_change_agent_phone(${sharedAgent}, ${newPhone()})`),
      ),
    ).toMatchObject({ code: '23514', message: 'phone_change_not_allowed' });
  });
});

// ── Tempo médio ──

describe('tempo médio', () => {
  it('tempo médio conta a solicitação republicada uma vez só', async () => {
    const seed = await createTenant('Tempo médio');
    const citizen = await createUser({ name: 'Cidadão' });
    const occurrenceId = await createOccurrence(seed);
    const request = await createRequest(seed, citizen, occurrenceId, ago(10 * DAY_MS));
    // Publicada há 6 dias (4 dias) e de novo há 2 dias (8 dias): vale só a mais recente.
    for (const days of [6, 2]) {
      await owner.db.insert(statusEvents).values({
        tenantId: seed.tenantId,
        occurrenceId,
        requestId: request.id,
        fromStatus: 'in_progress',
        toStatus: 'awaiting_confirmation',
        createdAt: ago(days * DAY_MS),
      });
    }
    const rows = await call<{ avg_resolution_days: string }>(
      asSupport(),
      sql`select avg_resolution_days from platform_tenant_detail(${seed.tenantId})`,
    );
    expect(rows[0]!.avg_resolution_days).toBe('8.0');
  });
});
