import { schema, withContext, type Transaction } from '@alocidadao/db';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  FINAL_REQUEST_STATUSES,
  agentWorkOrderCardSchema,
  agentWorkOrderDetailSchema,
  apiErrorSchema,
  reworkDetailsSchema,
  type AgentWorkOrderCard,
  type AgentWorkOrderDetail,
} from '@alocidadao/shared';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';
import type { Storage } from '../storage/s3.js';
import type { AgentDeps } from './routes.js';

const {
  workOrders,
  occurrences,
  requests,
  categories,
  teams,
  departments,
  teamMembers,
  statusEvents,
  photos,
  users,
} = schema;

/** Validade dos links das fotos mostradas ao agente. */
const PHOTO_URL_SECONDS = 15 * 60;

const idParams = z.object({ id: z.uuid() });

/** Último evento da atividade para `status`, com o nome de quem o fez (se visível). */
async function lastEventTo(tx: Transaction, workOrderId: string, status: string) {
  const [event] = await tx
    .select({
      actorName: users.name,
      comment: statusEvents.comment,
      details: statusEvents.details,
      at: statusEvents.createdAt,
    })
    .from(statusEvents)
    .leftJoin(users, eq(users.id, statusEvents.actorUserId))
    .where(and(eq(statusEvents.workOrderId, workOrderId), eq(statusEvents.toStatus, status)))
    .orderBy(desc(statusEvents.createdAt), desc(statusEvents.id))
    .limit(1);
  return event;
}

/**
 * Atividades visíveis ao agente: das equipes de que ele é membro, nos status ativos. `extra`
 * restringe mais (por exemplo, uma atividade só). Roda na prefeitura do contexto.
 */
function selectCards(tx: Transaction, userId: string, extra?: SQL) {
  // Protocolo e endereço vêm da solicitação mais antiga da ocorrência.
  const firstRequest = tx
    .selectDistinctOn([requests.occurrenceId], {
      occurrenceId: requests.occurrenceId,
      protocol: requests.protocol,
      address: requests.address,
    })
    .from(requests)
    .orderBy(requests.occurrenceId, asc(requests.createdAt), asc(requests.id))
    .as('first_request');

  return tx
    .select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      status: workOrders.status,
      occurrenceId: workOrders.occurrenceId,
      protocol: firstRequest.protocol,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryGroup: categories.iconGroup,
      address: firstRequest.address,
      location: occurrences.location,
      teamName: teams.name,
      departmentName: departments.name,
      dueAt: workOrders.dueAt,
      managerInstructions: workOrders.managerInstructions,
      agentNote: workOrders.agentNote,
      reportCount: sql<number>`(
        select count(*)::int from requests r
        where r.occurrence_id = ${workOrders.occurrenceId} and r.status <> 'cancelled'
      )`,
      // Reagendar grava outra atribuição: vale a mais recente.
      assignedAt: sql<Date>`coalesce((
        select max(e.created_at) from status_events e
        where e.work_order_id = ${workOrders.id} and e.to_status = 'assigned'
      ), ${workOrders.createdAt})`.mapWith(workOrders.createdAt),
      statusChangedAt: sql<Date>`coalesce((
        select max(e.created_at) from status_events e
        where e.work_order_id = ${workOrders.id}
      ), ${workOrders.createdAt})`.mapWith(workOrders.createdAt),
    })
    .from(workOrders)
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, workOrders.teamId), eq(teamMembers.userId, userId)),
    )
    .innerJoin(teams, eq(teams.id, workOrders.teamId))
    .innerJoin(departments, eq(departments.id, teams.departmentId))
    .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
    .innerJoin(firstRequest, eq(firstRequest.occurrenceId, occurrences.id))
    .innerJoin(categories, eq(categories.id, occurrences.categoryId))
    .where(and(inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]), extra))
    .orderBy(asc(workOrders.createdAt), asc(workOrders.id));
}

type CardRow = Awaited<ReturnType<typeof selectCards>>[number];

