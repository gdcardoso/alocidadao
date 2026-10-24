import { ApiError, ApiTimeoutError } from '@alocidadao/api-client';
import {
  AUTO_CONFIRM_AFTER_DAYS,
  type PhotoView,
  type RequestDetail,
  type RequestStatus,
} from '@alocidadao/shared';
import {
  Ban,
  Calendar,
  CircleAlert,
  CircleCheck,
  CircleX,
  HardHat,
  Hourglass,
  MapPin,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react-native';
import type { StatusNoticeTone } from '../ui/StatusNotice';
import type { TimelineStep } from '../ui/Timeline';
import { formatAgo, formatDateTime, formatDayTime, formatElapsed } from '../ui/format';
import { formatCoordinates } from './new-request';

// Modelo das telas 6a–6d e da galeria (7), sem nada nativo (testável em Node).

export interface DetailNotice {
  tone: StatusNoticeTone;
  icon: LucideIcon;
  title: string;
  text: string;
}

/** Cartão "Relato da equipe" ou "Motivo da recusa". */
export interface DetailReport {
  kind: 'team' | 'rejection';
  title: string;
  date: string;
  text: string | null;
}

/** Linha da lista "Sua solicitação". */
export interface DetailFact {
  icon: LucideIcon;
  label: string;
  value: string;
}

/** `cancel`: só na aberta. `confirm_contest`: aguardando a confirmação do cidadão. */
export type DetailFooter = 'cancel' | 'confirm_contest' | null;

export interface DetailModel {
  title: string;
  subtitle: string;
  notice: DetailNotice;
  /** Fotos do cidadão ("Sua foto"). */
  before: PhotoView[];
  /** Fotos publicadas da equipe ("Depois do atendimento"); `null` esconde a coluna. */
  after: PhotoView[] | null;
  report: DetailReport | null;
  facts: DetailFact[];
  steps: TimelineStep[];
  footer: DetailFooter;
  /** Endereço (ou coordenadas) para a legenda da galeria. */
  place: string;
}

/** Hora da última vez em que a solicitação entrou no status. */
function lastAt(detail: RequestDetail, status: RequestStatus): string | null {
  let at: string | null = null;
  for (const event of detail.timeline) if (event.status === status) at = event.at;
  return at;
}

/** Volta a `open` depois de outro status (contestação), se houve. */
function reopenedAt(detail: RequestDetail): string | null {
  let moved = false;
  let at: string | null = null;
  for (const event of detail.timeline) {
    if (event.status !== 'open') moved = true;
    else if (moved) at = event.at;
  }
  return at;
}

const joinDot = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');

function notice(detail: RequestDetail, now: Date): DetailNotice {
  switch (detail.status) {
    case 'open':
      return {
        tone: 'open',
        icon: Hourglass,
        title: formatElapsed('open', detail.statusChangedAt, now),
        text: 'Aguardando a prefeitura analisar e encaminhar para uma equipe. Você recebe um aviso a cada mudança.',
      };
    case 'in_progress': {
      const who = detail.team ? `A ${detail.team.name}` : 'A prefeitura';
      return {
        tone: 'progress',
        icon: HardHat,
        title: formatElapsed('in_progress', detail.statusChangedAt, now),
        text: `${who} está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído.`,
      };
    }
    case 'awaiting_confirmation':
      return {
        tone: 'awaiting',
        icon: CircleAlert,
        title: 'A prefeitura concluiu o atendimento',
        text: `Confira as fotos e diga se o problema foi resolvido. Sem resposta, confirmamos automaticamente em ${AUTO_CONFIRM_AFTER_DAYS} dias.`,
      };
    case 'rejected':
      return {
        tone: 'rejected',
        icon: CircleX,
        title: 'Solicitação recusada',
        text: 'Veja abaixo o motivo informado pela prefeitura.',
      };
    case 'completed':
      return {
        tone: 'done',
        icon: CircleCheck,
        title: 'Concluída',
        text: 'Obrigado por confirmar. Esta solicitação foi encerrada.',
      };
    case 'cancelled':
      return {
        tone: 'open',
        icon: Ban,
        title: 'Cancelada',
        text: 'Você cancelou esta solicitação.',
      };
  }
}

function report(detail: RequestDetail): DetailReport | null {
  if (detail.status === 'rejected' && detail.rejection) {
    return {
      kind: 'rejection',
      title: 'Motivo da recusa',
      date: formatDayTime(detail.rejection.at),
      text: detail.rejection.reason,
    };
  }
  if (detail.completion) {
    return {
      kind: 'team',
      title: detail.team?.name ?? 'Equipe da prefeitura',
      date: `Concluído em ${formatDayTime(detail.completion.publishedAt)}`,
      text: detail.completion.publicNote,
    };
  }
  return null;
}

function steps(detail: RequestDetail, now: Date): TimelineStep[] {
  const { status } = detail;
  const openedAt = reopenedAt(detail) ?? detail.createdAt;
  const at = (s: RequestStatus) => lastAt(detail, s) ?? detail.statusChangedAt;
  const opened: TimelineStep =
    status === 'open'
      ? {
          title: 'Aberta',
          detail: `${formatDayTime(openedAt)} · ${formatAgo(openedAt, now)}`,
          state: 'current',
        }
      : { title: 'Aberta', detail: formatDayTime(openedAt), state: 'done' };

  // Recusada e cancelada terminam ali: as etapas seguintes não acontecem.
  if (status === 'rejected') {
    return [
      opened,
      {
        title: 'Recusada',
        detail: formatDayTime(detail.rejection?.at ?? at('rejected')),
        state: 'rejected',
      },
    ];
  }
  if (status === 'cancelled') {
    return [
      opened,
      { title: 'Cancelada', detail: formatDayTime(at('cancelled')), state: 'rejected' },
    ];
  }

  const team = detail.team?.name ?? null;
  const assignedAt = lastAt(detail, 'in_progress');
  const attended: TimelineStep =
    status === 'open'
      ? { title: 'Em atendimento', detail: 'Encaminhamento para uma equipe', state: 'future' }
      : status === 'in_progress'
        ? {
            title: 'Em atendimento',
            detail: joinDot(team, `desde ${formatDayTime(at('in_progress'))}`),
            state: 'current',
          }
        : {
            title: 'Em atendimento',
            detail: joinDot(team, assignedAt ? formatDayTime(assignedAt) : null),
            state: 'done',
          };

  const finished = status === 'awaiting_confirmation' || status === 'completed';
  const publishedAt = detail.completion?.publishedAt ?? lastAt(detail, 'awaiting_confirmation');
  const execution: TimelineStep = finished
    ? {
        title: 'Concluída pela equipe',
        detail: publishedAt ? formatDayTime(publishedAt) : '',
        state: 'done',
      }
    : { title: 'Conclusão pela equipe', detail: 'Execução do serviço', state: 'future' };

  const confirmation: TimelineStep =
    status === 'awaiting_confirmation'
      ? { title: 'Sua confirmação', detail: 'Aguardando você', state: 'waiting' }
      : status === 'completed'
        ? { title: 'Sua confirmação', detail: formatDayTime(at('completed')), state: 'done' }
        : { title: 'Sua confirmação', detail: 'Depois da conclusão', state: 'future' };

  return [opened, attended, execution, confirmation];
}

export function toDetailModel(detail: RequestDetail, now: Date = new Date()): DetailModel {
  const place = detail.address ?? formatCoordinates(detail.location);
  const facts: DetailFact[] = [{ icon: MapPin, label: 'Local', value: place }];
  if (detail.description.trim()) {
    facts.push({ icon: MessageSquare, label: 'Sua observação', value: detail.description });
  }
  facts.push({ icon: Calendar, label: 'Aberta em', value: formatDateTime(detail.createdAt) });

  const after = detail.completion?.photos ?? [];
  return {
    title: detail.categoryName,
    subtitle: `Protocolo ${detail.protocol}`,
    notice: notice(detail, now),
    before: detail.photos,
    after: after.length > 0 ? after : null,
    report: report(detail),
    facts,
    steps: steps(detail, now),
    footer:
      detail.status === 'open'
        ? 'cancel'
        : detail.status === 'awaiting_confirmation'
          ? 'confirm_contest'
          : null,
    place,
  };
}

/** Foto da galeria (7) com a legenda e a linha de data e local. */
export interface GalleryPhoto {
  url: string;
  caption: string;
  meta: string;
}

/** As fotos do cidadão e, depois, as da equipe, na ordem da galeria. */
export function toGalleryPhotos(model: DetailModel): GalleryPhoto[] {
  const toItem = (caption: string) => (photo: PhotoView) => ({
    url: photo.url,
    caption,
    meta: `${formatDateTime(photo.takenAt)} · ${model.place}`,
  });
  return [
    ...model.before.map(toItem('Sua foto · abertura')),
    ...(model.after ?? []).map(toItem('Depois do atendimento')),
  ];
}

/** Galeria aberta com as fotos em JSON no parâmetro; parâmetro estragado vira lista vazia. */
export function parseGalleryPhotos(raw: unknown): GalleryPhoto[] {
  if (typeof raw !== 'string') return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is GalleryPhoto =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as GalleryPhoto).url === 'string' &&
        typeof (p as GalleryPhoto).caption === 'string' &&
        typeof (p as GalleryPhoto).meta === 'string',
    );
  } catch {
    return [];
  }
}

/** Cancelar, confirmar e contestar exigem rede: não entram na fila. */
export const NO_NETWORK_MESSAGE = 'Sem internet. Tente de novo quando conectar.';
const STATUS_CHANGED_MESSAGE = 'A situação desta solicitação mudou. Confira de novo.';
const FALLBACK_MESSAGE = 'Algo deu errado. Tente de novo.';

/** Mensagem de uma ação que falhou: sem rede, status que mudou no caminho ou erro geral. */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: unknown } | null)?.code;
    return error.status === 409 && code === 'invalid_status'
      ? STATUS_CHANGED_MESSAGE
      : FALLBACK_MESSAGE;
  }
  // O fetch sem rede rejeita com TypeError; o tempo esgotado tem erro próprio.
  if (error instanceof ApiTimeoutError || error instanceof TypeError) return NO_NETWORK_MESSAGE;
  return FALLBACK_MESSAGE;
}
