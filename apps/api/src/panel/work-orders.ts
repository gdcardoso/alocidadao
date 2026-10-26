import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  IMPEDIMENT_REASONS,
  QUEUE_LIMIT,
  type ImpedimentDetail,
  type ImpedimentReason,
  type ReviewDetail,
  type WorkOrderHeader,
  type WorkQueueResponse,
} from '@alocidadao/shared';
import { and, asc, count, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Storage } from '../storage/s3.js';
import { departmentScope, panelDbContext, type PanelIdentity } from './member.js';

const {
  categories,
  departments,
  occurrences,
  photos,
  requests,
  statusEvents,
  teams,
  users,
  workOrders,
} = schema;

/** Mesma validade das fotos do cidadão (citizen/requests.ts). */
const PHOTO_URL_SECONDS = 15 * 60;
/** Fotos de abertura mostradas na revisão (uma por solicitação). */
const CITIZEN_PHOTOS_LIMIT = 8;

/**
 * Desde quando a atividade (a tabela `work_orders`, sem apelido, na consulta) está no status
 * atual: o `created_at` do evento mais recente dela com `to_status` igual ao status atual.
 * Sem evento, `work_orders.updated_at`.
 */
export function workOrderStatusSinceSql(): SQL<Date> {
  return sql<Date>`coalesce(
    (
      select max(se.created_at)
      from status_events se
      where se.tenant_id = work_orders.tenant_id
        and se.work_order_id = work_orders.id
        and se.to_status = work_orders.status::text
    ),
    work_orders.updated_at
  )`.mapWith(workOrders.updatedAt);
}

/** Endereço da solicitação não cancelada mais antiga da ocorrência (`occurrences` sem apelido). */
function firstAddressSql(): SQL<string | null> {
  return sql<string | null>`(
    select r.address
    from requests r
    where r.tenant_id = occurrences.tenant_id
      and r.occurrence_id = occurrences.id
      and r.status <> 'cancelled'
    order by r.created_at, r.id
    limit 1
  )`;
}

/**
 * Atividade no alcance de quem usa o painel, com a categoria, o setor e a equipe; undefined
 * quando não existe, é de outra prefeitura (RLS) ou está fora do alcance (404
 * `work_order_not_found` nos três casos). Com `lock`, trava a linha da atividade
 * (`FOR UPDATE OF work_orders`). Deve rodar no contexto da prefeitura.
 */
export async function findScopedWorkOrder(
  tx: Transaction,
  identity: PanelIdentity,
  id: string,
  options: { lock?: boolean } = {},
) {
  const query = tx
    .select({
      id: workOrders.id,
      status: workOrders.status,
      occurrenceId: workOrders.occurrenceId,
      teamId: workOrders.teamId,
      teamName: teams.name,
      dueAt: workOrders.dueAt,
      agentNote: workOrders.agentNote,
      managerInstructions: workOrders.managerInstructions,
      impedimentReason: workOrders.impedimentReason,
      statusSince: workOrderStatusSinceSql(),
      category: {
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        iconGroup: categories.iconGroup,
        defaultDeadlineDays: categories.defaultDeadlineDays,
        departmentId: categories.departmentId,
        departmentName: departments.name,
      },
    })
    .from(workOrders)
    .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
    .innerJoin(categories, eq(categories.id, occurrences.categoryId))
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .innerJoin(teams, eq(teams.id, workOrders.teamId))
    .where(
      and(
        eq(workOrders.tenantId, identity.tenantId),
        eq(workOrders.id, id),
        departmentScope(identity),
      ),
    );
  const [row] = options.lock ? await query.for('update', { of: workOrders }) : await query;
  return row;
}

export type ScopedWorkOrder = NonNullable<Awaited<ReturnType<typeof findScopedWorkOrder>>>;

/** O motivo vem de texto livre no banco: o que não for um motivo conhecido vira null. */
export const parseImpedimentReason = (value: string | null): ImpedimentReason | null =>
  IMPEDIMENT_REASONS.find((reason) => reason === value) ?? null;

