import { randomUUID } from 'node:crypto';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  type DeviceLocation,
  type GeoPoint,
  type IconGroup,
  type ImpedimentReason,
  type PlatformRole,
  type ReworkDetails,
} from '@alocidadao/shared';
import { and, asc, count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
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
  tenantContracts,
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
export const SUPPORT_CPF = '86288366757';
export const SUPPORT_EMAIL = 'suporte.demo@alocidadao.dev';
export const TENANT_ADMIN_CPF = '39053344705';
export const TENANT_ADMIN_EMAIL = 'admin.prefeitura@alocidadao.dev';
const TENANT_ADMIN_NAME = 'Rita Demo';
const DEPARTMENT_NAME = 'Obras';
const CLEANING_DEPARTMENT_NAME = 'Limpeza Urbana';
const TEAM_NAME = 'Equipe Obras – Centro';
const NORTH_TEAM_NAME = 'Equipe Obras – Norte';
const CLEANING_TEAM_NAME = 'Equipe Limpeza – Centro';
const CLEANING_CATEGORY_NAMES = ['Lixo e entulho', 'Poda de árvore'];
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

/** Descrições do primeiro relato das duas atividades aguardando revisão (há 30 h e há 3 h). */
export const DEMO_REVIEW_DESCRIPTIONS = [
  'Buraco tapado pela metade na saída da garagem',
  'Asfalto afundado em frente à padaria',
] as const;

/** Descrição do primeiro relato da atividade impedida. */
export const DEMO_IMPEDIMENT_DESCRIPTION = 'Cratera na faixa de ônibus, carros furando o pneu';

interface DemoQueueItem {
  /** Descrição do primeiro relato; é por ela que a segunda execução reencontra a atividade. */
  description: string;
  address: string;
  /** Deslocamento fixo em graus, longe das outras atividades da demo (raio de 15 m do tipo). */
  dLat: number;
  dLng: number;
  /** Onde a atividade está na fila do painel. */
  status: 'awaiting_review' | 'impeded';
  /** Há quantas horas o agente concluiu ou relatou o impedimento: a espera na fila. */
  waitHours: number;
  /** Distância do agente até o local no evento do agente (`details.distanceM`). */
  distanceM: number;
  managerInstructions: string;
  /** Relato da conclusão (vai para `agent_note`) ou detalhes do impedimento. */
  agentComment: string;
  impedimentReason?: ImpedimentReason;
  /** Relatos de outros cidadãos na mesma ocorrência, um por cidadão de EXTRA_CITIZENS. */
  extraReports?: string[];
}

// A fila de revisão e de impedimentos do painel (W3 e W4), todas da Equipe Obras – Centro.
const DEMO_QUEUE: DemoQueueItem[] = [
  {
    description: DEMO_REVIEW_DESCRIPTIONS[0],
    address: 'Rua Bela Cintra, 210',
    dLat: -0.0005,
    dLng: -0.001,
    status: 'awaiting_review',
    waitHours: 30,
    distanceM: 8,
    managerInstructions: 'Fechar o buraco inteiro e deixar a saída da garagem liberada.',
    agentComment:
      'Buraco fechado com massa asfáltica e compactado com placa vibratória. A saída da garagem ficou liberada.',
    extraReports: ['O carro bate o fundo toda vez que sai da garagem'],
  },
  {
    description: DEMO_REVIEW_DESCRIPTIONS[1],
    address: 'Rua da Consolação, 2300',
    dLat: 0.0015,
    dLng: -0.0015,
    status: 'awaiting_review',
    waitHours: 3,
    distanceM: 250,
    managerInstructions: 'Avaliar se o afundamento é só no asfalto ou se há vazamento embaixo.',
    agentComment: 'Asfalto recomposto no trecho afundado. Não havia vazamento embaixo.',
  },
  {
    description: DEMO_IMPEDIMENT_DESCRIPTION,
    address: 'Av. Rebouças, 1100',
    dLat: -0.002,
    dLng: -0.0005,
    status: 'impeded',
    waitHours: 3,
    distanceM: 12,
    managerInstructions: 'Isolar a faixa de ônibus antes de começar. Avisar a SPTrans.',
    agentComment:
      'A cratera tem mais de 1 m de largura. A massa asfáltica do caminhão não dá para fechar; precisa de uma carga inteira.',
    impedimentReason: 'missing_material',
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
  /** A fila do painel, na ordem de DEMO_QUEUE: duas em revisão (30 h e 3 h) e uma impedida. */
  panelWorkOrderIds: string[];
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

/**
 * Garante as atividades da fila do painel (DEMO_QUEUE), cada uma na sua ocorrência em
 * atendimento, e devolve os ids na ordem da lista. Idempotente: reencontra cada uma pela
 * descrição do relato do cidadão demo enquanto ela continua ativa, mesmo que o gestor a tenha
 * devolvido ao agente; a concluída ou cancelada é criada de novo. Com `reset`, cancela as que
 * estão ativas e cria outras, com as esperas do desenho (o reset recusa a ocorrência antiga, que
 * fica fora do `keep`).
 */
async function seedDemoQueue(
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
  for (const [index, item] of DEMO_QUEUE.entries()) {
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
    const [found] = request
      ? await tx
          .select({ id: workOrders.id, status: workOrders.status })
          .from(workOrders)
          .where(eq(workOrders.occurrenceId, request.occurrenceId))
          .orderBy(desc(workOrders.createdAt))
          .limit(1)
      : [];
    const active = found && ACTIVE_WORK_ORDER_STATUSES.includes(found.status);
    if (active && !reset) {
      // Ainda ativa, mesmo fora da fila (devolvida ao agente, reagendada): fica como está.
      workOrderIds.push(found.id);
      continue;
    }
    if (active) await cancelDemoWorkOrder(tx, ids, found.id);
    workOrderIds.push(await createDemoQueueOrder(tx, ids, item, extraCitizenIds, now, index));
  }
  return workOrderIds;
}

/**
 * Cria a ocorrência, os relatos e a atividade de `item`, com o histórico: atribuída pelo gestor,
 * iniciada e concluída (ou impedida) pelo agente. As datas são retroativas, para a espera na fila
 * ser a do desenho.
 */
async function createDemoQueueOrder(
  tx: Transaction,
  ids: DemoIds,
  item: DemoQueueItem,
  extraCitizenIds: string[],
  now: number,
  index: number,
): Promise<string> {
  const { tenantId, teamId, categoryId, citizenId } = ids;
  // O índice desempata as que esperam desde a mesma hora.
  const agentAt = new Date(now - item.waitHours * HOUR_MS + index * 1000);
  const startedAt = new Date(agentAt.getTime() - HOUR_MS);
  const assignedAt = new Date(agentAt.getTime() - 4 * HOUR_MS);
  const reportedAt = new Date(assignedAt.getTime() - HOUR_MS);
  const site: GeoPoint = { lat: CENTER.lat + item.dLat, lng: CENTER.lng + item.dLng };
  const point = geoPoint(site);

  const [occurrence] = await tx
    .insert(occurrences)
    .values({ tenantId, categoryId, location: point, status: 'in_progress', createdAt: reportedAt })
    .returning({ id: occurrences.id });
  const occurrenceId = occurrence!.id;
  const reports = [item.description, ...(item.extraReports ?? [])];
  for (const [reportIndex, description] of reports.entries()) {
    // Poucos metros ao lado do primeiro relato, dentro do raio de agrupamento do tipo.
    const reportPoint = geoPoint({
      lat: site.lat + reportIndex * 0.00002,
      lng: site.lng - reportIndex * 0.00002,
    });
    await tx.insert(requests).values({
      tenantId,
      citizenId: reportIndex === 0 ? citizenId : extraCitizenIds[reportIndex - 1]!,
      categoryId,
      occurrenceId,
      status: 'in_progress',
      description,
      address: reportIndex === 0 ? item.address : null,
      location: reportPoint,
      gpsLocation: reportPoint,
      createdAt: new Date(reportedAt.getTime() + reportIndex * 15 * 60 * 1000),
    });
  }

  const isReview = item.status === 'awaiting_review';
  const [order] = await tx
    .insert(workOrders)
    .values({
      tenantId,
      occurrenceId,
      teamId,
      status: item.status,
      dueAt: new Date(now + 2 * DAY_MS),
      managerInstructions: item.managerInstructions,
      agentNote: isReview ? item.agentComment : null,
      completedAt: isReview ? agentAt : null,
      impedimentReason: item.impedimentReason ?? null,
      createdAt: assignedAt,
      updatedAt: agentAt,
    })
    .returning({ id: workOrders.id });

  // O agente estava a `distanceM` metros ao norte do local (1 grau de latitude ≈ 111,2 km).
  const location: DeviceLocation = {
    lat: site.lat + item.distanceM / 111_195,
    lng: site.lng,
    accuracyM: 10,
  };
  const event = { tenantId, occurrenceId, workOrderId: order!.id };
  await tx.insert(statusEvents).values([
    { ...event, toStatus: 'assigned', actorUserId: ids.managerId, createdAt: assignedAt },
    {
      ...event,
      fromStatus: 'assigned',
      toStatus: 'in_execution',
      actorUserId: ids.agentId,
      createdAt: startedAt,
    },
    {
      ...event,
      fromStatus: 'in_execution',
      toStatus: item.status,
      actorUserId: ids.agentId,
      comment: item.agentComment,
      details: {
        ...(item.impedimentReason ? { reason: item.impedimentReason } : {}),
        location,
        distanceM: item.distanceM,
      },
      createdAt: agentAt,
    },
  ]);
  return order!.id;
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

/** Latitude de 1 grau ≈ 111,2 km; as bases das equipes ficam a esta distância ao sul e ao norte. */
const DEG_PER_KM = 1 / 111.195;

interface DemoTeam {
  name: string;
  department: string;
  base?: { address: string; location: GeoPoint };
}

/** Equipes da demo. A Norte não tem agentes; a de Limpeza não tem base. */
const DEMO_TEAMS: DemoTeam[] = [
  {
    name: TEAM_NAME,
    department: DEPARTMENT_NAME,
    // A cerca de 1 km ao sul do centro.
    base: {
      address: 'Rua do Paço, 50',
      location: { lat: CENTER.lat - 1 * DEG_PER_KM, lng: CENTER.lng },
    },
  },
  {
    name: NORTH_TEAM_NAME,
    department: DEPARTMENT_NAME,
    // A cerca de 5 km ao norte do centro.
    base: {
      address: 'Av. Santos Dumont, 800',
      location: { lat: CENTER.lat + 5 * DEG_PER_KM, lng: CENTER.lng },
    },
  },
  { name: CLEANING_TEAM_NAME, department: CLEANING_DEPARTMENT_NAME },
];

/**
 * Setor Limpeza Urbana (com Lixo e entulho e Poda de árvore, que saem de Obras) e as equipes da
 * demo, com a base das que têm. Idempotente: a base já gravada (editada no painel) é mantida.
 */
async function seedTeams(tx: Transaction, tenantId: string): Promise<void> {
  await tx
    .insert(departments)
    .values({ tenantId, name: CLEANING_DEPARTMENT_NAME })
    .onConflictDoNothing();
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.tenantId, tenantId));
  const departmentId = new Map(departmentRows.map((row) => [row.name, row.id]));
  const cleaningId = departmentId.get(CLEANING_DEPARTMENT_NAME)!;
  await tx
    .update(categories)
    .set({ departmentId: cleaningId })
    .where(
      and(eq(categories.tenantId, tenantId), inArray(categories.name, CLEANING_CATEGORY_NAMES)),
    );

  for (const team of DEMO_TEAMS) {
    const [found] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.name, team.name)));
    const base = team.base && {
      baseAddress: team.base.address,
      baseLocation: geoPoint(team.base.location),
    };
    if (!found) {
      await tx.insert(teams).values({
        tenantId,
        departmentId: departmentId.get(team.department)!,
        name: team.name,
        ...base,
      });
    } else if (base) {
      await tx
        .update(teams)
        .set({
          baseAddress: sql`coalesce(${teams.baseAddress}, ${base.baseAddress})`,
          baseLocation: sql`coalesce(${teams.baseLocation}, ${base.baseLocation})`,
        })
        .where(eq(teams.id, found.id));
    }
  }
}

