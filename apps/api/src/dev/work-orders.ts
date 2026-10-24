import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  PHOTO_MAX_BYTES,
  applyWorkOrderAction,
  workOrderActionInputSchema,
  workOrderActionResultSchema,
  type WorkOrderActionInput,
  type WorkOrderActionResult,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';
import { isUniqueViolation } from '../db-errors.js';
import type { Storage } from '../storage/s3.js';

const { workOrders, teamMembers, statusEvents, clientActions, photos } = schema;

/** Quem chama: a pessoa da sessão e a prefeitura conferida pelo vínculo. */
interface DevIdentity {
  userId: string;
  tenantId: string;
}

const idParams = z.object({ id: z.uuid() });

type Outcome =
  | { kind: 'ok'; result: WorkOrderActionResult }
  | { kind: 'not_found' }
  | { kind: 'client_action_conflict' }
  | { kind: 'unavailable'; status: WorkOrderStatus }
  | { kind: 'photo_invalid'; key: string };

/**
 * Procura a ação já gravada. Só vale como repetição se for da mesma pessoa, da mesma atividade
 * e do mesmo tipo; qualquer diferença é um conflito (o id foi reutilizado para outra coisa).
 */
async function findStoredAction(
  tx: Transaction,
  input: WorkOrderActionInput,
  workOrderId: string,
  userId: string,
) {
  const [stored] = await tx
    .select({
      response: clientActions.response,
      targetId: clientActions.targetId,
      kind: clientActions.kind,
      userId: clientActions.userId,
    })
    .from(clientActions)
    .where(eq(clientActions.id, input.clientActionId));
  if (!stored) return undefined;
  if (
    stored.targetId !== workOrderId ||
    stored.kind !== `work_order.${input.action}` ||
    stored.userId !== userId
  ) {
    return { kind: 'client_action_conflict' as const };
  }
  const parsed = workOrderActionResultSchema.parse(stored.response);
  return { kind: 'ok' as const, result: { ...parsed, duplicate: true } };
}

async function checkPhotos(storage: Storage, tenantId: string, keys: string[]) {
  for (const key of keys) {
    if (!key.startsWith(`${tenantId}/`)) return key;
    const head = await storage.head(key);
    if (!head || head.bytes > PHOTO_MAX_BYTES || head.contentType !== 'image/jpeg') return key;
  }
  return undefined;
}

async function applyAction(
  db: Database,
  storage: Storage | undefined,
  identity: DevIdentity,
  workOrderId: string,
  input: WorkOrderActionInput,
): Promise<Outcome | { kind: 'storage_not_configured' }> {
  const { tenantId, userId } = identity;

  // Repetição já gravada responde a resposta guardada antes de olhar o armazenamento: a foto
  // pode ter sumido do bucket depois, e a ação já valeu. Leitura sem trava; a corrida é
  // resolvida pela releitura dentro da transação.
  const replay = await withContext(db, { tenantId, userId }, (tx) =>
    findStoredAction(tx, input, workOrderId, userId),
  );
  if (replay) return replay;

  // As fotos são conferidas no armazenamento antes da transação: assim a chamada de rede
  // não acontece com a atividade travada. O status continua sendo checado lá dentro.
  if (input.photoKeys.length > 0) {
    if (!storage) return { kind: 'storage_not_configured' as const };
    const bad = await checkPhotos(storage, tenantId, input.photoKeys);
    if (bad !== undefined) return { kind: 'photo_invalid' as const, key: bad };
  }

  return withContext(db, { tenantId, userId }, async (tx) => {
    // Trava a atividade: ações concorrentes sobre ela são serializadas.
    const [order] = await tx
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update');
    if (!order) return { kind: 'not_found' as const };

    const [member] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, order.teamId), eq(teamMembers.userId, userId)));
    if (!member) return { kind: 'not_found' as const };

    // Depois da trava, a leitura enxerga o que a ação concorrente já gravou.
    const stored = await findStoredAction(tx, input, order.id, userId);
    if (stored) return stored;

    const transition = applyWorkOrderAction(order.status, input.action, 'field_agent');
    if (!transition.ok) return { kind: 'unavailable' as const, status: order.status };
    const target = transition.to;

    const isComplete = input.action === 'complete';
    await tx
      .update(workOrders)
      .set({
        status: target,
        updatedAt: new Date(),
        ...(isComplete
          ? { agentNote: input.note ?? null, completedAt: new Date(input.occurredAt) }
          : {}),
      })
      .where(eq(workOrders.id, order.id));
    if (isComplete) {
      // As fotos da atividade só chegam ao cidadão depois da revisão do gestor.
      await tx.insert(photos).values(
        input.photoKeys.map((storageKey) => ({
          tenantId,
          workOrderId: order.id,
          storageKey,
          uploadedBy: userId,
          review: 'pending' as const,
          purpose: 'completion' as const,
        })),
      );
    }
    await tx.insert(statusEvents).values({
      tenantId,
      occurrenceId: order.occurrenceId,
      workOrderId: order.id,
      fromStatus: order.status,
      toStatus: target,
      actorUserId: userId,
      comment: isComplete ? (input.note ?? null) : null,
      connection: input.connection,
    });
    const result: WorkOrderActionResult = {
      workOrderId: order.id,
      status: target,
      duplicate: false,
    };
    await tx.insert(clientActions).values({
      id: input.clientActionId,
      tenantId,
      userId,
      kind: `work_order.${input.action}`,
      targetId: order.id,
      response: result,
    });
    return { kind: 'ok' as const, result };
  });
}

export function registerDevWorkOrders(
  instance: FastifyInstance,
  database: Database | undefined,
  storage: Storage | undefined,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/dev/work-orders/:id/actions',
    {
      preHandler: requireAuth(['app']),
      schema: { params: idParams, body: workOrderActionInputSchema },
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(database, request, reply, ['field_agent']);
      if (!identity) return reply;
      const { id } = request.params;
      const input = request.body;

      let outcome: Awaited<ReturnType<typeof applyAction>>;
      try {
        outcome = await applyAction(database, storage, identity, id, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Outra requisição com o mesmo clientActionId gravou primeiro: devolve a resposta dela.
        // Se ela é de outra atividade/ação, ou de outra prefeitura (não visível aqui), é conflito.
        const stored = await withContext(database, identity, (tx) =>
          findStoredAction(tx, input, id, identity.userId),
        );
        outcome = stored ?? { kind: 'client_action_conflict' };
      }

      switch (outcome.kind) {
        case 'ok':
          return outcome.result;
        case 'not_found':
          return reply.code(404).send({ code: 'work_order_not_found' });
        case 'client_action_conflict':
          return reply.code(409).send({ code: 'client_action_conflict' });
        case 'unavailable':
          return reply.code(409).send({ code: 'work_order_unavailable', status: outcome.status });
        case 'photo_invalid':
          return reply.code(422).send({ code: 'photo_invalid', key: outcome.key });
        case 'storage_not_configured':
          return reply.code(503).send({ code: 'storage_not_configured' });
      }
    },
  );

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
