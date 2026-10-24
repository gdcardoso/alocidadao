import {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TRANSITIONS,
  distanceMeters,
  type AgentWorkOrderCard,
  type GeoPoint,
  type IconGroup,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import type { OutboxItem, WorkOrderAction, WorkOrderActionPayload } from '../offline/outbox';
import { formatAgoPrecise, formatDistance } from '../ui/format';
import type { ColorToken } from '../ui/theme';

// Modelo da lista do agente (A1), puro: cartões do cache + fila + atividades já abertas.

export interface AgentBadge {
  label: string;
  tone: { bg: ColorToken; fg: ColorToken };
}

export interface AgentCardView {
  id: string;
  tenantId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryGroup: IconGroup;
  address: string | null;
  /** `'350 m'` ou `'1,2 km'`; `null` sem a posição do aparelho. */
  distance: string | null;
  badge: AgentBadge;
  isNew: boolean;
  /** `'1 relato'` ou `'6 relatos'`. */
  reportsLabel: string;
  /** `'Chegou há 10 min'`, `'Iniciada agora'`, `'Aguardando envio'`… */
  timeLabel: string;
  location: GeoPoint;
  /** Status mostrado (o da fila, quando há envio dela à frente do servidor). */
  status: WorkOrderStatus;
  /** Há um envio desta atividade esperando na fila. */
  queued: boolean;
}

/** Envio do agente que o servidor não aplicou: aviso no topo da A1 com "Remover envio". */
export interface AgentQueueNotice {
  /** Id do item na fila (`removeOutboxItem` tira o item e as fotos dele). */
  itemId: string;
  workOrderId: string;
  text: string;
  actionLabel: 'Remover envio';
}

export interface AgentListInput {
  cards: readonly AgentWorkOrderCard[];
  queue: readonly OutboxItem[];
  /** Chaves `seenKey` das atividades abertas neste aparelho. */
  seen: ReadonlySet<string>;
  /** Posição do aparelho; `null` sem localização. */
  here: GeoPoint | null;
  now: Date;
}

export interface AgentList {
  summary: string;
  items: AgentCardView[];
  notices: AgentQueueNotice[];
}

/** Chave de "aberta": reagendar muda `assignedAt` e a atividade volta a ser nova. */
export const seenKey = (card: Pick<AgentWorkOrderCard, 'id' | 'assignedAt'>) =>
  `${card.id}:${card.assignedAt}`;

/** Statuses que pedem ação do agente; os outros são só de leitura. */
const ACTIONABLE: readonly WorkOrderStatus[] = ['assigned', 'in_execution', 'rework_requested'];

const ACTION_RESULT: Record<WorkOrderAction, WorkOrderStatus> = {
  start: 'in_execution',
  complete: 'awaiting_review',
  report_impediment: 'impeded',
};

const BADGE_TONES: Record<WorkOrderStatus, AgentBadge['tone']> = {
  assigned: { bg: 'border', fg: 'textSecondary' },
  in_execution: { bg: 'primarySoft', fg: 'primary' },
  rework_requested: { bg: 'warningSoft', fg: 'warning' },
  awaiting_review: { bg: 'successSoft', fg: 'success' },
  impeded: { bg: 'dangerSoft', fg: 'danger' },
  completed: { bg: 'border', fg: 'textSecondary' },
  cancelled: { bg: 'border', fg: 'textSecondary' },
};

const WAITING_SEND = 'Aguardando envio';
const QUEUED_STATUSES: readonly OutboxItem['status'][] = ['pending', 'sending'];
const NOT_APPLIED_STATUSES: readonly OutboxItem['status'][] = ['conflict', 'failed', 'rejected'];

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type ActionItem = OutboxItem & { payload: WorkOrderActionPayload };

/** Ações do agente na fila, da mais antiga para a mais nova. */
export function agentItems(queue: readonly OutboxItem[]): ActionItem[] {
  return (
    queue
      .filter((item): item is ActionItem => item.kind === 'work_order_action')
      // O Hermes não tem `toSorted`; o filter já é uma cópia.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => a.createdAt - b.createdAt)
  );
}

/** Status e hora da última mudança, contando a fila. */
export interface Effective {
  status: WorkOrderStatus;
  changedAt: string;
  queued: boolean;
}

/**
 * Envio na fila (pendente ou enviando) vale sobre o servidor. Envio já feito (`done`) só cobre
 * o intervalo até a próxima lista da prefeitura, que tira o item da fila: vale enquanto a
 * atividade está num status de onde a ação parte. Não se compara a hora do aparelho com a do
 * servidor (os relógios podem divergir).
 */
export function effectiveStatus(card: AgentWorkOrderCard, items: readonly ActionItem[]): Effective {
  let result: Effective = {
    status: card.status,
    changedAt: card.statusChangedAt,
    queued: false,
  };
  for (const item of items) {
    const { action, occurredAt } = item.payload;
    if (QUEUED_STATUSES.includes(item.status)) {
      result = { status: ACTION_RESULT[action], changedAt: occurredAt, queued: true };
    } else if (
      item.status === 'done' &&
      !result.queued &&
      (WORK_ORDER_TRANSITIONS[action].from as readonly WorkOrderStatus[]).includes(result.status)
    ) {
      result = { status: ACTION_RESULT[action], changedAt: occurredAt, queued: false };
    }
  }
  return result;
}

function timeLabel(card: AgentWorkOrderCard, effective: Effective, isNew: boolean, now: Date) {
  if (effective.queued) return WAITING_SEND;
  const since = (at: string) => formatAgoPrecise(at, now);
  switch (effective.status) {
    case 'assigned':
      return `${isNew ? 'Chegou' : 'Atribuída'} ${since(card.assignedAt)}`;
    case 'in_execution':
      return `Iniciada ${since(effective.changedAt)}`;
    case 'rework_requested':
      return `Devolvido ${since(effective.changedAt)}`;
    default:
      return `Enviada ${since(effective.changedAt)}`;
  }
}

interface Row {
  view: AgentCardView;
  card: AgentWorkOrderCard;
  meters: number | null;
  changedAt: number;
}

/** Prazo mais cedo primeiro (sem prazo no fim); empate: atribuída há mais tempo. */
function byDueDate(a: Row, b: Row): number {
  const dueA = a.card.dueAt === null ? Infinity : Date.parse(a.card.dueAt);
  const dueB = b.card.dueAt === null ? Infinity : Date.parse(b.card.dueAt);
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  return Date.parse(a.card.assignedAt) - Date.parse(b.card.assignedAt);
}

function byDistance(a: Row, b: Row): number {
  const diff = (a.meters ?? 0) - (b.meters ?? 0);
  return diff !== 0 ? diff : Date.parse(a.card.assignedAt) - Date.parse(b.card.assignedAt);
}

/** Texto do aviso: `{Categoria} · {endereço}`, do cache ou do que o item guardou. */
function noticeText(card: AgentWorkOrderCard | undefined, payload: WorkOrderActionPayload) {
  const categoryName = card?.categoryName ?? payload.display?.categoryName ?? 'Atividade';
  const address = card ? card.address : (payload.display?.address ?? null);
  const place = address ? `${categoryName} · ${address}` : categoryName;
  return `${place}: o gestor mudou esta atividade e seu envio não foi aplicado.`;
}

/**
 * Lista da A1: primeiro as que pedem ação (pela distância; sem posição, pelo prazo), depois as
 * só de leitura (a mudança mais recente primeiro). Envios do agente que o servidor não aplicou
 * (conflito, falha ou recusa) viram avisos.
 */
export function toAgentList({ cards, queue, seen, here, now }: AgentListInput): AgentList {
  const items = agentItems(queue);
  const byWorkOrder = new Map<string, ActionItem[]>();
  for (const item of items) {
    const list = byWorkOrder.get(item.payload.workOrderId) ?? [];
    list.push(item);
    byWorkOrder.set(item.payload.workOrderId, list);
  }

  const rows = cards.map((card): Row => {
    const effective = effectiveStatus(card, byWorkOrder.get(card.id) ?? []);
    const isNew = effective.status === 'assigned' && !seen.has(seenKey(card));
    const meters = here ? distanceMeters(here, card.location) : null;
    return {
      card,
      meters,
      changedAt: Date.parse(effective.changedAt),
      view: {
        id: card.id,
        tenantId: card.tenantId,
        categoryName: card.categoryName,
        categoryIcon: card.categoryIcon,
        categoryGroup: card.categoryGroup,
        address: card.address,
        distance: meters === null ? null : formatDistance(meters),
        badge: {
          label: WORK_ORDER_STATUS_LABELS[effective.status],
          tone: BADGE_TONES[effective.status],
        },
        isNew,
        reportsLabel: plural(card.reportCount, 'relato', 'relatos'),
        timeLabel: timeLabel(card, effective, isNew, now),
        location: card.location,
        status: effective.status,
        queued: effective.queued,
      },
    };
  });

  const actionable = rows.filter((row) => ACTIONABLE.includes(row.view.status));
  const readOnly = rows.filter((row) => !ACTIONABLE.includes(row.view.status));
  // oxlint-disable-next-line unicorn/no-array-sort -- filter já é uma cópia (Hermes sem toSorted)
  actionable.sort(here ? byDistance : byDueDate);
  // oxlint-disable-next-line unicorn/no-array-sort -- idem
  readOnly.sort((a, b) => b.changedAt - a.changedAt);

  const cardById = new Map(cards.map((card) => [card.id, card]));
  const notices = items
    .filter((item) => NOT_APPLIED_STATUSES.includes(item.status))
    .map((item): AgentQueueNotice => ({
      itemId: item.id,
      workOrderId: item.payload.workOrderId,
      text: noticeText(cardById.get(item.payload.workOrderId), item.payload),
      actionLabel: 'Remover envio',
    }));

  return {
    summary: `${plural(cards.length, 'atividade', 'atividades')} · ordenadas ${
      here ? 'pela distância' : 'pelo prazo'
    }`,
    items: [...actionable, ...readOnly].map((row) => row.view),
    notices,
  };
}

/** Faixa da A1 sem rede; online, a faixa some. */
export function offlineBanner(online: boolean, pendingCount: number): string | null {
  if (online) return null;
  if (pendingCount === 0) return 'Sem conexão';
  return `Sem conexão · ${plural(pendingCount, 'envio', 'envios')} aguardando sinal`;
}

/** Cabeçalho da A1: o nome da equipe quando é uma só; com várias, `{n} equipes`. */
export function teamHeader(cards: readonly AgentWorkOrderCard[]): string | null {
  const teams = new Map<string, string>();
  for (const card of cards) teams.set(`${card.tenantId}:${card.teamName}`, card.teamName);
  if (teams.size === 0) return null;
  if (teams.size === 1) return [...teams.values()][0]!;
  return `${teams.size} equipes`;
}

/** Envios que contam na faixa offline: os que ainda esperam na fila. */
export function pendingSendCount(queue: readonly OutboxItem[]): number {
  return queue.filter((item) => QUEUED_STATUSES.includes(item.status)).length;
}