function toCard(row: CardRow): AgentWorkOrderCard {
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status,
    protocol: row.protocol,
    categoryName: row.categoryName,
    categoryIcon: row.categoryIcon,
    categoryGroup: row.categoryGroup,
    address: row.address,
    // geometry em modo xy: x = longitude, y = latitude.
    location: { lat: row.location.y, lng: row.location.x },
    teamName: row.teamName,
    reportCount: row.reportCount,
    dueAt: row.dueAt?.toISOString() ?? null,
    assignedAt: row.assignedAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
  };
}

/**
 * Detalhe para o agente. Dos cidadãos só saem o texto e a data de cada relato e as fotos do
 * relato e da contestação: nunca nome, telefone ou e-mail, nem fotos de conclusão.
 */
async function loadDetail(
  tx: Transaction,
  storage: Storage,
  userId: string,
  workOrderId: string,
): Promise<AgentWorkOrderDetail | undefined> {
  const [row] = await selectCards(tx, userId, eq(workOrders.id, workOrderId));
  if (!row) return undefined;

  const reports = await tx
    .select({
      id: requests.id,
      status: requests.status,
      description: requests.description,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .where(and(eq(requests.occurrenceId, row.occurrenceId), ne(requests.status, 'cancelled')))
    .orderBy(asc(requests.createdAt), asc(requests.id));

  const photoRows =
    reports.length === 0
      ? []
      : await tx
          .select({ storageKey: photos.storageKey, createdAt: photos.createdAt })
          .from(photos)
          .where(
            and(
              inArray(
                photos.requestId,
                reports.map((report) => report.id),
              ),
              inArray(photos.purpose, ['report', 'contest']),
            ),
          )
          .orderBy(asc(photos.createdAt), asc(photos.id));

  const assigned = await lastEventTo(tx, row.id, 'assigned');

  let rework: AgentWorkOrderDetail['rework'] = null;
  if (row.status === 'rework_requested') {
    const event = await lastEventTo(tx, row.id, 'rework_requested');
    if (event) {
      const details = reworkDetailsSchema.safeParse(event.details);
      rework = {
        reasons: details.success ? details.data.reasons : [],
        message: event.comment ?? '',
        byName: event.actorName,
        departmentName: event.actorName ? row.departmentName : null,
        at: event.at.toISOString(),
      };
    }
  }

  return {
    ...toCard(row),
    managerInstructions: row.managerInstructions,
    assignedBy: assigned?.actorName
      ? { name: assigned.actorName, departmentName: row.departmentName }
      : null,
    reports: reports.map((report) => ({
      description: report.description,
      createdAt: report.createdAt.toISOString(),
    })),
    photos: await Promise.all(
      photoRows.map(async (photo) => ({
        url: await storage.presignGet(photo.storageKey, PHOTO_URL_SECONDS),
        takenAt: photo.createdAt.toISOString(),
      })),
    ),
    citizenCount: reports.filter((report) => !FINAL_REQUEST_STATUSES.includes(report.status))
      .length,
    rework,
    previousNote: row.agentNote,
  };
}

/** Lista e detalhe das atividades do agente. */
export function registerAgentWorkOrderRoutes(
  instance: FastifyInstance,
  { db, storage }: AgentDeps,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/agent/work-orders',
    {
      preHandler: requireAuth(['app']),
      schema: {
        response: {
          200: z.array(agentWorkOrderCardSchema),
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(db, request, reply, ['field_agent']);
      if (!identity) return reply;
      const rows = await withContext(db, identity, (tx) => selectCards(tx, identity.userId));
      return rows.map(toCard);
    },
  );

  app.get(
    '/agent/work-orders/:id',
    {
      preHandler: requireAuth(['app']),
      schema: {
        params: idParams,
        response: {
          200: agentWorkOrderDetailSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(db, request, reply, ['field_agent']);
      if (!identity) return reply;
      if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });
      const detail = await withContext(db, identity, (tx) =>
        loadDetail(tx, storage, identity.userId, request.params.id),
      );
      if (!detail) return reply.code(404).send({ code: 'work_order_not_found' });
      return detail;
    },
  );
}
