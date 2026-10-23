import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { geoPoint, type Database, type Transaction } from './client.js';
import {
  categories,
  departmentManagers,
  departments,
  memberships,
  occurrences,
  requests,
  teamMembers,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';

export const DEMO_IBGE_CODE = '9999901';
const AGENT_EMAIL = 'agente.demo@alocidadao.dev';
export const AGENT_PHONE = '+5511900000001';
const CITIZEN_EMAIL = 'cidadao.demo@alocidadao.dev';
export const CITIZEN_PHONE = '+5511900000002';
export const MANAGER_CPF = '52998224725';
export const MANAGER_EMAIL = 'gestor.demo@alocidadao.dev';
export const ADMIN_CPF = '11144477735';
export const ADMIN_EMAIL = 'admin.demo@alocidadao.dev';
const DEPARTMENT_NAME = 'Obras';
const TEAM_NAME = 'Equipe Obras – Centro';
const CATEGORY_NAME = 'Buraco na via';

/** Ponto de referência (centro de São Paulo) em torno do qual ficam as solicitações. */
const CENTER = { lat: -23.5505, lng: -46.6333 };

/** Meia-largura, em graus, do limite quadrado da prefeitura demo em torno de CENTER (≈ 5,5 km). */
const BOUNDARY_HALF_SIDE = 0.05;

// Deslocamentos fixos (1e-3 grau de latitude ≈ 111 m; de longitude ≈ 102 m nesta latitude),
// todos a menos de 300 m do centro.
const REQUESTS = [
  { description: 'Buraco na via em frente ao número 100', dLat: 0, dLng: 0.0005 },
  { description: 'Buraco profundo na esquina', dLat: 0.001, dLng: -0.0005 },
  { description: 'Buraco no cruzamento, risco para motos', dLat: -0.0015, dLng: 0.001 },
];

export interface SeedDevResult {
  tenantId: string;
  teamId: string;
  agentId: string;
  managerId: string;
  platformAdminId: string;
  workOrderIds: string[];
}

type SeedBase = Omit<SeedDevResult, 'managerId' | 'platformAdminId'>;

/**
 * Cria as 3 solicitações da demo, cada uma na sua ocorrência, com a atividade atribuída à equipe.
 * Devolve os ids das atividades na ordem de REQUESTS.
 */
async function createDemoWorkOrders(
  tx: Transaction,
  ids: { tenantId: string; teamId: string; categoryId: string; citizenId: string },
): Promise<string[]> {
  const { tenantId, teamId, categoryId, citizenId } = ids;
  // created_at explícito e crescente: dentro de uma transação now() é igual para todas as
  // linhas, e a ordem por created_at é o que reencontra as atividades na segunda execução.
  const base = Date.now();
  const workOrderIds: string[] = [];
  for (const [index, item] of REQUESTS.entries()) {
    const createdAt = new Date(base + index * 1000);
    const location = geoPoint({ lat: CENTER.lat + item.dLat, lng: CENTER.lng + item.dLng });
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId, categoryId, location, status: 'in_progress', createdAt })
      .returning({ id: occurrences.id });
    await tx.insert(requests).values({
      tenantId,
      citizenId,
      categoryId,
      occurrenceId: occurrence!.id,
      status: 'in_progress',
      description: item.description,
      location,
      gpsLocation: location,
      createdAt,
    });
    const [order] = await tx
      .insert(workOrders)
      .values({ tenantId, occurrenceId: occurrence!.id, teamId, status: 'assigned', createdAt })
      .returning({ id: workOrders.id });
    workOrderIds.push(order!.id);
  }
  return workOrderIds;
}

/**
 * Cria a prefeitura de demonstração (IBGE 9999901) com equipe, agente, cidadão e 3 solicitações,
 * cada uma na sua ocorrência, com a atividade da ocorrência atribuída à equipe.
 * Idempotente: se a prefeitura já existe, devolve os ids existentes. Se ela existe mas a equipe
 * ficou sem atividades (uma migração apagou os dados operacionais), recria as 3 solicitações.
 * Exige a conexão do dono do banco (superusuário): ele cria a prefeitura e os usuários, que são
 * globais, e não passa pelo RLS.
 */
export async function seedDev(db: Database): Promise<SeedDevResult> {
  return db.transaction(async (tx) => {
    const base = await seedTenantData(tx);
    const staff = await seedStaff(tx, base.tenantId);
    return { ...base, ...staff };
  });
}

/** Cria a conta pelo CPF se faltar; devolve o id (nova ou existente). */
async function ensureUser(
  tx: Transaction,
  values: { cpf: string; email: string; name: string; platformRole?: 'admin' },
): Promise<string> {
  const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.cpf, values.cpf));
  if (found) {
    if (values.platformRole) {
      await tx
        .update(users)
        .set({ platformRole: values.platformRole })
        .where(eq(users.id, found.id));
    }
    return found.id;
  }
  const [created] = await tx.insert(users).values(values).returning({ id: users.id });
  return created!.id;
}

