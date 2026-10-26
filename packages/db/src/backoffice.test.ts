import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext, type DbContext } from './client.js';
import {
  categories,
  departments,
  memberships,
  occurrences,
  requests,
  statusEvents,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Agregados do backoffice (P1 e P3) e a conta do admin da prefeitura nova (P2): funções
// SECURITY DEFINER, as únicas leituras entre prefeituras. O dono prepara os dados; as funções
// rodam como app_user, a mesma conexão da API. Os outros arquivos de teste usam o mesmo banco,
// então a visão geral (que soma todas as prefeituras) é conferida pela diferença antes e depois.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POINT = { lat: -12.5, lng: -42.5 };

let ibgeSeq = 0;
let phoneSeq = 0;
let cpfSeq = 0;
function newPhone(): string {
  phoneSeq += 1;
  return `+55119880${String(phoneSeq).padStart(5, '0')}`;
}
function newCpf(): string {
  cpfSeq += 1;
  return `880${String(cpfSeq).padStart(8, '0')}`;
}

const ago = (ms: number) => new Date(Date.now() - ms);

interface TenantSeed {
  tenantId: string;
  departmentId: string;
  categoryId: string;
  teamId: string;
}

async function createTenant(
  label: string,
  status: 'onboarding' | 'active' | 'suspended',
): Promise<TenantSeed> {
  ibgeSeq += 1;
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'BA',
      ibgeCode: `0000${700 + ibgeSeq}`,
      status,
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

async function createUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Pessoa', phone: newPhone(), ...values })
    .returning();
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

async function createOccurrence(
  seed: TenantSeed,
  status: 'triage' | 'in_progress' | 'completed' | 'rejected',
  createdAt = new Date(),
): Promise<string> {
  const [occurrence] = await owner.db
    .insert(occurrences)
    .values({
      tenantId: seed.tenantId,
      categoryId: seed.categoryId,
      location: geoPoint(POINT),
      status,
      createdAt,
    })
    .returning();
  return occurrence!.id;
}

/** Solicitação do cidadão; cria uma ocorrência em atendimento se não vier nenhuma. */
async function createRequest(
  seed: TenantSeed,
  citizenId: string,
  createdAt = new Date(),
  occurrenceId?: string,
): Promise<{ id: string; occurrenceId: string }> {
  const target = occurrenceId ?? (await createOccurrence(seed, 'in_progress', createdAt));
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId: seed.tenantId,
        citizenId,
        categoryId: seed.categoryId,
        occurrenceId: target,
        description: 'Buraco grande na rua',
        location: geoPoint(POINT),
        gpsLocation: geoPoint(POINT),
        createdAt,
      })
      .returning();
    return { id: request!.id, occurrenceId: target };
  });
}

/** Evento da solicitação para `awaiting_confirmation` (a publicação do atendimento). */
async function publishEvent(
  seed: TenantSeed,
  request: { id: string; occurrenceId: string },
  createdAt: Date,
): Promise<void> {
  await owner.db.insert(statusEvents).values({
    tenantId: seed.tenantId,
    occurrenceId: request.occurrenceId,
    requestId: request.id,
    fromStatus: 'in_progress',
    toStatus: 'awaiting_confirmation',
    createdAt,
  });
}

/** Atividade numa ocorrência em atendimento nova, com `updated_at` e eventos de status. */
async function createWorkOrder(
  seed: TenantSeed,
  status: 'awaiting_review' | 'impeded',
  updatedAt: Date,
  eventsAt: Date[] = [],
): Promise<void> {
  const occurrenceId = await createOccurrence(seed, 'in_progress', ago(10 * DAY_MS));
  const [order] = await owner.db
    .insert(workOrders)
    .values({
      tenantId: seed.tenantId,
      occurrenceId,
      teamId: seed.teamId,
      status,
      createdAt: ago(10 * DAY_MS),
      updatedAt,
    })
    .returning();
  for (const createdAt of eventsAt) {
    await owner.db.insert(statusEvents).values({
      tenantId: seed.tenantId,
      occurrenceId,
      workOrderId: order!.id,
      toStatus: status,
      createdAt,
    });
  }
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

type SummaryRow = {
  tenant_id: string;
  citizen_count: number;
  open_count: number;
  avg_resolution_days: string | null;
  late_review_count: number;
  stale_impediment_count: number;
  active_category_count: number;
};

type OverviewRow = {
  active_tenants: number;
  onboarding_tenants: number;
  suspended_tenants: number;
  citizens: number;
  requests_this_month: number;
  requests_last_month: number;
  avg_resolution_days: string | null;
};

function summaries(context: DbContext) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<SummaryRow>(sql`select * from platform_tenant_summaries()`);
    return result.rows;
  });
}

