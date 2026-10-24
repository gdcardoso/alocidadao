import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  PHOTO_MAX_BYTES,
  apiErrorSchema,
  applyWorkOrderAction,
  distanceMeters,
  workOrderActionInputSchema,
  workOrderActionResultSchema,
  workOrderStatusSchema,
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
import { PHOTO_KEY_CONSTRAINT, isUniqueViolation, violatedConstraint } from '../db-errors.js';
import type { Storage } from '../storage/s3.js';
import type { AgentDeps } from './routes.js';

const { workOrders, occurrences, teamMembers, statusEvents, clientActions, photos } = schema;

/** Quem age: o agente da sessão e a prefeitura conferida pelo vínculo. */
interface AgentIdentity {
  userId: string;
  tenantId: string;
}

const idParams = z.object({ id: z.uuid() });

/** 409 da atividade indisponível traz o status atual. */
const conflictSchema = apiErrorSchema.extend({ status: workOrderStatusSchema.optional() });
/** 422 da foto inválida traz a chave recusada. */
const photoInvalidSchema = apiErrorSchema.extend({ key: z.string().optional() });

type Outcome =
  | { kind: 'ok'; result: WorkOrderActionResult }
  | { kind: 'not_found' }
  | { kind: 'client_action_conflict' }
  | { kind: 'photo_already_used' }
  | { kind: 'unavailable'; status: WorkOrderStatus }
  | { kind: 'photo_invalid'; key: string }
  | { kind: 'storage_not_configured' };

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

/** Primeira chave inválida: fora do prefixo da prefeitura, ausente, grande demais ou não JPEG. */
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
  identity: AgentIdentity,
  workOrderId: string,
  input: WorkOrderActionInput,
): Promise<Outcome> {
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
    if (!storage) return { kind: 'storage_not_configured' };
    const bad = await checkPhotos(storage, tenantId, input.photoKeys);
    if (bad !== undefined) return { kind: 'photo_invalid', key: bad };
  }

  return withContext(db, { tenantId, userId }, async (tx): Promise<Outcome> => {
    // Trava a atividade: ações concorrentes sobre ela são serializadas.
    const [order] = await tx
      .select({
        id: workOrders.id,
        status: workOrders.status,
        teamId: workOrders.teamId,
        occurrenceId: workOrders.occurrenceId,
        location: occurrences.location,
      })
      .from(workOrders)
      .innerJoin(occurrences, eq(occurrences.id, workOrders.occurrenceId))
      .where(eq(workOrders.id, workOrderId))
      .for('update', { of: workOrders });
    if (!order) return { kind: 'not_found' };

    const [member] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, order.teamId), eq(teamMembers.userId, userId)));
    if (!member) return { kind: 'not_found' };

    // Depois da trava, a leitura enxerga o que a ação concorrente já gravou.
    const stored = await findStoredAction(tx, input, order.id, userId);
    if (stored) return stored;

    const transition = applyWorkOrderAction(order.status, input.action, 'field_agent');
    if (!transition.ok) return { kind: 'unavailable', status: order.status };
    const target = transition.to;

    const isComplete = input.action === 'complete';
    const isImpediment = input.action === 'report_impediment';
    await tx
      .update(workOrders)
      .set({
        status: target,
        updatedAt: new Date(),
        ...(isComplete
          ? { agentNote: input.note ?? null, completedAt: new Date(input.occurredAt) }
          : {}),
        ...(isImpediment ? { impedimentReason: input.impedimentReason ?? null } : {}),
      })
      .where(eq(workOrders.id, order.id));
    if (input.photoKeys.length > 0) {
      // As fotos da atividade só chegam ao cidadão depois da revisão do gestor.
      await tx.insert(photos).values(
        input.photoKeys.map((storageKey) => ({
          tenantId,
          workOrderId: order.id,
          storageKey,
          uploadedBy: userId,
          review: 'pending' as const,
          purpose: isImpediment ? ('impediment' as const) : ('completion' as const),
        })),
      );
    }
    // geometry em modo xy: x = longitude, y = latitude.
    const site = { lat: order.location.y, lng: order.location.x };
    const distanceM = input.location ? Math.round(distanceMeters(input.location, site)) : null;
    await tx.insert(statusEvents).values({
      tenantId,
      occurrenceId: order.occurrenceId,
      workOrderId: order.id,
      fromStatus: order.status,
      toStatus: target,
      actorUserId: userId,
      comment: input.note ?? null,
      connection: input.connection,
      details: {
        ...(isImpediment ? { reason: input.impedimentReason } : {}),
        location: input.location,
        distanceM,
      },
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
    return { kind: 'ok', result };
  });
}

/** Releitura depois de uma violação de unicidade: outro envio gravou primeiro? */
async function afterUniqueViolation(
  db: Database,
  identity: AgentIdentity,
  workOrderId: string,
  input: WorkOrderActionInput,
  error: unknown,
): Promise<Outcome> {
  // Outra requisição com o mesmo clientActionId gravou primeiro: devolve a resposta dela.
  const stored = await withContext(db, identity, (tx) =>
    findStoredAction(tx, input, workOrderId, identity.userId),
  );
  if (stored) return stored;
  if (violatedConstraint(error) === PHOTO_KEY_CONSTRAINT) return { kind: 'photo_already_used' };
  // O id já foi usado em outra prefeitura (invisível aqui): conflito.
  return { kind: 'client_action_conflict' };
}

/** Iniciar, concluir e relatar impedimento, online ou vindos da fila offline. */
export function registerAgentActionRoutes(instance: FastifyInstance, { db, storage }: AgentDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/agent/work-orders/:id/actions',
    {
      preHandler: requireAuth(['app']),
      schema: {
        params: idParams,
        body: workOrderActionInputSchema,
        response: {
          200: workOrderActionResultSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: conflictSchema,
          422: photoInvalidSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.code(503).send({ code: 'database_not_configured' });
      const identity = await requireTenantMember(db, request, reply, ['field_agent']);
      if (!identity) return reply;
      const { id } = request.params;
      const input = request.body;

      let outcome: Outcome;
      try {
        outcome = await applyAction(db, storage, identity, id, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        outcome = await afterUniqueViolation(db, identity, id, input, error);
      }

      switch (outcome.kind) {
        case 'ok':
          return outcome.result;
        case 'not_found':
          return reply.code(404).send({ code: 'work_order_not_found' });
        case 'client_action_conflict':
          return reply.code(409).send({ code: 'client_action_conflict' });
        case 'photo_already_used':
          return reply.code(409).send({ code: 'photo_already_used' });
        case 'unavailable':
          return reply.code(409).send({ code: 'work_order_unavailable', status: outcome.status });
        case 'photo_invalid':
          return reply.code(422).send({ code: 'photo_invalid', key: outcome.key });
        case 'storage_not_configured':
          return reply.code(503).send({ code: 'storage_not_configured' });
      }
    },
  );
}
