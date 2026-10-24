import {
  MAX_LOCATION_ADJUST_M,
  distanceMeters,
  type CategoryOption,
  type GeoPoint,
  type LocateResponse,
  type SimilarOccurrence,
} from '@alocidadao/shared';
import type { CreateRequestPayload } from '../offline/outbox';

// Regras da Nova solicitação (telas 5, 5b e 5c), sem nada nativo (testável em Node).

export interface NewRequestDraft {
  /** Fotos já reduzidas, na ordem em que foram tiradas. */
  photos: string[];
  category: CategoryOption | null;
  /** Posição lida do GPS. */
  gps: GeoPoint | null;
  /** Ponto do relato (o GPS ou o ajustado no mapa). */
  location: GeoPoint | null;
  /** Endereço do aparelho; `null` sem endereço (a tela mostra as coordenadas). */
  address: string | null;
  description: string;
}

export const MAX_DESCRIPTION_LENGTH = 2000;

/** Pelo menos uma foto, um tipo escolhido e o local lido. */
export function canSubmit(draft: NewRequestDraft): boolean {
  return draft.photos.length >= 1 && draft.category !== null && draft.location !== null;
}

/** Algo que se perderia ao fechar a tela. */
export function hasDraftData(draft: NewRequestDraft): boolean {
  return draft.photos.length > 0 || draft.category !== null || draft.description.trim() !== '';
}

/** Payload da fila (sem fotos e conexão, que entram no envio). */
export function buildCreateInput(
  draft: NewRequestDraft,
  now: Date,
  ids: { clientActionId: string; occurrenceId?: string },
): CreateRequestPayload {
  const { category, gps, location } = draft;
  if (!category || !gps || !location) throw new Error('Rascunho incompleto');
  const description = draft.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return {
    clientActionId: ids.clientActionId,
    categoryId: category.id,
    occurredAt: now.toISOString(),
    gpsLocation: gps,
    location,
    ...(draft.address ? { address: draft.address.slice(0, 300) } : {}),
    ...(description ? { description } : {}),
    ...(ids.occurrenceId ? { occurrenceId: ids.occurrenceId } : {}),
    display: { categoryName: category.name, icon: category.icon, iconGroup: category.iconGroup },
  };
}

/** Raio da Terra igual ao de `distanceMeters`. */
const EARTH_RADIUS_M = 6_371_008.8;
/** Folga para o arredondamento não deixar o ponto um fio além do limite do servidor. */
const CLAMP_MARGIN_M = 0.5;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Ponto a `distanceM` da origem, no rumo `bearing` (radianos, a partir do norte). */
function destination(origin: GeoPoint, bearing: number, distanceM: number): GeoPoint {
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const angular = distanceM / EARTH_RADIUS_M;
  const lat = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat),
    );
  return { lat: toDeg(lat), lng: toDeg(lng) };
}

/**
 * O ponto mais perto do candidato a até `MAX_LOCATION_ADJUST_M` do GPS: o próprio candidato,
 * ou o ponto na mesma direção, no limite.
 */
export function limitAdjust(gps: GeoPoint, candidate: GeoPoint): GeoPoint {
  if (distanceMeters(gps, candidate) <= MAX_LOCATION_ADJUST_M) return candidate;
  const lat1 = toRad(gps.lat);
  const lat2 = toRad(candidate.lat);
  const dLng = toRad(candidate.lng - gps.lng);
  // Rumo inicial do GPS para o candidato.
  const bearing = Math.atan2(
    Math.sin(dLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
  );
  return destination(gps, bearing, MAX_LOCATION_ADJUST_M - CLAMP_MARGIN_M);
}

/** Contorno do círculo de `radiusM` em volta do ponto, como `[lng, lat]` (para o mapa). */
export function circleRing(center: GeoPoint, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (2 * Math.PI * (i % steps)) / steps, radiusM);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

export type NewRequestFlow = 'not_served' | 'pick_similar' | 'submit' | 'queue';

/**
 * O que o "Enviar solicitação" faz. Sem rede (ou sem resposta do `locate`), vai para a fila;
 * fora de prefeitura cliente, 5c; com relato parecido, 5b; senão, envia.
 */
export function decideFlow(
  online: boolean,
  locate: LocateResponse | null,
  similar: readonly SimilarOccurrence[],
): NewRequestFlow {
  if (!online || !locate) return 'queue';
  if (locate.status === 'not_served') return 'not_served';
  return similar.length > 0 ? 'pick_similar' : 'submit';
}

/**
 * Como o relato vai para a fila. `online` é o aparelho com rede: só sem ela o item conta como
 * criado offline. `sendNow` envia na hora; com rede mas sem a resposta do `locate`, o item vai
 * só para a fila e `syncAfter` dispara a fila logo em seguida.
 */
export function sendMode(
  flow: 'submit' | 'queue',
  online: boolean,
): { online: boolean; sendNow: boolean; syncAfter: boolean } {
  const sendNow = online && flow === 'submit';
  return { online, sendNow, syncAfter: online && !sendNow };
}

/** A ocorrência parecida mais perto (a que a 5b mostra). */
export function closestSimilar(list: readonly SimilarOccurrence[]): SimilarOccurrence | null {
  return list.reduce<SimilarOccurrence | null>(
    (best, item) => (best === null || item.distanceM < best.distanceM ? item : best),
    null,
  );
}

/** "Rua das Flores, 120 — Centro", com o que o aparelho souber. */
export function formatAddress(parts: {
  street: string | null;
  streetNumber: string | null;
  district: string | null;
}): string | null {
  const street = parts.street
    ? parts.streetNumber
      ? `${parts.street}, ${parts.streetNumber}`
      : parts.street
    : null;
  if (street && parts.district) return `${street} — ${parts.district}`;
  return street ?? parts.district ?? null;
}

/** Coordenadas com 5 casas, quando não há endereço. */
export function formatCoordinates(point: GeoPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

/** "6 pessoas relataram" (5b). */
export function reportCountLabel(count: number): string {
  return count === 1 ? '1 pessoa relatou' : `${count} pessoas relataram`;
}

/** Textos da 5c, com ou sem o município do ponto. */
export function notServedTexts(municipality: { name: string; state: string } | null): {
  title: string;
  body: string;
  contact: string;
} {
  const notJoined =
    'A prefeitura daqui ainda não aderiu ao sistema, então não é possível registrar solicitações por aqui.';
  if (!municipality) {
    return {
      title: 'Sua cidade ainda não usa o Alô Cidadão',
      body: notJoined,
      contact: 'Procure a central de atendimento da prefeitura. Em muitas cidades, o número é 156.',
    };
  }
  const { name, state } = municipality;
  return {
    title: `${name} ainda não usa o Alô Cidadão`,
    body: `Pela sua localização, você está em ${name} — ${state}. ${notJoined}`,
    contact: `Procure a central de atendimento da Prefeitura de ${name}. Em muitas cidades, o número é 156.`,
  };
}