async function summaryOf(tenantId: string): Promise<SummaryRow> {
  const rows = await summaries(asSupport());
  return rows.find((row) => row.tenant_id === tenantId)!;
}

function overview(context: DbContext = asSupport()) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<OverviewRow>(sql`select * from platform_overview()`);
    return result.rows[0]!;
  });
}

function detail(tenantId: string, context: DbContext = asSupport()) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<Record<string, unknown>>(
      sql`select * from platform_tenant_detail(${tenantId})`,
    );
    return result.rows;
  });
}

function findOrCreateTenantAdmin(context: DbContext, name: string, cpf: string, email: string) {
  return withContext(app.db, context, async (tx) => {
    const result = await tx.execute<{ id: string; email: string | null }>(
      sql`select id, email from platform_find_or_create_tenant_admin(${name}, ${cpf}, ${email})`,
    );
    return result.rows[0]!;
  });
}

async function userRow(id: string) {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  return row!;
}

let a: TenantSeed;
let onboarding: TenantSeed;
let supportId: string;
let platformAdminId: string;
let managerId: string;
let citizenId: string;

const asSupport = (): DbContext => ({ userId: supportId, platformRole: 'support' });
const asPlatformAdmin = (): DbContext => ({ userId: platformAdminId, platformRole: 'admin' });

