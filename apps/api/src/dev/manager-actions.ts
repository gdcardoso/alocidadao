import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  apiErrorSchema,
  applyWorkOrderAction,
  devManagerActionBodySchema,
  workOrderStatusSchema,
  type DevManagerActionBody,
  type ReworkDetails,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';

const { workOrders, statusEvents, photos, memberships } = schema;

const idParams = z.object({ id: z.uuid() });

const resultSchema = z.object({ workOrderId: z.uuid(), status: workOrderStatusSchema });
const conflictSchema = apiErrorSchema.extend({ status: workOrderStatusSchema.optional() });

type Outcome =
  | { kind: 'ok'; status: WorkOrderStatus }
  | { kind: 'not_found' }
  | { kind: 'manager_not_found' }
  | { kind: 'photo_not_found' }
  | { kind: 'unavailable'; status: WorkOrderStatus };

/** Gestor que assina a simulação: o primeiro vínculo `manager` ativo da prefeitura. */
async function findManager(tx: Transaction, tenantId: string) {
  const [manager] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, 'manager'),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1);
  return manager?.userId;
}

async function applyManagerAction(
  tx: Transaction,
  tenantId: string,
  workOrderId: string,
  body: DevManagerActionBody,
): Promise<Outcome> {
  // Trava a atividade: decisões concorrentes sobre ela são serializadas.
  const [order] = await tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .for('update');
  if (!order) return { kind: 'not_found' };

  const managerId = await findManager(tx, tenantId);
  if (!managerId) return { kind: 'manager_not_found' };

  const transition = applyWorkOrderAction(order.status, body.action, 'manager');
  if (!transition.ok) return { kind: 'unavailable', status: order.status };
  const target = transition.to;
  const event = {
    tenantId,
    occurrenceId: order.occurrenceId,
    workOrderId: order.id,
    fromStatus: order.status,
    toStatus: target,
    actorUserId: managerId,
  };

  if (body.action === 'request_rework') {
    const ids = [...new Set(body.discardedPhotoIds)];
    if (ids.length > 0) {
      // Só fotos de conclusão desta atividade podem ser descartadas.
      const found = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(
          and(
            inArray(photos.id, ids),
            eq(photos.workOrderId, order.id),
            eq(photos.purpose, 'completion'),
          ),
        );
      if (found.length !== ids.length) return { kind: 'photo_not_found' };
      await tx.update(photos).set({ review: 'discarded' }).where(inArray(photos.id, ids));
    }
    await tx
      .update(workOrders)
      .set({ status: target, updatedAt: new Date() })
      .where(eq(workOrders.id, order.id));
    const details: ReworkDetails = { reasons: body.reasons, discardedPhotoIds: ids };
    await tx.insert(statusEvents).values({ ...event, comment: body.message, details });
  } else {
    await tx
      .update(workOrders)
      .set({
        status: target,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, order.id));
    await tx
      .insert(statusEvents)
      .values({ ...event, comment: 'Reagendada pelo gestor (simulação)' });
  }
  return { kind: 'ok', status: target };
}

/**
 * Simula as decisões do gestor sobre a atividade (o painel real vem no Plano 5): pedir ajuste
 * e reagendar. Quem chama é o agente da demo; quem assina é o gestor da prefeitura.
 */
export function registerDevManagerActions(
  instance: FastifyInstance,
  database: Database | undefined,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/dev/work-orders/:id/manager',
    {
      preHandler: requireAuth(['app']),
      schema: {
        params: idParams,
        body: devManagerActionBodySchema,
        response: {
          200: resultSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: conflictSchema,
          422: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(database, request, reply, ['field_agent']);
      if (!identity) return reply;
      const { id } = request.params;

      const outcome = await withContext(database, identity, (tx) =>
        applyManagerAction(tx, identity.tenantId, id, request.body),
      );
      switch (outcome.kind) {
        case 'ok':
          return { workOrderId: id, status: outcome.status };
        case 'not_found':
          return reply.code(404).send({ code: 'work_order_not_found' });
        case 'manager_not_found':
          return reply.code(409).send({ code: 'manager_not_found' });
        case 'photo_not_found':
          return reply.code(422).send({ code: 'photo_not_found' });
        case 'unavailable':
          return reply.code(409).send({ code: 'work_order_unavailable', status: outcome.status });
      }
    },
  );
}