/**
 * Gestor demo (vínculo `manager` na prefeitura e no setor demo) e admin interno demo
 * (platform_role 'admin'). Idempotente: só cria o que falta. Entram pelo painel
 * (e-mail e CPF preenchidos), não pelo app.
 */
async function seedStaff(
  tx: Transaction,
  tenantId: string,
): Promise<{ managerId: string; platformAdminId: string }> {
  const managerId = await ensureUser(tx, {
    cpf: MANAGER_CPF,
    email: MANAGER_EMAIL,
    name: 'Gestor Demo',
  });
  const platformAdminId = await ensureUser(tx, {
    cpf: ADMIN_CPF,
    email: ADMIN_EMAIL,
    name: 'Admin Demo',
    platformRole: 'admin',
  });

  const [link] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, managerId)));
  if (!link) {
    await tx.insert(memberships).values({ tenantId, userId: managerId, role: 'manager' });
  }

  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.name, DEPARTMENT_NAME)));
  if (!department) throw new Error('A prefeitura demo existe mas está incompleta');
  await tx
    .insert(departmentManagers)
    .values({ tenantId, departmentId: department.id, userId: managerId })
    .onConflictDoNothing();
  return { managerId, platformAdminId };
}

async function seedTenantData(tx: Transaction): Promise<SeedBase> {
  // Duas execuções ao mesmo tempo esperam uma pela outra: a segunda já encontra a prefeitura.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('seed-dev'))`);
  const [existing] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ibgeCode, DEMO_IBGE_CODE));
  const tenantId = existing?.id ?? randomUUID();
  // next_request_protocol() lê a prefeitura de app_current_tenant().
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

  // Limite quadrado em torno de CENTER; também preenche a prefeitura demo criada antes do limite.
  const setBoundary = sql`
      update tenants
      set boundary = ST_Multi(ST_MakeEnvelope(
        ${CENTER.lng - BOUNDARY_HALF_SIDE}, ${CENTER.lat - BOUNDARY_HALF_SIDE},
        ${CENTER.lng + BOUNDARY_HALF_SIDE}, ${CENTER.lat + BOUNDARY_HALF_SIDE}, 4326))
      where id = ${tenantId} and boundary is null`;

  if (existing) {
    await tx.execute(setBoundary);
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.name, TEAM_NAME)));
    const [agent] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, AGENT_EMAIL));
    if (!team || !agent) throw new Error('A prefeitura demo existe mas está incompleta');
    const orders = await tx
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.teamId, team.id)))
      .orderBy(asc(workOrders.createdAt));
    if (orders.length > 0) {
      return {
        tenantId,
        teamId: team.id,
        agentId: agent.id,
        workOrderIds: orders.map((o) => o.id),
      };
    }
    // Uma migração apagou os dados operacionais: recria as solicitações e as atividades.
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.name, CATEGORY_NAME)));
    const [citizen] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, CITIZEN_EMAIL));
    if (!category || !citizen) throw new Error('A prefeitura demo existe mas está incompleta');
    const workOrderIds = await createDemoWorkOrders(tx, {
      tenantId,
      teamId: team.id,
      categoryId: category.id,
      citizenId: citizen.id,
    });
    return { tenantId, teamId: team.id, agentId: agent.id, workOrderIds };
  }

  await tx.insert(tenants).values({
    id: tenantId,
    name: 'Município Demo A',
    displayName: 'Prefeitura Demo A',
    city: 'Demo A',
    state: 'SP',
    ibgeCode: DEMO_IBGE_CODE,
    status: 'active',
  });
  await tx.execute(setBoundary);

  // Usuários são globais e entram sem senha (login por telefone); os dados são só de desenvolvimento.
  const [agent] = await tx
    .insert(users)
    .values({
      name: 'Agente Demo',
      email: AGENT_EMAIL,
      phone: AGENT_PHONE,
    })
    .returning({ id: users.id });
  const [citizen] = await tx
    .insert(users)
    .values({ name: 'Cidadão Demo', email: CITIZEN_EMAIL, phone: CITIZEN_PHONE })
    .returning({ id: users.id });

  await tx.insert(memberships).values([
    { tenantId, userId: agent!.id, role: 'field_agent' },
    { tenantId, userId: citizen!.id, role: 'citizen' },
  ]);

  const [department] = await tx
    .insert(departments)
    .values({ tenantId, name: DEPARTMENT_NAME })
    .returning({ id: departments.id });
  const [team] = await tx
    .insert(teams)
    .values({ tenantId, departmentId: department!.id, name: TEAM_NAME })
    .returning({ id: teams.id });
  await tx.insert(teamMembers).values({ tenantId, teamId: team!.id, userId: agent!.id });
  const [category] = await tx
    .insert(categories)
    .values({ tenantId, departmentId: department!.id, name: CATEGORY_NAME })
    .returning({ id: categories.id });

  const workOrderIds = await createDemoWorkOrders(tx, {
    tenantId,
    teamId: team!.id,
    categoryId: category!.id,
    citizenId: citizen!.id,
  });
  return { tenantId, teamId: team!.id, agentId: agent!.id, workOrderIds };
}