interface DemoTriage {
  /** Descrição do primeiro relato; é por ela que a segunda execução reencontra a ocorrência. */
  description: string;
  address: string;
  categoryName: string;
  dLat: number;
  dLng: number;
  /** Há quantas horas chegou o primeiro relato e a ocorrência entrou em triagem. */
  hoursAgo: number;
  /** Observações dos relatos seguintes, de outros cidadãos (o 1º é o cidadão demo). */
  extraReports?: string[];
  /** Cidadãos do primeiro relato e dos seguintes: índices em [cidadão demo, ...EXTRA_CITIZENS]. */
  citizens: number[];
}

// Longe das atividades da demo (todas a menos de 300 m do centro), para as sugestões não se misturarem.
const DEMO_TRIAGE: DemoTriage[] = [
  {
    description: 'Buraco fundo no meio da rua, os carros desviam para a contramão',
    address: 'Rua Augusta, 900',
    categoryName: CATEGORY_NAME,
    dLat: -0.004,
    dLng: -0.003,
    hoursAgo: 48,
    extraReports: ['O buraco aumentou depois da chuva de ontem', ''],
    citizens: [0, 1, 2],
  },
  {
    // A 10 m da anterior, dentro do raio de 15 m do tipo: vira sugestão de junção.
    description: 'Buraco pequeno perto do bueiro',
    address: 'Rua Augusta, 910',
    categoryName: CATEGORY_NAME,
    dLat: -0.004 + 0.01 * DEG_PER_KM,
    dLng: -0.003,
    hoursAgo: 6,
    citizens: [1],
  },
  {
    description: 'Poste apagado há uma semana, a rua fica escura à noite',
    address: 'Rua Vergueiro, 1200',
    categoryName: 'Iluminação',
    dLat: 0.003,
    dLng: -0.002,
    hoursAgo: 96,
    citizens: [2],
  },
  {
    description: 'Calçada quebrada, cadeirante não consegue passar',
    address: 'Av. Paulista, 1500',
    categoryName: 'Calçada',
    dLat: -0.003,
    dLng: 0.003,
    hoursAgo: 5,
    citizens: [1],
  },
  {
    description: 'Entulho jogado na esquina há dias',
    address: 'Rua Oscar Freire, 300',
    categoryName: 'Lixo e entulho',
    dLat: 0.004,
    dLng: 0.002,
    hoursAgo: 24,
    extraReports: ['Lixo acumulado na calçada, com mau cheiro'],
    citizens: [0, 2],
  },
];

