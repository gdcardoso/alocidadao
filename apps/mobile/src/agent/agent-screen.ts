import type { GeoPoint } from '@alocidadao/shared';
import type { AgentCardView } from './agent-view';

// Peças puras da tela A1: área inicial do mapa e o texto lido pelo leitor de tela no cartão.

/** `[oeste, sul, leste, norte]`, como o `bounds` da câmera do MapLibre. */
export type Bounds = [west: number, south: number, east: number, north: number];

/**
 * Menor lado da área, em graus (~550 m): com um ponto só (ou todos juntos) o mapa não chega ao
 * zoom máximo.
 */
export const MIN_SPAN_DEG = 0.005;

/** Área que mostra todos os pontos (pinos e o agente); `null` sem pontos. */
export function mapBounds(points: readonly GeoPoint[], minSpan = MIN_SPAN_DEG): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lat, lng } of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const widen = (low: number, high: number): [number, number] => {
    const missing = minSpan - (high - low);
    return missing > 0 ? [low - missing / 2, high + missing / 2] : [low, high];
  };
  [west, east] = widen(west, east);
  [south, north] = widen(south, north);
  return [west, south, east, north];
}

/** Texto do cartão para o leitor de tela, na ordem em que aparece. */
export function workOrderCardLabel(view: AgentCardView): string {
  return [
    view.categoryName,
    view.isNew ? 'Nova' : null,
    view.address,
    view.distance ? `a ${view.distance}` : null,
    view.badge.label,
    view.reportsLabel,
    view.timeLabel,
  ]
    .filter(Boolean)
    .join(', ');
}
