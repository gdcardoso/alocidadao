import {
  AGENT_NEAR_SITE_M,
  MAX_PHOTOS_PER_COMPLETION,
  MAX_PHOTOS_PER_IMPEDIMENT,
  distanceMeters,
  type DeviceLocation,
  type GeoPoint,
  type ImpedimentReason,
} from '@alocidadao/shared';
import { formatDistance } from '../ui/format';
import type { AgentDetailView } from './detail-view';

// Regras puras da A3 (Concluir atendimento) e da A4 (Não consigo resolver).

/** Relato da conclusão e detalhes do impedimento: de 3 caracteres (sem espaços nas pontas). */
export const MIN_NOTE_LENGTH = 3;
/** Limite do relato da conclusão (o mesmo da API). */
export const MAX_COMPLETION_NOTE = 2000;
/** Limite dos detalhes do impedimento (o mesmo da API). */
export const MAX_IMPEDIMENT_NOTE = 1000;

/** Posição lida ao abrir a A3: `'reading'` enquanto lê; `null` sem posição. */
export type LocationReading = DeviceLocation | null | 'reading';

export interface LocationBandView {
  tone: 'success' | 'warning' | 'neutral';
  /** Ícone Lucide; `loading` é o indicador de atividade. */
  icon: 'map-pin-check' | 'map-pin-x' | 'map-pin-off' | 'loading';
  text: string;
}

/** Faixa de local da A3. Nunca bloqueia o envio: longe ou sem posição, só avisa. */
export function locationBand(here: LocationReading, site: GeoPoint): LocationBandView {
  if (here === 'reading')
    return { tone: 'neutral', icon: 'loading', text: 'Confirmando sua localização…' };
  if (here === null)
    return {
      tone: 'warning',
      icon: 'map-pin-off',
      text: 'Não foi possível confirmar sua localização. Pode concluir assim mesmo.',
    };
  const meters = distanceMeters(here, site);
  const distance = formatDistance(meters);
  if (meters <= AGENT_NEAR_SITE_M)
    return {
      tone: 'success',
      icon: 'map-pin-check',
      text: `Você está no local da ocorrência (a ${distance})`,
    };
  return {
    tone: 'warning',
    icon: 'map-pin-x',
    text: `Você está a ${distance} do local da ocorrência. Pode concluir assim mesmo.`,
  };
}

const noteWithin = (note: string, max: number) => {
  const length = note.trim().length;
  return length >= MIN_NOTE_LENGTH && length <= max;
};

/** Concluir: de 1 a 3 fotos e o relato do que foi feito. */
export function canSendCompletion({ photos, note }: { photos: readonly string[]; note: string }) {
  return (
    photos.length >= 1 &&
    photos.length <= MAX_PHOTOS_PER_COMPLETION &&
    noteWithin(note, MAX_COMPLETION_NOTE)
  );
}

/** Impedimento: o motivo, os detalhes e no máximo uma foto. */
export function canSendImpediment({
  reason,
  note,
  photos,
}: {
  reason: ImpedimentReason | null;
  note: string;
  photos: readonly string[];
}) {
  return (
    reason !== null &&
    photos.length <= MAX_PHOTOS_PER_IMPEDIMENT &&
    noteWithin(note, MAX_IMPEDIMENT_NOTE)
  );
}

/** Informação da A3, pelo número de cidadãos que ainda acompanham a ocorrência. */
export function infoText(citizenCount: number): string {
  if (citizenCount <= 0) return 'O gestor revisa as fotos e o relato.';
  if (citizenCount === 1)
    return 'O gestor revisa as fotos e o relato antes de enviar ao cidadão que relatou.';
  return `O gestor revisa as fotos e o relato antes de enviar aos ${citizenCount} cidadãos que relataram.`;
}

export interface DraftForm {
  photos: readonly string[];
  note: string;
  reason?: ImpedimentReason | null;
  /** Relato que a tela já abriu preenchido (reenvio depois do ajuste). */
  initialNote?: string;
}

/** Há algo preenchido pela pessoa: fechar pede confirmação. */
export function hasDraft({ photos, note, reason = null, initialNote = '' }: DraftForm): boolean {
  return photos.length > 0 || reason !== null || note.trim() !== initialNote.trim();
}

/** Fechar a A3/A4: com envio ou foto sendo guardada, espera; com algo preenchido, pergunta. */
export type CloseDecision = 'wait' | 'confirm' | 'leave';

export function closeDecision({ busy, dirty }: { busy: boolean; dirty: boolean }): CloseDecision {
  if (busy) return 'wait';
  return dirty ? 'confirm' : 'leave';
}

/**
 * A atividade não aceita mais a ação (aguardando revisão, impedida): a tela mostra a nota de
 * só leitura no lugar do formulário. Durante o envio desta tela (`busy`), o status otimista
 * da fila não conta: a tela já vai voltar à A1.
 */
export function finishIsReadOnly(
  view: Pick<AgentDetailView, 'footer'>,
  { busy }: { busy: boolean },
): boolean {
  return view.footer === null && !busy;
}