/**
 * Ocorrências em triagem da demo (a fila do painel), com relatos de cidadãos diferentes e datas
 * retroativas no relato e no evento da ocorrência (o "aberta há" do painel). Idempotente: só cria
 * a que falta. Com `reset`, recria a que foi tratada (já não está em triagem ou perdeu relatos).
 */
async function seedDemoTriage(
  tx: Transaction,
  ids: { tenantId: string; citizenId: string },
  { reset = false }: SeedDevOptions,
): Promise<string[]> {
  const occurrenceIds: string[] = [];
  const citizenIds = [ids.citizenId];
  for (const citizen of EXTRA_CITIZENS) {
    citizenIds.push(await ensureCitizen(tx, ids.tenantId, citizen));
  }
  const categoryRows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.tenantId, ids.tenantId));
  const categoryId = new Map(categoryRows.map((row) => [row.name, row.id]));
  const now = Date.now();

  for (const item of DEMO_TRIAGE) {
    const expected = 1 + (item.extraReports?.length ?? 0);
    const [first] = await tx
      .select({ occurrenceId: requests.occurrenceId })
      .from(requests)
      .where(and(eq(requests.tenantId, ids.tenantId), eq(requests.description, item.description)))
      .orderBy(desc(requests.createdAt))
      .limit(1);
    if (first) {
      if (!reset) {
        occurrenceIds.push(first.occurrenceId);
        continue;
      }
      const [occurrence] = await tx
        .select({ status: occurrences.status })
        .from(occurrences)
        .where(eq(occurrences.id, first.occurrenceId));
      const [reports] = await tx
        .select({ total: count() })
        .from(requests)
        .where(eq(requests.occurrenceId, first.occurrenceId));
      if (occurrence?.status === 'triage' && reports?.total === expected) {
        occurrenceIds.push(first.occurrenceId);
        continue;
      }
    }

    const location: GeoPoint = { lat: CENTER.lat + item.dLat, lng: CENTER.lng + item.dLng };
    const point = geoPoint(location);
    const reportedAt = new Date(now - item.hoursAgo * HOUR_MS);
    const category = categoryId.get(item.categoryName);
    if (!category) throw new Error(`Tipo da demo ausente: ${item.categoryName}`);
    const [occurrence] = await tx
      .insert(occurrences)
      .values({
        tenantId: ids.tenantId,
        categoryId: category,
        location: point,
        status: 'triage',
        createdAt: reportedAt,
      })
      .returning({ id: occurrences.id });
    occurrenceIds.push(occurrence!.id);
    const reports = [item.description, ...(item.extraReports ?? [])];
    for (const [index, description] of reports.entries()) {
      // Poucos metros ao lado do primeiro relato, dentro do raio de agrupamento do tipo.
      const reportPoint = geoPoint({
        lat: location.lat + index * 0.00002,
        lng: location.lng - index * 0.00002,
      });
      await tx.insert(requests).values({
        tenantId: ids.tenantId,
        citizenId: citizenIds[item.citizens[index]!]!,
        categoryId: category,
        occurrenceId: occurrence!.id,
        status: 'open',
        description,
        address: index === 0 ? item.address : null,
        location: reportPoint,
        gpsLocation: reportPoint,
        // Depois do primeiro relato, que continua dando protocolo e endereço à ocorrência.
        createdAt: new Date(reportedAt.getTime() + index * 15 * 60 * 1000),
      });
    }
    // O evento da ocorrência (sem solicitação nem atividade) é o "desde quando" do status.
    await tx.insert(statusEvents).values({
      tenantId: ids.tenantId,
      occurrenceId: occurrence!.id,
      toStatus: 'triage',
      createdAt: reportedAt,
    });
  }
  return occurrenceIds;
}

