import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  PHOTO_MAX_BYTES,
  canTransitionWorkOrder,
  workOrderActionInputSchema,
  workOrderActionResultSchema,
  type WorkOrderActionInput,
  type WorkOrderActionResult,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Storage } from '../storage/s3.js';
import { requireDevIdentity, type DevIdentity } from './identity.js';

const { workOrders, requests, categories, teamMembers, statusEvents, clientActions } = schema;

const idParams = z.object({ id: z.uuid() });
const ACTIVE_STATUSES: WorkOrderStatus[] = ['assigned', 'in_execution'];

type Outcome =
  | { kind: 'ok'; result: WorkOrderActionResult }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; status: WorkOrderStatus }
  | { kind: 'photo_invalid'; key: string };

/** Drizzle embrulha o erro do Postgres em `cause`; procura o código nos dois níveis. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

async function findStoredResponse(tx: Transaction, clientActionId: string) {
  const [stored] = await tx
    .select({ response: clientActions.response })
    .from(clientActions)
    .where(eq(clientActions.id, clientActionId));
  if (!stored) return undefined;
  const parsed = workOrderActionResultSchema.parse(stored.response);
  return { ...parsed, duplicate: true };
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
    const stored = await findStoredResponse(tx, input.clientActionId);
    if (stored) return { kind: 'ok' as const, result: stored };

    const target: WorkOrderStatus = input.action === 'start' ? 'in_execution' : 'completed';
    if (!canTransitionWorkOrder(order.status, target)) {
      return { kind: 'unavailable' as const, status: order.status };
    }

    if (input.photoKeys.length > 0) {
      if (!storage) return { kind: 'storage_not_configured' as const };
      const bad = await checkPhotos(storage, tenantId, input.photoKeys);
      if (bad !== undefined) return { kind: 'photo_invalid' as const, key: bad };
    }

    const isComplete = input.action === 'complete';
    await tx
      .update(workOrders)
      .set({
        status: target,
        updatedAt: new Date(),
        ...(isComplete
          ? { completionNote: input.note ?? null, completedAt: new Date(input.occurredAt) }
          : {}),
      })
      .where(eq(workOrders.id, order.id));
    await tx.insert(statusEvents).values({
      tenantId,
      requestId: order.requestId,
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

  app.get('/dev/work-orders', async (request, reply) => {
    const identity = requireDevIdentity(request, reply);
    if (!identity) return reply;
    if (!database) return reply.code(503).send({ code: 'database_not_configured' });

    const rows = await withContext(database, identity, (tx) =>
      tx
        .select({
          id: workOrders.id,
          status: workOrders.status,
          protocol: requests.protocol,
          description: requests.description,
          categoryName: categories.name,
          address: requests.address,
          location: requests.location,
          dueAt: workOrders.dueAt,
        })
        .from(workOrders)
        .innerJoin(
          teamMembers,
          and(eq(teamMembers.teamId, workOrders.teamId), eq(teamMembers.userId, identity.userId)),
        )
        .innerJoin(requests, eq(requests.id, workOrders.requestId))
        .innerJoin(categories, eq(categories.id, requests.categoryId))
        .where(inArray(workOrders.status, ACTIVE_STATUSES))
        .orderBy(asc(workOrders.createdAt)),
    );
    // geometry em modo xy: x = longitude, y = latitude.
    return rows.map(({ location, dueAt, ...row }) => ({
      ...row,
      location: { lat: location.y, lng: location.x },
      dueAt: dueAt?.toISOString() ?? null,
    }));
  });

  app.post(
    '/dev/work-orders/:id/actions',
    { schema: { params: idParams, body: workOrderActionInputSchema } },
    async (request, reply) => {
      const identity = requireDevIdentity(request, reply);
      if (!identity) return reply;
      if (!database) return reply.code(503).send({ code: 'database_not_configured' });
      const { id } = request.params;
      const input = request.body;

      let outcome: Awaited<ReturnType<typeof applyAction>>;
      try {
        outcome = await applyAction(database, storage, identity, id, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Outra requisição com o mesmo clientActionId gravou primeiro: devolve a resposta dela.
        const stored = await withContext(database, identity, (tx) =>
          findStoredResponse(tx, input.clientActionId),
        );
        if (!stored) throw error;
        outcome = { kind: 'ok', result: stored };
      }

      switch (outcome.kind) {
        case 'ok':
          return outcome.result;
        case 'not_found':
          return reply.code(404).send({ code: 'work_order_not_found' });
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
    { schema: { params: idParams } },
    async (request, reply) => {
      const identity = requireDevIdentity(request, reply);
      if (!identity) return reply;
      if (!database) return reply.code(503).send({ code: 'database_not_configured' });

      const outcome = await withContext(database, identity, async (tx) => {
        const [order] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, request.params.id))
          .for('update');
        if (!order) return { kind: 'not_found' as const };
        if (!canTransitionWorkOrder(order.status, 'cancelled')) {
          return { kind: 'unavailable' as const, status: order.status };
        }
        await tx
          .update(workOrders)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(workOrders.id, order.id));
        await tx.insert(statusEvents).values({
          tenantId: identity.tenantId,
          requestId: order.requestId,
          workOrderId: order.id,
          fromStatus: order.status,
          toStatus: 'cancelled',
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
