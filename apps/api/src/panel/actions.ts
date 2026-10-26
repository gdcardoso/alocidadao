import {
  geoPoint,
  sortedPair,
  schema,
  withContext,
  type Database,
  type Transaction,
} from '@alocidadao/db';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  applyOccurrenceAction,
  applyRequestAction,
  applyWorkOrderAction,
  type AssignBody,
  type AssignResponse,
  type MergeResponse,
  type OccurrenceAction,
  type RequestAction,
  type SplitResponse,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PanelIdentity } from './member.js';
import { findScopedOccurrence, todayInSaoPaulo, type ScopedOccurrence } from './occurrences.js';

const { occurrences, occurrenceSeparations, requests, statusEvents, teams, workOrders } = schema;

/** Recusa de uma ação do painel: o status HTTP e o código do corpo `{ code }`. */
export type ActionError = {
  error:
    | { status: 404; code: 'occurrence_not_found' | 'work_order_not_found' }
    | { status: 409; code: 'occurrence_unavailable' | 'both_have_work_orders' }
    | {
        status: 409;
        code: 'work_order_unavailable';
        /** Status atual da atividade (a rota de desenvolvimento o devolve ao agente). */
        workOrderStatus: WorkOrderStatus;
      }
    | {
        status: 422;
        code:
          | 'photo_not_found'
          | 'team_not_eligible'
          | 'same_team'
          | 'due_date_in_past'
          | 'category_mismatch'
          | 'same_occurrence'
          | 'split_invalid';
      };
};

export type Result<T> = { ok: T } | ActionError;

const NOT_FOUND = { error: { status: 404, code: 'occurrence_not_found' } } as const;
const UNAVAILABLE = { error: { status: 409, code: 'occurrence_unavailable' } } as const;
export const unprocessable = (code: Extract<ActionError['error'], { status: 422 }>['code']) =>
  ({ error: { status: 422, code } }) as const;

/** Prazo da atividade: o fim do dia escolhido no horário de Brasília. */
export const dueAtFor = (date: string) => new Date(`${date}T23:59:59-03:00`);

/** Roda a ação no contexto da prefeitura, numa transação só. */
export function run<T>(db: Database, identity: PanelIdentity, fn: (tx: Transaction) => Promise<T>) {
  const { tenantId, userId } = identity;
  return withContext(db, { tenantId, userId }, fn);
}

/** Trava a ocorrência no alcance (inclusive a juntada, que responde 409 e não 404). */
export const lockOccurrence = (tx: Transaction, identity: PanelIdentity, id: string) =>
  findScopedOccurrence(tx, identity, id, { lock: true, includeMerged: true });

/** Mesmo UUID, sem diferenciar maiúsculas (o Postgres também não diferencia). */
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Atividade ativa da ocorrência; ler só depois de travar a ocorrência. */
async function findActiveWorkOrder(tx: Transaction, occurrenceId: string) {
  const [row] = await tx
    .select({ id: workOrders.id, status: workOrders.status })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.occurrenceId, occurrenceId),
        inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Muda o status da ocorrência pela máquina de estados, com o evento da própria ocorrência
 * (sem solicitação nem atividade). Devolve false quando a transição não vale.
 */
export async function moveOccurrence(
  tx: Transaction,
  identity: PanelIdentity,
  occurrence: Pick<ScopedOccurrence, 'id' | 'status'>,
  action: OccurrenceAction,
  extra: {
    set?: Partial<typeof occurrences.$inferInsert>;
    comment?: string;
    details?: Record<string, unknown>;
  } = {},
) {
  const transition = applyOccurrenceAction(occurrence.status, action, identity.role);
  if (!transition.ok) return false;
  await tx
    .update(occurrences)
    .set({ ...extra.set, status: transition.to, updatedAt: new Date() })
    .where(eq(occurrences.id, occurrence.id));
  await tx.insert(statusEvents).values({
    tenantId: identity.tenantId,
    occurrenceId: occurrence.id,
    fromStatus: occurrence.status,
    toStatus: transition.to,
    actorUserId: identity.userId,
    comment: extra.comment,
    details: extra.details,
  });
  return true;
}

/**
 * Aplica a ação a cada solicitação da ocorrência em que ela vale (as demais ficam como estão),
 * com um evento por solicitação.
 */
export async function moveRequests(
  tx: Transaction,
  identity: PanelIdentity,
  occurrenceId: string,
  action: RequestAction,
  comment?: string,
) {
  const rows = await tx
    .select({ id: requests.id, status: requests.status })
    .from(requests)
    .where(eq(requests.occurrenceId, occurrenceId))
    .orderBy(asc(requests.createdAt), asc(requests.id))
    .for('update');
  const now = new Date();
  for (const row of rows) {
    const transition = applyRequestAction(row.status, action, identity.role);
    if (!transition.ok) continue;
    await tx
      .update(requests)
      .set({ status: transition.to, statusChangedAt: now, updatedAt: now })
      .where(eq(requests.id, row.id));
    await tx.insert(statusEvents).values({
      tenantId: identity.tenantId,
      occurrenceId,
      requestId: row.id,
      fromStatus: row.status,
      toStatus: transition.to,
      actorUserId: identity.userId,
      comment,
    });
  }
}

