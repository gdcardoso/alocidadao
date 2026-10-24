import { schema, withContext, type Database } from '@alocidadao/db';
import { applyWorkOrderAction } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';

const { workOrders, statusEvents } = schema;

const idParams = z.object({ id: z.uuid() });

export function registerDevWorkOrders(instance: FastifyInstance, database: Database | undefined) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  // Simula a reatribuição pelo gestor: cancela a atividade ainda ativa.
  app.post(
    '/dev/work-orders/:id/cancel',
    { preHandler: requireAuth(['app']), schema: { params: idParams } },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(database, request, reply, ['field_agent']);
      if (!identity) return reply;

      const outcome = await withContext(database, identity, async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, request.params.id))
          .for('update');
        if (!order) return { kind: 'not_found' as const };
        // Cancelar de novo devolve a mesma resposta, sem outro evento.
        if (order.status === 'cancelled') return { kind: 'ok' as const };
        const transition = applyWorkOrderAction(order.status, 'cancel', 'manager');
        if (!transition.ok) return { kind: 'unavailable' as const, status: order.status };
        await tx
          .update(workOrders)
          .set({ status: transition.to, updatedAt: new Date() })
          .where(eq(workOrders.id, order.id));
        await tx.insert(statusEvents).values({
          tenantId: identity.tenantId,
          occurrenceId: order.occurrenceId,
          workOrderId: order.id,
          fromStatus: order.status,
          toStatus: transition.to,
          actorUserId: identity.userId,
          comment: 'Reatribuída pelo gestor (simulação)',
        });
        return { kind: 'ok' as const };
      });

      if (outcome.kind === 'not_found')
        return reply.code(404).send({ code: 'work_order_not_found' });
      if (outcome.kind === 'unavailable') {
        return reply.code(409).send({ code: 'work_order_unavailable', status: outcome.status });
      }
      return { workOrderId: request.params.id, status: 'cancelled' as const };
    },
  );
}
