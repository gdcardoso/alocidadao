import { schema, type Database, type Transaction } from '@alocidadao/db';
import {
  applyWorkOrderAction,
  type PublishBody,
  type RescheduleBody,
  type ReworkBody,
  type ReworkDetails,
  type WorkOrderAction,
  type WorkOrderResult,
} from '@alocidadao/shared';
import { and, eq, inArray } from 'drizzle-orm';
import {
  dueAtFor,
  lockOccurrence,
  moveOccurrence,
  moveRequests,
  run,
  unprocessable,
  type Result,
} from './actions.js';
import type { PanelIdentity } from './member.js';
import { todayInSaoPaulo } from './occurrences.js';
import { findScopedWorkOrder, type ScopedWorkOrder } from './work-orders.js';

const { photos, statusEvents, workOrders } = schema;

const NOT_FOUND = { error: { status: 404, code: 'work_order_not_found' } } as const;
const unavailable = (order: Pick<ScopedWorkOrder, 'status'>) =>
  ({
    error: { status: 409, code: 'work_order_unavailable', workOrderStatus: order.status },
  }) as const;

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-10-23` vira `23 out`. */
const shortDate = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** Muda a atividade pela máquina de estados (ator: o papel do painel), com o evento dela. */
async function moveWorkOrder(
  tx: Transaction,
  identity: PanelIdentity,
  order: Pick<ScopedWorkOrder, 'id' | 'status' | 'occurrenceId'>,
  action: WorkOrderAction,
  extra: {
    set?: Partial<typeof workOrders.$inferInsert>;
    comment?: string;
    details?: Record<string, unknown>;
  } = {},
) {
  const transition = applyWorkOrderAction(order.status, action, identity.role);
  if (!transition.ok) return false;
  await tx
    .update(workOrders)
    .set({ ...extra.set, status: transition.to, updatedAt: new Date() })
    .where(eq(workOrders.id, order.id));
  await tx.insert(statusEvents).values({
    tenantId: identity.tenantId,
    occurrenceId: order.occurrenceId,
    workOrderId: order.id,
    fromStatus: order.status,
    toStatus: transition.to,
    actorUserId: identity.userId,
    comment: extra.comment,
    details: extra.details,
  });
  return true;
}

/** Fotos de conclusão da atividade entre os ids dados (só as pendentes, com `pendingOnly`). */
async function countCompletionPhotos(
  tx: Transaction,
  workOrderId: string,
  ids: string[],
  pendingOnly: boolean,
) {
  if (ids.length === 0) return 0;
  const found = await tx
    .select({ id: photos.id })
    .from(photos)
    .where(
      and(
        inArray(photos.id, ids),
        eq(photos.workOrderId, workOrderId),
        eq(photos.purpose, 'completion'),
        pendingOnly ? eq(photos.review, 'pending') : undefined,
      ),
    );
  return found.length;
}

/**
 * Publica a revisão: as fotos marcadas viram `published` e as demais pendentes, `discarded`;
 * a atividade vai a `completed` com o texto público; a ocorrência e as solicitações em
 * atendimento vão a "aguardando confirmação". Trava a ocorrência antes da atividade (a mesma
 * ordem da recusa), para não haver impasse entre as duas.
 */
export function publishWorkOrder(
  db: Database,
  identity: PanelIdentity,
  id: string,
  body: PublishBody,
): Promise<Result<WorkOrderResult>> {
  return run(db, identity, async (tx) => {
    const seen = await findScopedWorkOrder(tx, identity, id);
    if (!seen) return NOT_FOUND;
    const occurrence = await lockOccurrence(tx, identity, seen.occurrenceId);
    const order = await findScopedWorkOrder(tx, identity, id, { lock: true });
    if (!order || !occurrence) return NOT_FOUND;
    if (!applyWorkOrderAction(order.status, 'publish', identity.role).ok) {
      return unavailable(order);
    }

    const ids = [...new Set(body.publishedPhotoIds)];
    if ((await countCompletionPhotos(tx, order.id, ids, true)) !== ids.length) {
      return unprocessable('photo_not_found');
    }
    if (ids.length > 0) {
      await tx.update(photos).set({ review: 'published' }).where(inArray(photos.id, ids));
    }
    await tx
      .update(photos)
      .set({ review: 'discarded' })
      .where(
        and(
          eq(photos.workOrderId, order.id),
          eq(photos.purpose, 'completion'),
          eq(photos.review, 'pending'),
        ),
      );

    const now = new Date();
    const moved = await moveWorkOrder(tx, identity, order, 'publish', {
      set: { publicNote: body.publicNote, publishedAt: now },
    });
    if (!moved) return unavailable(order);
    await moveOccurrence(tx, identity, occurrence, 'publish');
    await moveRequests(tx, identity, order.occurrenceId, 'publish');
    return { ok: { workOrderId: order.id, status: 'completed' as const } };
  });
}

/**
 * Devolve ao agente, dentro da transação do chamador (que já está no contexto da prefeitura):
 * as fotos marcadas viram `discarded`, a atividade vai a `rework_requested` e o evento leva a
 * mensagem no comentário e os motivos e as fotos descartadas em `details`.
 */
export async function requestReworkInTx(
  tx: Transaction,
  identity: PanelIdentity,
  id: string,
  body: ReworkBody,
): Promise<Result<WorkOrderResult>> {
  const order = await findScopedWorkOrder(tx, identity, id, { lock: true });
  if (!order) return NOT_FOUND;
  if (!applyWorkOrderAction(order.status, 'request_rework', identity.role).ok) {
    return unavailable(order);
  }
  const ids = [...new Set(body.discardedPhotoIds)];
  // Só fotos de conclusão desta atividade podem ser descartadas.
  if ((await countCompletionPhotos(tx, order.id, ids, false)) !== ids.length) {
    return unprocessable('photo_not_found');
  }
  if (ids.length > 0) {
    await tx.update(photos).set({ review: 'discarded' }).where(inArray(photos.id, ids));
  }
  const details: ReworkDetails = { reasons: body.reasons, discardedPhotoIds: ids };
  await moveWorkOrder(tx, identity, order, 'request_rework', { comment: body.message, details });
  return { ok: { workOrderId: order.id, status: 'rework_requested' as const } };
}

export function requestRework(
  db: Database,
  identity: PanelIdentity,
  id: string,
  body: ReworkBody,
): Promise<Result<WorkOrderResult>> {
  return run(db, identity, (tx) => requestReworkInTx(tx, identity, id, body));
}

/**
 * Reagenda a atividade impedida, dentro da transação do chamador: volta a `assigned` com o
 * prazo novo (`null` limpa o prazo) e o comentário no evento.
 */
export async function rescheduleInTx(
  tx: Transaction,
  identity: PanelIdentity,
  id: string,
  input: { dueAt: Date | null; comment: string },
): Promise<Result<WorkOrderResult>> {
  const order = await findScopedWorkOrder(tx, identity, id, { lock: true });
  if (!order) return NOT_FOUND;
  const moved = await moveWorkOrder(tx, identity, order, 'reschedule', {
    set: { dueAt: input.dueAt },
    comment: input.comment,
  });
  if (!moved) return unavailable(order);
  return { ok: { workOrderId: order.id, status: 'assigned' as const } };
}

/** Reagenda a atividade impedida para o fim do dia escolhido (data não pode ser passada). */
export function rescheduleWorkOrder(
  db: Database,
  identity: PanelIdentity,
  id: string,
  body: RescheduleBody,
): Promise<Result<WorkOrderResult>> {
  return run(db, identity, async (tx) => {
    const order = await findScopedWorkOrder(tx, identity, id);
    if (!order) return NOT_FOUND;
    if (!applyWorkOrderAction(order.status, 'reschedule', identity.role).ok) {
      return unavailable(order);
    }
    if (body.dueDate < todayInSaoPaulo()) return unprocessable('due_date_in_past');
    return rescheduleInTx(tx, identity, id, {
      dueAt: dueAtFor(body.dueDate),
      comment: `Reagendada para ${shortDate(body.dueDate)}`,
    });
  });
}