/** Equipe da prefeitura que pertence ao setor da categoria; undefined se não for elegível. */
export async function findEligibleTeam(
  tx: Transaction,
  identity: PanelIdentity,
  teamId: string,
  departmentId: string,
) {
  const [team] = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(
      and(
        eq(teams.tenantId, identity.tenantId),
        eq(teams.id, teamId),
        eq(teams.departmentId, departmentId),
      ),
    );
  return team;
}

/**
 * Atribui a ocorrência em triagem a uma equipe do setor da categoria: cria a atividade e leva
 * a ocorrência e as solicitações abertas para "em atendimento".
 */
export function assignOccurrence(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
  body: AssignBody,
): Promise<Result<AssignResponse>> {
  return run(db, identity, async (tx) => {
    const occurrence = await lockOccurrence(tx, identity, occurrenceId);
    if (!occurrence) return NOT_FOUND;
    if (
      !applyOccurrenceAction(occurrence.status, 'assign', identity.role).ok ||
      (await findActiveWorkOrder(tx, occurrence.id))
    ) {
      return UNAVAILABLE;
    }

    const team = await findEligibleTeam(
      tx,
      identity,
      body.teamId,
      occurrence.category.departmentId,
    );
    if (!team) return unprocessable('team_not_eligible');
    if (body.dueDate < todayInSaoPaulo()) return unprocessable('due_date_in_past');

    const [order] = await tx
      .insert(workOrders)
      .values({
        tenantId: identity.tenantId,
        occurrenceId: occurrence.id,
        teamId: team.id,
        status: 'assigned',
        dueAt: dueAtFor(body.dueDate),
        managerInstructions: body.instructions,
      })
      .returning({ id: workOrders.id, status: workOrders.status });
    await tx.insert(statusEvents).values({
      tenantId: identity.tenantId,
      occurrenceId: occurrence.id,
      workOrderId: order!.id,
      toStatus: order!.status,
      actorUserId: identity.userId,
    });
    await moveOccurrence(tx, identity, occurrence, 'assign');
    await moveRequests(tx, identity, occurrence.id, 'assign');
    return { ok: { occurrenceId: occurrence.id, workOrderId: order!.id } };
  });
}

/**
 * Recusa a ocorrência (triagem ou em atendimento): grava o motivo público, recusa toda
 * solicitação não final e cancela a atividade ativa, com o motivo no comentário dos eventos.
 */
export function rejectOccurrence(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
  reason: string,
): Promise<Result<null>> {
  return run(db, identity, async (tx) => {
    const occurrence = await lockOccurrence(tx, identity, occurrenceId);
    if (!occurrence) return NOT_FOUND;
    const moved = await moveOccurrence(tx, identity, occurrence, 'reject', {
      set: { rejectionReason: reason },
      comment: reason,
    });
    if (!moved) return UNAVAILABLE;

    const order = await findActiveWorkOrder(tx, occurrence.id);
    if (order) {
      const transition = applyWorkOrderAction(order.status, 'cancel', identity.role);
      if (transition.ok) {
        await tx
          .update(workOrders)
          .set({ status: transition.to, updatedAt: new Date() })
          .where(eq(workOrders.id, order.id));
        await tx.insert(statusEvents).values({
          tenantId: identity.tenantId,
          occurrenceId: occurrence.id,
          workOrderId: order.id,
          fromStatus: order.status,
          toStatus: transition.to,
          actorUserId: identity.userId,
          comment: reason,
        });
      }
    }
    await moveRequests(tx, identity, occurrence.id, 'reject', reason);
    return { ok: null };
  });
}

/** Trava as duas ocorrências em ordem de id (evita impasse entre junções cruzadas). */
async function lockPair(tx: Transaction, identity: PanelIdentity, idA: string, idB: string) {
  // Em minúsculas, a ordem de travamento é a mesma qualquer que seja a caixa do parâmetro.
  const [a, b] = [idA.toLowerCase(), idB.toLowerCase()];
  const [low, high] = sortedPair(a, b);
  const first = await lockOccurrence(tx, identity, low);
  if (!first) return undefined;
  const second = await lockOccurrence(tx, identity, high);
  if (!second) return undefined;
  return low === a ? ([first, second] as const) : ([second, first] as const);
}

/**
 * Junta duas ocorrências da mesma categoria. Fica a que tem atividade ativa; sem atividade em
 * nenhuma, a ocorrência aberta no painel (`occurrenceId`). A outra vira `merged` e todas as
 * solicitações dela passam para a que ficou; as abertas levadas a uma ocorrência em
 * atendimento passam a "em atendimento".
 */
