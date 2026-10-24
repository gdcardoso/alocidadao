import {
  distanceMeters,
  type AgentWorkOrderDetail,
  type GeoPoint,
  type ReworkReason,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import type { GalleryPhoto } from '../citizen/detail-view';
import { formatCoordinates } from '../citizen/new-request';
import type { OutboxItem } from '../offline/outbox';
import {
  formatAgoPrecise,
  formatDateTime,
  formatDayMonth,
  formatDayTime,
  formatDistance,
} from '../ui/format';
import { agentItems, effectiveStatus, plural } from './agent-view';

// Modelo do detalhe da atividade do agente (A2 e A5), puro: detalhe do cache + fila + posição.

export interface AgentDetailContext {
  /** Posição do aparelho; `null` sem localização. */
  here: GeoPoint | null;
  queue: readonly OutboxItem[];
  now: Date;
}

/** Cartão do topo: instruções (A2, azul) ou pedido de ajuste (A5, âmbar). */
export interface ManagerCardView {
  tone: 'instructions' | 'rework';
  title: string;
  text: string;
  /** "Sem instruções do gestor.": texto em `text-secondary`. */
  muted: boolean;
  /** `Carlos (Gestor de Obras) · prazo: 23 out`; `null` sem autor e sem prazo. */
  author: string | null;
}

export interface ReportView {
  text: string;
  /** Relato sem texto: "Sem observação" em `text-secondary`. */
  empty: boolean;
  /** `'20 out, 08:12'`. */
  date: string;
}

/**
 * `start`: Iniciar atendimento. `complete`: Concluir atendimento. `rework`: reenvio depois do
 * ajuste (o rótulo vem em `primaryLabel`). `null`: só de leitura.
 */
export type AgentDetailFooter = 'start' | 'complete' | 'rework' | null;

export interface AgentDetailView {
  title: string;
  subtitle: string;
  /** Status mostrado (o da fila, quando há envio dela à frente do servidor). */
  status: WorkOrderStatus;
  manager: ManagerCardView;
  location: { address: string; distance: string | null };
  photos: { cover: string | null; count: number; gallery: GalleryPhoto[] };
  reports: { shown: ReportView[]; all: ReportView[]; moreLabel: string | null };
  footer: AgentDetailFooter;
  primaryLabel: string | null;
  readOnlyNote: string | null;
}

const SHOWN_REPORTS = 3;

const REWORK_TITLES: Record<ReworkReason, string> = {
  new_photos: 'Gestor pediu novas fotos',
  new_note: 'Gestor pediu um novo relato',
  return_to_site: 'Gestor pediu para voltar ao local',
};

const READ_ONLY_NOTES: Partial<Record<WorkOrderStatus, string>> = {
  awaiting_review: 'Enviado ao gestor. Aguardando a revisão.',
  impeded: 'Impedimento enviado. Aguardando a decisão do gestor.',
};

const managerName = (name: string, department: string | null) =>
  department ? `${name} (Gestor de ${department})` : name;

function instructionsCard(detail: AgentWorkOrderDetail): ManagerCardView {
  const text = detail.managerInstructions?.trim() ?? '';
  const parts: string[] = [];
  if (detail.assignedBy)
    parts.push(managerName(detail.assignedBy.name, detail.assignedBy.departmentName));
  if (detail.dueAt) parts.push(`prazo: ${formatDayMonth(detail.dueAt)}`);
  return {
    tone: 'instructions',
    title: 'Instruções do gestor',
    text: text || 'Sem instruções do gestor.',
    muted: !text,
    author: parts.length > 0 ? parts.join(' · ') : null,
  };
}

function reworkCard(rework: NonNullable<AgentWorkOrderDetail['rework']>, now: Date) {
  const [only] = rework.reasons;
  const ago = `devolvido ${formatAgoPrecise(rework.at, now)}`;
  const card: ManagerCardView = {
    tone: 'rework',
    title: rework.reasons.length === 1 && only ? REWORK_TITLES[only] : 'Gestor pediu ajustes',
    text: rework.message,
    muted: false,
    author: rework.byName ? `${managerName(rework.byName, rework.departmentName)} · ${ago}` : ago,
  };
  return card;
}

function footerFor(status: WorkOrderStatus): AgentDetailFooter {
  switch (status) {
    case 'assigned':
      return 'start';
    case 'in_execution':
      return 'complete';
    case 'rework_requested':
      return 'rework';
    default:
      return null;
  }
}

/** A2/A5: o que a tela mostra, contando o envio do agente que ainda está na fila. */
export function toAgentDetail(
  detail: AgentWorkOrderDetail,
  { here, queue, now }: AgentDetailContext,
): AgentDetailView {
  const items = agentItems(queue).filter((item) => item.payload.workOrderId === detail.id);
  const { status } = effectiveStatus(detail, items);

  const manager =
    status === 'rework_requested' && detail.rework
      ? reworkCard(detail.rework, now)
      : instructionsCard(detail);

  const footer = footerFor(status);
  let primaryLabel: string | null = null;
  if (footer === 'start') primaryLabel = 'Iniciar atendimento';
  else if (footer === 'complete') primaryLabel = 'Concluir atendimento';
  else if (footer === 'rework')
    primaryLabel = detail.rework?.reasons.includes('new_photos')
      ? 'Enviar novas fotos'
      : 'Concluir atendimento';

  const address = detail.address ?? formatCoordinates(detail.location);
  const reports = detail.reports.map((report): ReportView => ({
    text: report.description.trim() || 'Sem observação',
    empty: !report.description.trim(),
    date: formatDayTime(report.createdAt),
  }));

  return {
    title: detail.categoryName,
    subtitle: `Ocorrência ${detail.protocol} · ${plural(detail.reportCount, 'relato', 'relatos')}`,
    status,
    manager,
    location: {
      address,
      distance: here ? `A ${formatDistance(distanceMeters(here, detail.location))} de você` : null,
    },
    photos: {
      cover: detail.photos[0]?.url ?? null,
      count: detail.photos.length,
      gallery: detail.photos.map((photo) => ({
        url: photo.url,
        caption: 'Foto do cidadão',
        meta: `${formatDateTime(photo.takenAt)} · ${address}`,
      })),
    },
    reports: {
      shown: reports.slice(0, SHOWN_REPORTS),
      all: reports,
      moreLabel: reports.length > SHOWN_REPORTS ? `Ver os ${reports.length} relatos` : null,
    },
    footer,
    primaryLabel,
    readOnlyNote: READ_ONLY_NOTES[status] ?? null,
  };
}

/**
 * Link de "Abrir rota no mapa": no Android, `geo:` (o sistema oferece os apps de mapa); no iOS,
 * o Apple Maps com o destino.
 */
export function routeUrl(os: 'android' | 'ios', at: GeoPoint, address: string | null): string {
  if (os === 'ios') return `http://maps.apple.com/?daddr=${at.lat},${at.lng}`;
  // encodeURIComponent não codifica parênteses: um ")" no endereço fecharia o rótulo antes.
  const encoded = address
    ? encodeURIComponent(address).replace(/\(/g, '%28').replace(/\)/g, '%29')
    : '';
  const label = address ? `(${encoded})` : '';
  return `geo:0,0?q=${at.lat},${at.lng}${label}`;
}
