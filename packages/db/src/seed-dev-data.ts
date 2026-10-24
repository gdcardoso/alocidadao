import { randomUUID } from 'node:crypto';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  type GeoPoint,
  type IconGroup,
  type ReworkDetails,
} from '@alocidadao/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { geoPoint, type Database, type Transaction } from './client.js';
import {
  categories,
  departmentManagers,
  departments,
  memberships,
  municipalities,
  occurrences,
  requests,
  statusEvents,
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
const MANAGER_NAME = 'Carlos Demo';
export const ADMIN_CPF = '11144477735';
export const ADMIN_EMAIL = 'admin.demo@alocidadao.dev';
const DEPARTMENT_NAME = 'Obras';
const TEAM_NAME = 'Equipe Obras – Centro';
const CATEGORY_NAME = 'Buraco na via';

/** Ponto de referência (centro de São Paulo) em torno do qual ficam as solicitações. */
const CENTER = { lat: -23.5505, lng: -46.6333 };

/** Meia-largura, em graus, do limite quadrado da prefeitura demo em torno de CENTER (≈ 5,5 km). */
const BOUNDARY_HALF_SIDE = 0.05;

/**
 * Centro do município vizinho inventado "Vila Sem Adesão" (9999902), sem prefeitura: um quadrado
 * do mesmo tamanho, colado a leste do limite da demo. Serve para ver a tela 5c no emulador.
 */
export const DEMO_UNSERVED_CENTER: GeoPoint = {
  lat: CENTER.lat,
  lng: CENTER.lng + 2 * BOUNDARY_HALF_SIDE,
};
const DEMO_UNSERVED_IBGE_CODE = '9999902';

/** Os 9 tipos da tela 5, com o ícone Lucide, o grupo e o raio de agrupamento (spec 5.2). */
const DEMO_CATALOG: ReadonlyArray<{
  name: string;
  icon: string;
  iconGroup: IconGroup;
  clusterRadiusM: number;
}> = [
  { name: CATEGORY_NAME, icon: 'construction', iconGroup: 'infrastructure', clusterRadiusM: 15 },
  { name: 'Iluminação', icon: 'lightbulb', iconGroup: 'infrastructure', clusterRadiusM: 25 },
  { name: 'Lixo e entulho', icon: 'trash-2', iconGroup: 'environment', clusterRadiusM: 30 },
  { name: 'Poda de árvore', icon: 'trees', iconGroup: 'environment', clusterRadiusM: 20 },
  { name: 'Esgoto', icon: 'droplets', iconGroup: 'environment', clusterRadiusM: 20 },
  { name: 'Calçada', icon: 'footprints', iconGroup: 'infrastructure', clusterRadiusM: 20 },
  { name: 'Sinalização', icon: 'signpost', iconGroup: 'infrastructure', clusterRadiusM: 50 },
  { name: 'Animal', icon: 'paw-print', iconGroup: 'public_services', clusterRadiusM: 50 },
  { name: 'Outro', icon: 'circle-ellipsis', iconGroup: 'public_services', clusterRadiusM: 20 },
];

/** Quadrado de lado 2 × BOUNDARY_HALF_SIDE em torno de `center`, como MultiPolygon 4326. */
function squareAround(center: GeoPoint) {
  return sql`ST_Multi(ST_MakeEnvelope(
    ${center.lng - BOUNDARY_HALF_SIDE}, ${center.lat - BOUNDARY_HALF_SIDE},
    ${center.lng + BOUNDARY_HALF_SIDE}, ${center.lat + BOUNDARY_HALF_SIDE}, 4326))`;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Cidadãos que fazem os relatos extras da primeira atividade (a ocorrência com 3 relatos). */
const EXTRA_CITIZENS = [
  { name: 'Cidadã Demo 2', email: 'cidadao2.demo@alocidadao.dev', phone: '+5511900000003' },
  { name: 'Cidadão Demo 3', email: 'cidadao3.demo@alocidadao.dev', phone: '+5511900000004' },
];

/** Endereços do primeiro relato de cada atividade da demo, na ordem de DEMO_WORK_ORDERS. */
export const DEMO_ADDRESSES = [
  'Rua das Flores, 120 — Centro',
  'Av. Brasil, 1450',
  'Rua Ipê, 33',
  'Rua XV, 88',
] as const;

interface DemoWorkOrder {
  /** Descrição do primeiro relato; é por ela que a segunda execução reencontra a atividade. */
  description: string;
  /** Endereço do primeiro relato (os cartões e o detalhe do agente mostram). */
  address: string;
  /** Deslocamento fixo em graus (1e-3 de latitude ≈ 111 m; de longitude ≈ 102 m nesta latitude). */
  dLat: number;
  dLng: number;
  /** Há quantas horas o gestor atribuiu a atividade à equipe. */
  assignedHoursAgo: number;
  /** Prazo, em dias a partir da execução do seed. */
  dueInDays: number;
  managerInstructions: string;
  /** Relatos de outros cidadãos na mesma ocorrência, um por cidadão de EXTRA_CITIZENS. */
  extraReports?: string[];
  /** Atividade que o agente concluiu e o gestor devolveu pedindo ajuste. */
  rework?: { agentNote: string; comment: string; details: ReworkDetails };
}

// Todas a menos de 300 m do centro.
const DEMO_WORK_ORDERS: DemoWorkOrder[] = [
  {
    description: 'Buraco na via em frente ao número 100',
    address: DEMO_ADDRESSES[0],
    dLat: 0,
    dLng: 0.0005,
    assignedHoursAgo: 0.5,
    dueInDays: 1,
    managerInstructions:
      'Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h.',
    extraReports: [
      'Buraco grande na faixa de pedestres, as crianças da escola desviam pela rua',
      '',
    ],
  },
  {
    description: 'Buraco profundo na esquina',
    address: DEMO_ADDRESSES[1],
    dLat: 0.001,
    dLng: -0.0005,
    assignedHoursAgo: 3,
    dueInDays: 3,
    managerInstructions:
      'Sinalizar a esquina com cones antes de começar. Trânsito intenso no fim da tarde.',
  },
  {
    description: 'Buraco no cruzamento, risco para motos',
    address: DEMO_ADDRESSES[2],
    dLat: -0.0015,
    dLng: 0.001,
    assignedHoursAgo: 26,
    dueInDays: 5,
    managerInstructions:
      'Conferir se o buraco aumentou desde o relato e levar placa de sinalização.',
  },
  {
    description: 'Buraco perto do ponto de ônibus',
    address: DEMO_ADDRESSES[3],
    dLat: 0.002,
    dLng: 0.0015,
    assignedHoursAgo: 30,
    dueInDays: 2,
    managerInstructions:
      'Usar massa asfáltica e compactar bem. Avisar o motorista do ônibus da linha 107.',
    rework: {
      agentNote: 'Buraco tapado com massa asfáltica e compactado. Área sinalizada até secar.',
      comment:
        'As fotos 2 e 3 ficaram escuras e não mostram o buraco tapado. Tire uma de perto e uma de longe, com a rua aparecendo.',
      details: { reasons: ['new_photos'], discardedPhotoIds: [] },
    },
  },
];

export interface SeedDevOptions {
  /**
   * Volta a demo ao começo: cancela as atividades ativas da demo (com o evento, como o gestor
   * faria) e cria outras, atribuídas de novo.
   */
  reset?: boolean;
}

export interface SeedDevResult {
  tenantId: string;
  teamId: string;
  agentId: string;
  managerId: string;
  platformAdminId: string;
  workOrderIds: string[];
}

/** Prefeitura, equipe e pessoas da demo, antes do gestor e das atividades. */
interface SeedBase {
  tenantId: string;
  teamId: string;
  agentId: string;
  categoryId: string;
  citizenId: string;
}

interface DemoIds {
  tenantId: string;
  teamId: string;
  categoryId: string;
  citizenId: string;
  agentId: string;
  managerId: string;
}

/**
 * Garante as 4 atividades da demo, cada uma na sua ocorrência, e devolve os ids na ordem de
 * DEMO_WORK_ORDERS. Idempotente: reencontra cada atividade ativa pela descrição do relato do
 * cidadão demo e só cria o que falta (ocorrência, relatos extras, atribuição, instruções, prazo).
 */
async function seedDemoWorkOrders(
  tx: Transaction,
  ids: DemoIds,
  { reset = false }: SeedDevOptions,
): Promise<string[]> {
  const extraCitizenIds: string[] = [];
  for (const citizen of EXTRA_CITIZENS) {
    extraCitizenIds.push(await ensureCitizen(tx, ids.tenantId, citizen));
  }
  const now = Date.now();
  const workOrderIds: string[] = [];
  for (const [index, item] of DEMO_WORK_ORDERS.entries()) {
    const location: GeoPoint = { lat: CENTER.lat + item.dLat, lng: CENTER.lng + item.dLng };
    let existing = await findDemoWorkOrder(tx, ids, item);
    if (existing && reset) {
      await cancelDemoWorkOrder(tx, ids, existing.id);
      existing = undefined;
    }
    const order = existing ?? (await createDemoWorkOrder(tx, ids, item, location, now, index));

    // Demo criada antes dos endereços: o primeiro relato ganha o da demo.
    await tx
      .update(requests)
      .set({ address: sql`coalesce(${requests.address}, ${item.address})` })
      .where(
        and(
          eq(requests.occurrenceId, order.occurrenceId),
          eq(requests.citizenId, ids.citizenId),
          eq(requests.description, item.description),
        ),
      );

    await tx
      .update(workOrders)
      .set({
        managerInstructions: sql`coalesce(${workOrders.managerInstructions}, ${item.managerInstructions})`,
        dueAt: sql`coalesce(${workOrders.dueAt}, ${new Date(now + item.dueInDays * DAY_MS)})`,
      })
      .where(eq(workOrders.id, order.id));

    const [assigned] = await tx
      .select({ id: statusEvents.id })
      .from(statusEvents)
      .where(and(eq(statusEvents.workOrderId, order.id), eq(statusEvents.toStatus, 'assigned')));
    if (!assigned) {
      await tx.insert(statusEvents).values({
        tenantId: ids.tenantId,
        occurrenceId: order.occurrenceId,
        workOrderId: order.id,
        toStatus: 'assigned',
        actorUserId: ids.managerId,
        createdAt: order.createdAt,
      });
    }

    const [firstReport] = await tx
      .select({ createdAt: requests.createdAt })
      .from(requests)
      .where(eq(requests.occurrenceId, order.occurrenceId))
      .orderBy(asc(requests.createdAt))
      .limit(1);
    for (const [extraIndex, description] of (item.extraReports ?? []).entries()) {
      const citizenId = extraCitizenIds[extraIndex]!;
      const [found] = await tx
        .select({ id: requests.id })
        .from(requests)
        .where(
          and(eq(requests.occurrenceId, order.occurrenceId), eq(requests.citizenId, citizenId)),
        );
      if (found) continue;
      // Poucos metros ao lado do primeiro relato, dentro do raio de agrupamento do tipo.
      const point = geoPoint({
        lat: location.lat + (extraIndex + 1) * 0.00002,
        lng: location.lng - (extraIndex + 1) * 0.00002,
      });
      await tx.insert(requests).values({
        tenantId: ids.tenantId,
        citizenId,
        categoryId: ids.categoryId,
        occurrenceId: order.occurrenceId,
        status: 'in_progress',
        description,
        location: point,
        gpsLocation: point,
        // Depois do primeiro relato, que continua dando protocolo e descrição à ocorrência.
        createdAt: new Date(firstReport!.createdAt.getTime() + (extraIndex + 1) * 15 * 60 * 1000),
      });
    }
    workOrderIds.push(order.id);
  }
  return workOrderIds;
}

/** Cancela a atividade ativa da demo, com o evento feito pelo gestor demo (reset). */
async function cancelDemoWorkOrder(tx: Transaction, ids: DemoIds, id: string): Promise<void> {
  const [order] = await tx
    .select({ status: workOrders.status, occurrenceId: workOrders.occurrenceId })
    .from(workOrders)
    .where(eq(workOrders.id, id));
  await tx
    .update(workOrders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(workOrders.id, id));
  await tx.insert(statusEvents).values({
    tenantId: ids.tenantId,
    occurrenceId: order!.occurrenceId,
    workOrderId: id,
    fromStatus: order!.status,
    toStatus: 'cancelled',
    actorUserId: ids.managerId,
    comment: 'Cancelada ao reiniciar a demo (seed com --reset)',
  });
}

interface DemoOrderRow {
  id: string;
  occurrenceId: string;
  createdAt: Date;
}

/**
 * A atividade mais recente da ocorrência do último relato de `item` feito pelo cidadão demo.
 * Concluída ou cancelada (alguém usou a demo até o fim) não conta: o seed cria outra.
 */
async function findDemoWorkOrder(
  tx: Transaction,
  ids: DemoIds,
  item: DemoWorkOrder,
): Promise<DemoOrderRow | undefined> {
  const [request] = await tx
    .select({ occurrenceId: requests.occurrenceId })
    .from(requests)
    .where(
      and(
        eq(requests.tenantId, ids.tenantId),
        eq(requests.citizenId, ids.citizenId),
        eq(requests.description, item.description),
      ),
    )
    .orderBy(desc(requests.createdAt))
    .limit(1);
  if (!request) return undefined;
  const [order] = await tx
    .select({
      id: workOrders.id,
      occurrenceId: workOrders.occurrenceId,
      status: workOrders.status,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .where(eq(workOrders.occurrenceId, request.occurrenceId))
    .orderBy(desc(workOrders.createdAt))
    .limit(1);
  if (!order || !ACTIVE_WORK_ORDER_STATUSES.includes(order.status)) return undefined;
  return { id: order.id, occurrenceId: order.occurrenceId, createdAt: order.createdAt };
}

/** Cria a ocorrência, o primeiro relato e a atividade de `item` (com a devolução, se houver). */
async function createDemoWorkOrder(
  tx: Transaction,
  ids: DemoIds,
  item: DemoWorkOrder,
  location: GeoPoint,
  now: number,
  index: number,
): Promise<DemoOrderRow> {
  const { tenantId, teamId, categoryId, citizenId } = ids;
  // O relato chega um pouco antes da atribuição; o índice desempata atividades da mesma hora.
  const assignedAt = new Date(now - item.assignedHoursAgo * HOUR_MS + index * 1000);
  const reportedAt = new Date(assignedAt.getTime() - HOUR_MS);
  const point = geoPoint(location);
  const [occurrence] = await tx
    .insert(occurrences)
    .values({ tenantId, categoryId, location: point, status: 'in_progress', createdAt: reportedAt })
    .returning({ id: occurrences.id });
  const occurrenceId = occurrence!.id;
  await tx.insert(requests).values({
    tenantId,
    citizenId,
    categoryId,
    occurrenceId,
    status: 'in_progress',
    description: item.description,
    address: item.address,
    location: point,
    gpsLocation: point,
    createdAt: reportedAt,
  });
  const [order] = await tx
    .insert(workOrders)
    .values({
      tenantId,
      occurrenceId,
      teamId,
      status: item.rework ? 'rework_requested' : 'assigned',
      agentNote: item.rework?.agentNote ?? null,
      createdAt: assignedAt,
    })
    .returning({
      id: workOrders.id,
      occurrenceId: workOrders.occurrenceId,
      createdAt: workOrders.createdAt,
    });

  if (item.rework) {
    // Atribuída → iniciada 2 h depois → enviada 1 h depois → devolvida 1 h antes de agora.
    const at = (hours: number) => new Date(assignedAt.getTime() + hours * HOUR_MS);
    const event = { tenantId, occurrenceId, workOrderId: order!.id };
    const reworkAt = new Date(now - HOUR_MS);
    await tx.insert(statusEvents).values([
      {
        ...event,
        fromStatus: 'assigned',
        toStatus: 'in_execution',
        actorUserId: ids.agentId,
        createdAt: at(2),
      },
      {
        ...event,
        fromStatus: 'in_execution',
        toStatus: 'awaiting_review',
        actorUserId: ids.agentId,
        comment: item.rework.agentNote,
        createdAt: at(3),
      },
      {
        ...event,
        fromStatus: 'awaiting_review',
        toStatus: 'rework_requested',
        actorUserId: ids.managerId,
        comment: item.rework.comment,
        details: item.rework.details,
        createdAt: reworkAt,
      },
    ]);
    await tx.update(workOrders).set({ updatedAt: reworkAt }).where(eq(workOrders.id, order!.id));
  }
  return order!;
}

/** Cidadão demo extra (pelo e-mail), com vínculo de cidadão na prefeitura. Idempotente. */
async function ensureCitizen(
  tx: Transaction,
  tenantId: string,
  values: { name: string; email: string; phone: string },
): Promise<string> {
  const [found] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, values.email));
  const userId =
    found?.id ?? (await tx.insert(users).values(values).returning({ id: users.id }))[0]!.id;
  await tx.insert(memberships).values({ tenantId, userId, role: 'citizen' }).onConflictDoNothing();
  return userId;
}

/**
 * Cria a prefeitura de demonstração (IBGE 9999901) com equipe, agente, cidadãos, gestor e as
 * atividades de DEMO_WORK_ORDERS, cada uma na sua ocorrência e atribuída à equipe pelo gestor.
 * Idempotente: reencontra o que já existe e só cria o que falta; se uma migração apagou os dados
 * operacionais, recria as atividades. Com `reset`, cancela as atividades ativas da demo e cria
 * outras. Exige a conexão do dono do banco (superusuário): ele cria a prefeitura e os usuários, que são
 * globais, e não passa pelo RLS.
 */
export async function seedDev(db: Database, options: SeedDevOptions = {}): Promise<SeedDevResult> {
  return db.transaction(async (tx) => {
    const base = await seedTenantData(tx);
    await seedCatalog(tx, base.tenantId);
    await seedMunicipalities(tx);
    const staff = await seedStaff(tx, base.tenantId);
    const workOrderIds = await seedDemoWorkOrders(tx, { ...base, ...staff }, options);
    return {
      tenantId: base.tenantId,
      teamId: base.teamId,
      agentId: base.agentId,
      ...staff,
      workOrderIds,
    };
  });
}

/**
 * Os 9 tipos da demo no setor demo. Idempotente: cria o que falta e atualiza ícone, grupo e
 * raio dos que já existem (o "Buraco na via" criado antes do catálogo ganha os campos novos).
 */
async function seedCatalog(tx: Transaction, tenantId: string): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.name, DEPARTMENT_NAME)));
  if (!department) throw new Error('A prefeitura demo existe mas está incompleta');
  await tx
    .insert(categories)
    .values(DEMO_CATALOG.map((item) => ({ ...item, tenantId, departmentId: department.id })))
    .onConflictDoUpdate({
      target: [categories.tenantId, categories.name],
      set: {
        icon: sql`excluded.icon`,
        iconGroup: sql`excluded.icon_group`,
        clusterRadiusM: sql`excluded.cluster_radius_m`,
      },
    });
}