/** Fila de atividades no status (revisão ou impedimento): a que espera há mais tempo primeiro. */
export async function loadWorkQueue(
  db: Database,
  identity: PanelIdentity,
  status: 'awaiting_review' | 'impeded',
): Promise<WorkQueueResponse> {
  const { tenantId } = identity;
  const where = and(
    eq(workOrders.tenantId, tenantId),
    eq(workOrders.status, status),
    departmentScope(identity),
  );
  return withContext(db, panelDbContext(identity), async (tx) => {
    const [total] = await tx
      .select({ n: count() })
      .from(workOrders)
      .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .where(where);
    const since = workOrderStatusSinceSql();
    const rows = await tx
      .select({
        workOrderId: workOrders.id,
        occurrenceId: workOrders.occurrenceId,
        categoryName: categories.name,
        icon: categories.icon,
        iconGroup: categories.iconGroup,
        address: firstAddressSql(),
        departmentName: departments.name,
        teamName: teams.name,
        statusSince: since,
        impedimentReason: workOrders.impedimentReason,
      })
      .from(workOrders)
      .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
      .innerJoin(categories, eq(categories.id, occurrences.categoryId))
      .innerJoin(departments, eq(departments.id, categories.departmentId))
      .innerJoin(teams, eq(teams.id, workOrders.teamId))
      .where(where)
      .orderBy(asc(since), asc(workOrders.id))
      .limit(QUEUE_LIMIT);
    return {
      total: total!.n,
      items: rows.map((row) => ({
        ...row,
        statusSince: row.statusSince.toISOString(),
        // O motivo só existe na fila de impedimentos.
        impedimentReason: status === 'impeded' ? parseImpedimentReason(row.impedimentReason) : null,
      })),
    };
  });
}

/** Cabeçalho comum: o agente e o horário vêm do evento mais recente com o status atual. */
export async function loadWorkOrderHeader(
  tx: Transaction,
  order: ScopedWorkOrder,
): Promise<WorkOrderHeader> {
  const [event] = await tx
    .select({
      createdAt: statusEvents.createdAt,
      distanceM: sql<string | null>`${statusEvents.details}->>'distanceM'`,
      agentName: users.name,
    })
    .from(statusEvents)
    .leftJoin(users, eq(users.id, statusEvents.actorUserId))
    .where(and(eq(statusEvents.workOrderId, order.id), eq(statusEvents.toStatus, order.status)))
    .orderBy(desc(statusEvents.createdAt), desc(statusEvents.id))
    .limit(1);
  const [place] = await tx
    .select({ address: firstAddressSql() })
    .from(occurrences)
    .where(eq(occurrences.id, order.occurrenceId));
  const [active] = await tx
    .select({ n: count() })
    .from(requests)
    .where(and(eq(requests.occurrenceId, order.occurrenceId), eq(requests.status, 'in_progress')));
  return {
    workOrderId: order.id,
    occurrenceId: order.occurrenceId,
    status: order.status,
    categoryName: order.category.name,
    icon: order.category.icon,
    iconGroup: order.category.iconGroup,
    categoryId: order.category.id,
    departmentName: order.category.departmentName,
    defaultDeadlineDays: order.category.defaultDeadlineDays,
    address: place?.address ?? null,
    teamId: order.teamId,
    teamName: order.teamName,
    agentName: event?.agentName ?? null,
    eventAt: (event?.createdAt ?? order.statusSince).toISOString(),
    distanceM:
      event?.distanceM === null || event?.distanceM === undefined ? null : Number(event.distanceM),
    activeRequestCount: active!.n,
    managerInstructions: order.managerInstructions,
  };
}

/**
 * Detalhe da revisão: cabeçalho, relato do agente, fotos de conclusão pendentes e a primeira
 * foto de cada solicitação não cancelada (até 8). Nada que identifique cidadão. undefined
 * quando a atividade não existe, está fora do alcance ou não está `awaiting_review`. Sem
 * `storage`, as fotos pendentes saem com `url` vazia (o id ainda serve para publicar) e as
 * fotos dos cidadãos não saem.
 */