/** Motivo público das ocorrências que o reset tira do mapa e da triagem (10 a 500 caracteres). */
export const RESET_REJECTION_REASON = 'Retirada ao reiniciar os dados de demonstração.';

/**
 * Reset: recusa toda ocorrência em triagem ou em atendimento da prefeitura demo que não é uma
 * das fixtures (`keep`), como o painel faria: a atividade ativa é cancelada, as solicitações não
 * finais são recusadas e cada passo ganha o evento. Limpa o que sobrou de junções, separações e
 * atribuições feitas no painel, as ocorrências de resets antigos (o mesmo buraco várias vezes no
 * mesmo ponto) e os relatos de teste feitos pelo app.
 */
async function retireStrayOccurrences(
  tx: Transaction,
  ids: { tenantId: string; managerId: string },
  keep: string[],
): Promise<void> {
  const stray = await tx
    .select({ id: occurrences.id, status: occurrences.status })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.tenantId, ids.tenantId),
        inArray(occurrences.status, ['triage', 'in_progress']),
        keep.length > 0 ? notInArray(occurrences.id, keep) : undefined,
      ),
    )
    .orderBy(asc(occurrences.createdAt))
    .for('update');
  const event = { tenantId: ids.tenantId, actorUserId: ids.managerId };
  const comment = RESET_REJECTION_REASON;
  for (const occurrence of stray) {
    const now = new Date();
    const orders = await tx
      .select({ id: workOrders.id, status: workOrders.status })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.occurrenceId, occurrence.id),
          inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
        ),
      );
    for (const order of orders) {
      await tx
        .update(workOrders)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(workOrders.id, order.id));
      await tx.insert(statusEvents).values({
        ...event,
        occurrenceId: occurrence.id,
        workOrderId: order.id,
        fromStatus: order.status,
        toStatus: 'cancelled',
        comment,
      });
    }
    const pending = await tx
      .select({ id: requests.id, status: requests.status })
      .from(requests)
      .where(
        and(
          eq(requests.occurrenceId, occurrence.id),
          inArray(requests.status, ['open', 'in_progress']),
        ),
      );
    for (const request of pending) {
      await tx
        .update(requests)
        .set({ status: 'rejected', statusChangedAt: now, updatedAt: now })
        .where(eq(requests.id, request.id));
      await tx.insert(statusEvents).values({
        ...event,
        occurrenceId: occurrence.id,
        requestId: request.id,
        fromStatus: request.status,
        toStatus: 'rejected',
        comment,
      });
    }
    await tx
      .update(occurrences)
      .set({ status: 'rejected', rejectionReason: comment, updatedAt: now })
      .where(eq(occurrences.id, occurrence.id));
    await tx.insert(statusEvents).values({
      ...event,
      occurrenceId: occurrence.id,
      fromStatus: occurrence.status,
      toStatus: 'rejected',
      comment,
    });
  }
}

