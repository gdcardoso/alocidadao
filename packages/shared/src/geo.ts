import { z } from 'zod';

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/** Raio médio da Terra, em metros. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Distância entre dois pontos pela fórmula de haversine, em metros. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Quanto o cidadão pode afastar o local do relato da posição do GPS, em metros. */
export const MAX_LOCATION_ADJUST_M = 200;

/** Raio padrão para agrupar solicitações na mesma ocorrência, em metros. */
export const DEFAULT_CLUSTER_RADIUS_M = 20;