export function mergeOccurrences(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
  otherOccurrenceId: string,
): Promise<Result<MergeResponse>> {
  if (sameId(occurrenceId, otherOccurrenceId)) {
    return Promise.resolve(unprocessable('same_occurrence'));
  }
  return run(db, identity, async (tx) => {
    const pair = await lockPair(tx, identity, occurrenceId, otherOccurrenceId);
    if (!pair) return NOT_FOUND;
    const [opened, other] = pair;
    // Compara os ids canônicos das linhas (o parâmetro pode vir em outra caixa).
    if (opened.id === other.id) return unprocessable('same_occurrence');
    if (opened.categoryId !== other.categoryId) return unprocessable('category_mismatch');
    if (
      !applyOccurrenceAction(opened.status, 'merge', identity.role).ok ||
      !applyOccurrenceAction(other.status, 'merge', identity.role).ok
    ) {
      return UNAVAILABLE;
    }

    const openedOrder = await findActiveWorkOrder(tx, opened.id);
    const otherOrder = await findActiveWorkOrder(tx, other.id);
    if (openedOrder && otherOrder) {
      return { error: { status: 409, code: 'both_have_work_orders' } } as const;
    }
    const [survivor, absorbed] = otherOrder ? [other, opened] : [opened, other];

    await moveOccurrence(tx, identity, absorbed, 'merge', {
      set: { mergedIntoId: survivor.id },
      details: { mergedIntoId: survivor.id },
    });
    await tx
      .update(requests)
      .set({ occurrenceId: survivor.id, updatedAt: new Date() })
      .where(eq(requests.occurrenceId, absorbed.id));
    if (survivor.status === 'in_progress') {
      await moveRequests(tx, identity, survivor.id, 'assign');
    }
    return { ok: { survivorId: survivor.id } };
  });
}

/** "É outro problema": grava o par (menor id, maior id); repetir não muda nada. */
export function dismissSuggestion(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
  otherOccurrenceId: string,
): Promise<Result<null>> {
  if (sameId(occurrenceId, otherOccurrenceId)) {
    return Promise.resolve(unprocessable('same_occurrence'));
  }
  return run(db, identity, async (tx) => {
    const found = [];
    for (const id of [occurrenceId, otherOccurrenceId]) {
      const row = await findScopedOccurrence(tx, identity, id, { includeMerged: true });
      if (!row) return NOT_FOUND;
      found.push(row);
    }
    const [opened, other] = found as [ScopedOccurrence, ScopedOccurrence];
    // Juntada responde 409, como nas outras ações.
    if (opened.status === 'merged' || other.status === 'merged') return UNAVAILABLE;
    // Os ids das linhas são canônicos: o par respeita `a < b` mesmo com o parâmetro em maiúsculas.
    const [low, high] = sortedPair(opened.id, other.id);
    await tx
      .insert(occurrenceSeparations)
      .values({
        tenantId: identity.tenantId,
        occurrenceAId: low,
        occurrenceBId: high,
        createdBy: identity.userId,
      })
      .onConflictDoNothing();
    return { ok: null };
  });
}

/**
 * Separa as solicitações dadas (desta ocorrência em triagem, não canceladas) numa ocorrência
 * nova em triagem, da mesma categoria, no local da mais antiga delas. Sobra ao menos uma
 * solicitação não cancelada na original, e o par entra em `occurrence_separations`.
 */
export function splitOccurrence(
  db: Database,
  identity: PanelIdentity,
  occurrenceId: string,
  requestIds: string[],
): Promise<Result<SplitResponse>> {
  return run(db, identity, async (tx) => {
    const occurrence = await lockOccurrence(tx, identity, occurrenceId);
    if (!occurrence) return NOT_FOUND;
    if (occurrence.status !== 'triage') return UNAVAILABLE;

    const rows = await tx
      .select({ id: requests.id, status: requests.status, location: requests.location })
      .from(requests)
      .where(eq(requests.occurrenceId, occurrence.id))
      .orderBy(asc(requests.createdAt), asc(requests.id))
      .for('update');
    const ids = new Set(requestIds);
    const active = rows.filter((row) => row.status !== 'cancelled');
    const moving = active.filter((row) => ids.has(row.id));
    if (moving.length !== ids.size || moving.length === active.length) {
      return unprocessable('split_invalid');
    }

    const oldest = moving[0]!;
    const [created] = await tx
      .insert(occurrences)
      .values({
        tenantId: identity.tenantId,
        categoryId: occurrence.categoryId,
        location: geoPoint({ lat: oldest.location.y, lng: oldest.location.x }),
        status: 'triage',
      })
      .returning({ id: occurrences.id, status: occurrences.status });
    await tx.insert(statusEvents).values({
      tenantId: identity.tenantId,
      occurrenceId: created!.id,
      toStatus: created!.status,
      actorUserId: identity.userId,
      details: { splitFrom: occurrence.id },
    });
    await tx
      .update(requests)
      .set({ occurrenceId: created!.id, updatedAt: new Date() })
      .where(
        inArray(
          requests.id,
          moving.map((row) => row.id),
        ),
      );
    const [low, high] = sortedPair(occurrence.id, created!.id);
    await tx.insert(occurrenceSeparations).values({
      tenantId: identity.tenantId,
      occurrenceAId: low,
      occurrenceBId: high,
      createdBy: identity.userId,
    });
    return { ok: { newOccurrenceId: created!.id } };
  });
}