export async function loadReviewDetail(
  db: Database,
  identity: PanelIdentity,
  id: string,
  storage?: Storage,
): Promise<ReviewDetail | undefined> {
  const loaded = await withContext(db, panelDbContext(identity), async (tx) => {
    const order = await findScopedWorkOrder(tx, identity, id);
    if (!order || order.status !== 'awaiting_review') return undefined;
    const header = await loadWorkOrderHeader(tx, order);
    const pending = await tx
      .select({ id: photos.id, storageKey: photos.storageKey })
      .from(photos)
      .where(
        and(
          eq(photos.workOrderId, order.id),
          eq(photos.purpose, 'completion'),
          eq(photos.review, 'pending'),
        ),
      )
      .orderBy(asc(photos.createdAt), asc(photos.id));
    const citizen = await tx
      .select({
        storageKey: sql<string | null>`(
          select p.storage_key
          from photos p
          where p.tenant_id = requests.tenant_id
            and p.request_id = requests.id
            and p.purpose = 'report'
          order by p.created_at, p.id
          limit 1
        )`,
      })
      .from(requests)
      .where(and(eq(requests.occurrenceId, order.occurrenceId), ne(requests.status, 'cancelled')))
      .orderBy(asc(requests.createdAt), asc(requests.id));
    return { order, header, pending, citizen };
  });
  if (!loaded) return undefined;
  const { order, header, pending, citizen } = loaded;
  const sign = (key: string) => (storage ? storage.presignGet(key, PHOTO_URL_SECONDS) : '');
  const citizenKeys = citizen
    .map((row) => row.storageKey)
    .filter((key): key is string => key !== null)
    .slice(0, CITIZEN_PHOTOS_LIMIT);
  return {
    ...header,
    agentNote: order.agentNote,
    pendingPhotos: await Promise.all(
      pending.map(async (photo) => ({ id: photo.id, url: await sign(photo.storageKey) })),
    ),
    citizenPhotos: storage
      ? await Promise.all(citizenKeys.map(async (key) => ({ url: await sign(key) })))
      : [],
  };
}

/**
 * Detalhe do impedimento: cabeçalho, motivo, relato (o comentário do evento de impedimento) e
 * a foto de impedimento mais recente. undefined quando a atividade não existe, está fora do
 * alcance ou não está `impeded`. Sem `storage`, `photoUrl` é null.
 */
export async function loadImpedimentDetail(
  db: Database,
  identity: PanelIdentity,
  id: string,
  storage?: Storage,
): Promise<ImpedimentDetail | undefined> {
  const loaded = await withContext(db, panelDbContext(identity), async (tx) => {
    const order = await findScopedWorkOrder(tx, identity, id);
    if (!order || order.status !== 'impeded') return undefined;
    const header = await loadWorkOrderHeader(tx, order);
    const [event] = await tx
      .select({ comment: statusEvents.comment })
      .from(statusEvents)
      .where(and(eq(statusEvents.workOrderId, order.id), eq(statusEvents.toStatus, 'impeded')))
      .orderBy(desc(statusEvents.createdAt), desc(statusEvents.id))
      .limit(1);
    const [photo] = await tx
      .select({ storageKey: photos.storageKey })
      .from(photos)
      .where(and(eq(photos.workOrderId, order.id), eq(photos.purpose, 'impediment')))
      .orderBy(desc(photos.createdAt), desc(photos.id))
      .limit(1);
    return { order, header, note: event?.comment ?? null, photoKey: photo?.storageKey };
  });
  if (!loaded) return undefined;
  return {
    ...loaded.header,
    reason: parseImpedimentReason(loaded.order.impedimentReason),
    note: loaded.note,
    photoUrl:
      storage && loaded.photoKey
        ? await storage.presignGet(loaded.photoKey, PHOTO_URL_SECONDS)
        : null,
  };
}