beforeAll(async () => {
  a = await createTenant('Backoffice A', 'active');
  onboarding = await createTenant('Backoffice B', 'onboarding');
  supportId = await createUser({ name: 'Suporte', platformRole: 'support' });
  platformAdminId = await createUser({ name: 'Admin interno', platformRole: 'admin' });
  managerId = await createUser({ name: 'Gestora A', cpf: newCpf() });
  await link(a.tenantId, managerId, 'manager');

  // Uma categoria ativa e uma desativada.
  await owner.db
    .insert(categories)
    .values({ tenantId: a.tenantId, departmentId: a.departmentId, name: 'Antiga', active: false });

  // Dois cidadãos distintos (um com duas solicitações) e as publicações: 4 e 2 dias até a
  // publicação nos últimos 30 dias (média 3,0); a de 40 dias atrás fica de fora.
  citizenId = await createUser({ name: 'Cidadã A' });
  const otherCitizen = await createUser({ name: 'Cidadão A2' });
  const first = await createRequest(a, citizenId, ago(10 * DAY_MS));
  await publishEvent(a, first, ago(6 * DAY_MS));
  const second = await createRequest(a, citizenId, ago(3 * DAY_MS));
  await publishEvent(a, second, ago(1 * DAY_MS));
  const old = await createRequest(a, otherCitizen, ago(45 * DAY_MS));
  await publishEvent(a, old, ago(40 * DAY_MS));
  await owner.db
    .update(occurrences)
    .set({ status: 'completed' })
    .where(eq(occurrences.id, old.occurrenceId));

  // Triagem: uma parada há 4 dias e uma que voltou à triagem há 1 hora.
  await createOccurrence(a, 'triage', ago(4 * DAY_MS));
  const reopened = await createOccurrence(a, 'triage', ago(4 * DAY_MS));
  await owner.db.insert(statusEvents).values({
    tenantId: a.tenantId,
    occurrenceId: reopened,
    toStatus: 'triage',
    createdAt: ago(HOUR_MS),
  });
  await createOccurrence(a, 'rejected', ago(4 * DAY_MS));

  // Revisão: uma há 30 h; outra voltou para revisão há 2 h (o evento mais recente vale).
  await createWorkOrder(a, 'awaiting_review', ago(HOUR_MS), [ago(30 * HOUR_MS)]);
  await createWorkOrder(a, 'awaiting_review', ago(HOUR_MS), [ago(40 * HOUR_MS), ago(2 * HOUR_MS)]);
  // Impedimentos: um sem evento, parado desde o updated_at de 2 dias; outro de 1 hora.
  await createWorkOrder(a, 'impeded', ago(2 * DAY_MS));
  await createWorkOrder(a, 'impeded', ago(2 * DAY_MS), [ago(HOUR_MS)]);

  // Pessoas do painel. u1: agente ativo e gestor; u2: agente convidado; u3: agente desativado;
  // u4: gestor e admin; u5: gestor convidado (não conta); u6: admin.
  const [u1, u2, u3, u4, u5, u6] = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((n) => createUser({ name: `Painel ${n}` })),
  );
  await link(a.tenantId, u1!, 'field_agent');
  await link(a.tenantId, u1!, 'manager');
  await link(a.tenantId, u2!, 'field_agent', 'invited');
  await link(a.tenantId, u3!, 'field_agent', 'inactive');
  await link(a.tenantId, u4!, 'manager');
  await link(a.tenantId, u4!, 'tenant_admin');
  await link(a.tenantId, u5!, 'manager', 'invited');
  await link(a.tenantId, u6!, 'tenant_admin');
  // A cidadã também tem vínculo de cidadão: não é usuária do painel.
  await link(a.tenantId, citizenId, 'citizen');
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('agregados das prefeituras', () => {
  it('só a equipe interna lê os agregados das prefeituras', async () => {
    const refused: DbContext[] = [
      // Gestora e cidadã da prefeitura, com ela no contexto.
      { tenantId: a.tenantId, userId: managerId },
      { tenantId: a.tenantId, userId: citizenId },
      // Conta da equipe interna sem o papel no contexto.
      { userId: supportId },
      // Sem contexto.
      {},
    ];
    for (const context of refused) {
      const errors = [
        await pgError(summaries(context)),
        await pgError(overview(context)),
        await pgError(detail(a.tenantId, context)),
      ];
      for (const error of errors) expect(error.code).toBe('42501');
    }

    for (const context of [asSupport(), asPlatformAdmin()]) {
      expect((await summaries(context)).some((row) => row.tenant_id === a.tenantId)).toBe(true);
      expect(await overview(context)).toBeDefined();
      expect(await detail(a.tenantId, context)).toHaveLength(1);
    }
  });

  it('resumo por prefeitura conta cidadãos distintos, abertas e alertas de revisão e impedimento', async () => {
    expect(await summaryOf(a.tenantId)).toEqual({
      tenant_id: a.tenantId,
      citizen_count: 2,
      // 2 em triagem e 6 em atendimento (4 com atividade, 2 das solicitações recentes).
      open_count: 8,
      avg_resolution_days: '3.0',
      late_review_count: 1,
      stale_impediment_count: 1,
      active_category_count: 1,
    });
    // Prefeitura em implantação também aparece, zerada.
    expect(await summaryOf(onboarding.tenantId)).toEqual({
      tenant_id: onboarding.tenantId,
      citizen_count: 0,
      open_count: 0,
      avg_resolution_days: null,
      late_review_count: 0,
      stale_impediment_count: 0,
      active_category_count: 1,
    });
  });

  it('visão geral conta as solicitações do mês e do mês anterior no horário de Brasília', async () => {
    const before = await overview();

    // Começo do mês corrente e do anterior em Brasília (UTC-3, sem horário de verão).
    const brasilia = new Date(Date.now() - 3 * HOUR_MS);
    const year = brasilia.getUTCFullYear();
    const month = brasilia.getUTCMonth();
    const thisMonth = new Date(Date.UTC(year, month, 1, 3));
    const lastMonth = new Date(Date.UTC(year, month - 1, 1, 3));

    const newcomer = await createUser({ name: 'Recém-chegado' });
    // Mês corrente: 1 minuto depois da virada em Brasília.
    await createRequest(a, newcomer, new Date(thisMonth.getTime() + 60_000));
    // Mês anterior: 1 hora antes da virada em Brasília (já é o mês corrente em UTC) e logo
    // depois da virada do mês anterior.
    await createRequest(a, newcomer, new Date(thisMonth.getTime() - HOUR_MS));
    await createRequest(a, newcomer, new Date(lastMonth.getTime() + 60_000));
    // Antes do mês anterior: fora das duas contas.
    await createRequest(a, newcomer, new Date(lastMonth.getTime() - 60_000));
    // Prefeitura em implantação: conta no mês, mas a pessoa não conta como cidadão.
    const elsewhere = await createUser({ name: 'Cidadão em implantação' });
    await createRequest(onboarding, elsewhere, new Date(thisMonth.getTime() + 60_000));
    await createTenant('Backoffice C', 'onboarding');

    const after = await overview();
    expect(after.requests_this_month - before.requests_this_month).toBe(2);
    expect(after.requests_last_month - before.requests_last_month).toBe(2);
    expect(after.citizens - before.citizens).toBe(1);
    expect(after.active_tenants - before.active_tenants).toBe(0);
    expect(after.onboarding_tenants - before.onboarding_tenants).toBe(1);
    expect(after.suspended_tenants - before.suspended_tenants).toBe(0);
  });

  it('tempo médio usa a publicação dos últimos 30 dias', async () => {
    expect((await summaryOf(a.tenantId)).avg_resolution_days).toBe('3.0');
    expect((await detail(a.tenantId))[0]!.avg_resolution_days).toBe('3.0');

    // Na prefeitura em implantação: 10 dias até a publicação. Entra no resumo dela, mas não
    // na média da visão geral, que é só das ativas.
    const before = await overview();
    const citizen = await createUser({ name: 'Cidadão B' });
    const request = await createRequest(onboarding, citizen, ago(12 * DAY_MS));
    await publishEvent(onboarding, request, ago(2 * DAY_MS));
    expect((await summaryOf(onboarding.tenantId)).avg_resolution_days).toBe('10.0');
    expect((await overview()).avg_resolution_days).toBe(before.avg_resolution_days);
    expect(before.avg_resolution_days).not.toBeNull();
  });

  it('detalhe conta usuários do painel uma vez por pessoa', async () => {
    const rows = await detail(a.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: a.tenantId,
      // Os testes rodam em ordem: a visão geral acrescentou um cidadão e 4 ocorrências abertas.
      citizen_count: 3,
      open_count: 12,
      stale_triage_count: 1,
      awaiting_review_count: 2,
      late_review_count: 1,
      team_count: 1,
      active_agent_count: 1,
      invited_agent_count: 1,
      manager_count: 3,
      admin_count: 2,
      active_category_count: 1,
      // u1, u2, u4, u6 e a gestora do beforeAll.
      panel_user_count: 5,
      avg_resolution_days: '3.0',
    });

    // Prefeitura inexistente: nenhuma linha.
    expect(await detail('00000000-0000-4000-8000-000000000000')).toEqual([]);
  });
});