/**
 * Municípios da demo: "Cidade Demo" (9999901), com o mesmo limite da prefeitura, e o vizinho
 * "Vila Sem Adesão" (9999902), sem prefeitura. Idempotente.
 */
async function seedMunicipalities(tx: Transaction): Promise<void> {
  await tx
    .insert(municipalities)
    .values([
      {
        ibgeCode: DEMO_IBGE_CODE,
        name: 'Cidade Demo',
        state: 'SP',
        boundary: squareAround(CENTER),
      },
      {
        ibgeCode: DEMO_UNSERVED_IBGE_CODE,
        name: 'Vila Sem Adesão',
        state: 'SP',
        boundary: squareAround(DEMO_UNSERVED_CENTER),
      },
    ])
    .onConflictDoUpdate({
      target: municipalities.ibgeCode,
      set: {
        name: sql`excluded.name`,
        state: sql`excluded.state`,
        boundary: sql`excluded.boundary`,
      },
    });
}

/** Cria a conta pelo CPF se faltar (a existente fica com o nome da demo); devolve o id. */
async function ensureUser(
  tx: Transaction,
  values: { cpf: string; email: string; name: string; platformRole?: 'admin' },
): Promise<string> {
  const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.cpf, values.cpf));
  if (found) {
    await tx
      .update(users)
      .set({ name: values.name, ...(values.platformRole && { platformRole: values.platformRole }) })
      .where(eq(users.id, found.id));
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
    name: MANAGER_NAME,
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
      set boundary = ${squareAround(CENTER)}
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
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.name, CATEGORY_NAME)));
    const [citizen] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, CITIZEN_EMAIL));
    if (!category || !citizen) throw new Error('A prefeitura demo existe mas está incompleta');
    return {
      tenantId,
      teamId: team.id,
      agentId: agent.id,
      categoryId: category.id,
      citizenId: citizen.id,
    };
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

  return {
    tenantId,
    teamId: team!.id,
    agentId: agent!.id,
    categoryId: category!.id,
    citizenId: citizen!.id,
  };
}
