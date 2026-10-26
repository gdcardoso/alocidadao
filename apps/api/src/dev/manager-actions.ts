import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  apiErrorSchema,
  devManagerActionBodySchema,
  workOrderStatusSchema,
  type DevManagerActionBody,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';
import type { PanelIdentity } from '../panel/member.js';
import { requestReworkInTx, rescheduleInTx } from '../panel/work-order-actions.js';

const { workOrders, memberships } = schema;

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
  const managerId = await findManager(tx, tenantId);
  // Gestor da simulação, sem alcance por setor (`departmentIds: null`).
  const identity: PanelIdentity = {
    userId: managerId ?? '',
    tenantId,
    role: 'manager',
    departmentIds: null,
    platformRole: null,
  };
  // A atividade é lida antes só para distinguir "não existe" de "sem gestor na prefeitura".
  const [order] = await tx
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId));
  if (!order) return { kind: 'not_found' };
  if (!managerId) return { kind: 'manager_not_found' };

  const result =
    body.action === 'request_rework'
      ? await requestReworkInTx(tx, identity, workOrderId, body)
      : await rescheduleInTx(tx, identity, workOrderId, {
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          comment: 'Reagendada pelo gestor (simulação)',
        });
  if ('ok' in result) return { kind: 'ok', status: result.ok.status };
  const { error } = result;
  if (error.code === 'work_order_not_found') return { kind: 'not_found' };
  if (error.code === 'work_order_unavailable') {
    return { kind: 'unavailable', status: error.workOrderStatus };
  }
  return { kind: 'photo_not_found' };
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