describe('admin da prefeitura nova', () => {
  it('admin da prefeitura é criado só pelo admin da plataforma', async () => {
    const refused: DbContext[] = [
      asSupport(),
      { userId: platformAdminId },
      { tenantId: a.tenantId, userId: managerId },
      {},
    ];
    for (const context of refused) {
      const error = await pgError(
        findOrCreateTenantAdmin(context, 'Fulano', newCpf(), 'fulano@backoffice.dev'),
      );
      expect(error.code).toBe('42501');
    }

    const cpf = newCpf();
    const created = await findOrCreateTenantAdmin(
      asPlatformAdmin(),
      'Helena Prado',
      cpf,
      'helena@backoffice.dev',
    );
    expect(created.email).toBe('helena@backoffice.dev');
    expect(await userRow(created.id)).toMatchObject({
      name: 'Helena Prado',
      cpf,
      email: 'helena@backoffice.dev',
      phone: null,
      platformRole: null,
    });
  });

  it('admin da prefeitura com CPF existente mantém o e-mail', async () => {
    // Conta com e-mail: devolve o que ela já tem; a API compara com o digitado.
    const cpf = newCpf();
    const existing = await createUser({ name: 'Bruno Sá', cpf, email: 'bruno@backoffice.dev' });
    const found = await findOrCreateTenantAdmin(
      asPlatformAdmin(),
      'Outro nome',
      cpf,
      'outro@backoffice.dev',
    );
    expect(found).toEqual({ id: existing, email: 'bruno@backoffice.dev' });
    expect(await userRow(existing)).toMatchObject({
      name: 'Bruno Sá',
      email: 'bruno@backoffice.dev',
    });

    // Conta sem e-mail recebe o digitado.
    const noEmailCpf = newCpf();
    const noEmail = await createUser({ name: 'Cidadã com CPF', cpf: noEmailCpf });
    expect(
      await findOrCreateTenantAdmin(asPlatformAdmin(), 'X', noEmailCpf, 'cida@backoffice.dev'),
    ).toEqual({ id: noEmail, email: 'cida@backoffice.dev' });
    expect((await userRow(noEmail)).name).toBe('Cidadã com CPF');

    // E-mail de outra conta cai no índice único, sem diferenciar maiúsculas.
    const inUse = await pgError(
      findOrCreateTenantAdmin(asPlatformAdmin(), 'Fulano', newCpf(), 'BRUNO@backoffice.dev'),
    );
    expect(inUse).toMatchObject({ code: '23505', constraint: 'users_email_lower_idx' });

    // CPF de conta congelada: não é achada e a criação cai no CPF único.
    const frozenCpf = newCpf();
    await createUser({ name: 'Congelada', cpf: frozenCpf, accountStatus: 'frozen' });
    const frozen = await pgError(
      findOrCreateTenantAdmin(asPlatformAdmin(), 'Fulano', frozenCpf, 'f@backoffice.dev'),
    );
    expect(frozen).toMatchObject({ code: '23505', constraint: 'users_cpf_unique' });
  });
});
