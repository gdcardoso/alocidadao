import type { GeoPoint } from '@alocidadao/shared';
import { Linking, Platform } from 'react-native';
import { routeUrl } from '../agent/detail-view';

/**
 * "Abrir rota no mapa": no Android, `geo:` (o sistema oferece os apps de mapa); no iOS, o Apple
 * Maps. Sem app que abra o link, cai no mapa da web.
 */
export async function openRoute(location: GeoPoint, address: string | null): Promise<void> {
  const os = Platform.OS === 'ios' ? 'ios' : 'android';
  try {
    await Linking.openURL(routeUrl(os, location, address));
  } catch {
    await Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`,
    ).catch((cause: unknown) => console.warn('Falha ao abrir a rota', cause));
  }
}
