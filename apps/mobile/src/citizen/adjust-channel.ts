import type { GeoPoint } from '@alocidadao/shared';

// Ponto escolhido no mapa ("Ajustar"), entregue à Nova solicitação quando ela volta ao foco.

let pending: GeoPoint | null = null;

export function setAdjustedLocation(point: GeoPoint): void {
  pending = point;
}

/** Devolve o ponto escolhido uma única vez. */
export function takeAdjustedLocation(): GeoPoint | null {
  const point = pending;
  pending = null;
  return point;
}
