import type { IconGroup, RequestCard } from '@alocidadao/shared';
import { CircleX, WifiOff } from 'lucide-react-native';
import { statusBadge, type StatusBadgeStyle } from '../ui/category';
import { formatShortDate } from '../ui/format';
import { colors } from '../ui/theme';

// Modelos dos cartões da tela 4, sem nada nativo (testável em Node).

export interface CardModel {
  key: string;
  title: string;
  address: string | null;
  icon: string | null;
  iconGroup: IconGroup;
  badge: StatusBadgeStyle;
  /** `'2026-000123 · Hoje, 08:12'`. */
  meta: string;
  /** Aguardando a confirmação do cidadão: borda `warning` 2 e botão de ação. */
  needsAction: boolean;
  href: string;
}

/** Detalhe da solicitação (Task 10). */
export const requestHref = (id: string) => `/(app)/solicitacao/${id}`;

export function toCardModel(card: RequestCard, now: Date = new Date()): CardModel {
  return {
    key: card.id,
    title: card.categoryName,
    address: card.address,
    icon: card.icon,
    iconGroup: card.iconGroup,
    badge: statusBadge(card.status),
    meta: `${card.protocol} · ${formatShortDate(card.createdAt, now)}`,
    needsAction: card.status === 'awaiting_confirmation',
    href: requestHref(card.id),
  };
}

/** Motivo de uma solicitação da fila recusada pela API (não há nova tentativa). */
export type QueuedRejection =
  | {
      code: 'municipality_not_served';
      municipality: { name: string; state: string } | null;
    }
  | { code: 'category_unavailable' };

/**
 * Solicitação ainda na fila offline, como a tela 4 precisa dela. A Task 9 monta este objeto
 * a partir do item `create_request` da fila (`rejection` vem do item recusado).
 */
export interface QueuedRequest {
  id: string;
  categoryName: string;
  icon: string | null;
  iconGroup: IconGroup;
  address: string | null;
  createdAt: string;
  rejection: QueuedRejection | null;
}

export interface QueuedCardModel {
  key: string;
  /** Id do item na fila (para "Remover"). */
  id: string;
  title: string;
  address: string | null;
  icon: string | null;
  iconGroup: IconGroup;
  badge: StatusBadgeStyle;
  /** Sem protocolo ainda: só a data. */
  meta: string;
  rejectionReason: string | null;
  /** Recusada: o cidadão tira o item da fila com "Remover". */
  canRemove: boolean;
}

const WAITING_BADGE: StatusBadgeStyle = {
  label: 'Aguardando internet',
  icon: WifiOff,
  bg: colors.warningSoft,
  fg: colors.warning,
};

const NOT_SENT_BADGE: StatusBadgeStyle = {
  label: 'Não enviada',
  icon: CircleX,
  bg: colors.dangerSoft,
  fg: colors.danger,
};

/** Texto do motivo: o título da 5c, ou o tipo que a prefeitura não atende mais. */
export function rejectionReason(rejection: QueuedRejection): string {
  if (rejection.code === 'category_unavailable') {
    return 'Este tipo de solicitação não está disponível nesta cidade.';
  }
  return rejection.municipality
    ? `${rejection.municipality.name} ainda não usa o Alô Cidadão`
    : 'Sua cidade ainda não usa o Alô Cidadão';
}

export function toQueuedCardModel(item: QueuedRequest, now: Date = new Date()): QueuedCardModel {
  return {
    key: `queued:${item.id}`,
    id: item.id,
    title: item.categoryName,
    address: item.address,
    icon: item.icon,
    iconGroup: item.iconGroup,
    badge: item.rejection ? NOT_SENT_BADGE : WAITING_BADGE,
    meta: formatShortDate(item.createdAt, now),
    rejectionReason: item.rejection ? rejectionReason(item.rejection) : null,
    canRemove: item.rejection !== null,
  };
}