/**
 * Cria a prefeitura de demonstração (IBGE 9999901) com equipe, agente, cidadãos, gestor e as
 * atividades de DEMO_WORK_ORDERS, cada uma na sua ocorrência e atribuída à equipe pelo gestor.
 * Idempotente: reencontra o que já existe e só cria o que falta; se uma migração apagou os dados
 * operacionais, recria as atividades. Com `reset`, cancela as atividades ativas da demo e cria
 * outras, recria a triagem de exemplo que foi tratada e recusa as demais ocorrências abertas da
 * prefeitura demo (retireStrayOccurrences). Cria também a fila de revisão e de impedimentos do
 * painel (DEMO_QUEUE), que o reset recria e não recusa. Exige a conexão do dono do banco
 * (superusuário): ele cria a prefeitura e os usuários, que são globais, e não passa pelo RLS.
 */
export async function seedDev(db: Database, options: SeedDevOptions = {}): Promise<SeedDevResult> {
  return db.transaction(async (tx) => {
    const base = await seedTenantData(tx);
    await seedCatalog(tx, base.tenantId);
    await seedTeams(tx, base.tenantId);
    await seedMunicipalities(tx);
    const staff = await seedStaff(tx, base.tenantId);
    const workOrderIds = await seedDemoWorkOrders(tx, { ...base, ...staff }, options);
    const panelWorkOrderIds = await seedDemoQueue(tx, { ...base, ...staff }, options);
    const triageIds = await seedDemoTriage(tx, base, options);
    if (options.reset) {
      const demoOrders = await tx
        .select({ occurrenceId: workOrders.occurrenceId })
        .from(workOrders)
        .where(inArray(workOrders.id, [...workOrderIds, ...panelWorkOrderIds]));
      const keep = [...demoOrders.map((order) => order.occurrenceId), ...triageIds];
      await retireStrayOccurrences(tx, { tenantId: base.tenantId, ...staff }, keep);
    }
    return {
      tenantId: base.tenantId,
      teamId: base.teamId,
      agentId: base.agentId,
      ...staff,
      workOrderIds,
      panelWorkOrderIds,
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
  values: { cpf: string; email: string; name: string; platformRole?: PlatformRole },
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
 * Gestor demo (vínculo `manager` na prefeitura e no setor demo), admin interno demo
 * (platform_role 'admin'), suporte demo (platform_role 'support', sem vínculo), o admin da
 * prefeitura e o contrato da prefeitura demo. Idempotente: só cria o que falta. Entram pelo
 * painel (e-mail e CPF preenchidos), não pelo app.
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
  await ensureUser(tx, {
    cpf: SUPPORT_CPF,
    email: SUPPORT_EMAIL,
    name: 'Suporte Demo',
    platformRole: 'support',
  });

  // Contrato da prefeitura demo (P3), criado uma vez só.
  const [contract] = await tx
    .select({ id: tenantContracts.id })
    .from(tenantContracts)
    .where(eq(tenantContracts.tenantId, tenantId))
    .limit(1);
  if (!contract) {
    await tx.insert(tenantContracts).values({
      tenantId,
      plan: 'complete',
      includedPanelUsers: 50,
      startsOn: '2026-11-01',
      endsOn: '2027-10-31',
    });
  }

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

  // Admin da prefeitura: entra pelo painel com vínculo tenant_admin, sem setor.
  const tenantAdminId = await ensureUser(tx, {
    cpf: TENANT_ADMIN_CPF,
    email: TENANT_ADMIN_EMAIL,
    name: TENANT_ADMIN_NAME,
  });
  await tx
    .insert(memberships)
    .values({ tenantId, userId: tenantAdminId, role: 'tenant_admin' })
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
