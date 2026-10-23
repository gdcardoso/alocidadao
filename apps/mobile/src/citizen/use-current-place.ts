import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { sessionApi } from '../auth/native-session';
import { cityFromLocate } from './profile-view';

/** Posição guardada com até 10 min serve para o chip; mais velha, lê a atual. */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Cidade onde o cidadão está, para o chip "Você está em" da tela 4. Não pede permissão (isso
 * é da Nova solicitação): sem permissão, sem rede ou fora de um município conhecido, `null`.
 */
export function useCurrentPlace(): { city: string | null } {
  const [city, setCity] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const position =
          (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const locate = await sessionApi.locate({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        if (active) setCity(cityFromLocate(locate));
      } catch {
        // O chip é só informação: qualquer falha deixa ele de fora.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { city };
}
