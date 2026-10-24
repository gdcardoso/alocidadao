import type { GeoPoint } from '@alocidadao/shared';
import * as Location from 'expo-location';
import { toAccuracyM } from './location-accuracy';

export const LOCATION_TIMEOUT_MS = 15_000;

export type CurrentPoint =
  { point: GeoPoint; accuracyM: number | null } | { error: 'permission_denied' | 'unavailable' };

/** Adaptador nativo: pede a permissão e lê a posição atual, com limite de 15 s. */
export async function getCurrentPoint(): Promise<CurrentPoint> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { error: 'permission_denied' };
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS);
      }),
    ]);
    if (position === null) return { error: 'unavailable' };
    return {
      point: { lat: position.coords.latitude, lng: position.coords.longitude },
      accuracyM: toAccuracyM(position.coords.accuracy),
    };
  } catch {
    return { error: 'unavailable' };
  } finally {
    // O GPS respondeu antes: o temporizador não fica pendurado.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Última posição conhecida do aparelho, sem pedir permissão nem esperar o GPS; `null` sem ela. */
export async function getLastKnownPoint(): Promise<GeoPoint | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  } catch {
    return null;
  }
}
