import type { GeoPoint } from '@alocidadao/shared';
import * as Location from 'expo-location';

export const LOCATION_TIMEOUT_MS = 15_000;

export type CurrentPoint =
  { point: GeoPoint; accuracyM: number | null } | { error: 'permission_denied' | 'unavailable' };

/** Adaptador nativo: pede a permissão e lê a posição atual, com limite de 15 s. */
export async function getCurrentPoint(): Promise<CurrentPoint> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { error: 'permission_denied' };
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
    ]);
    if (position === null) return { error: 'unavailable' };
    return {
      point: { lat: position.coords.latitude, lng: position.coords.longitude },
      accuracyM: position.coords.accuracy,
    };
  } catch {
    return { error: 'unavailable' };
  }
}
