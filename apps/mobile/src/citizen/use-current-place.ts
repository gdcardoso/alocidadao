import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { sessionApi } from '../auth/native-session';
import { openAppDatabase } from '../offline/sqlite-outbox-store';
import { PlaceCache, placeFromLocate } from './place-cache';
import { cityFromLocate } from './profile-view';

/** Posição guardada com até 10 min serve para o chip; mais velha, lê a atual. */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Cidade onde o cidadão está, para o chip "Você está em" da tela 4. Não pede permissão (isso
 * é da Nova solicitação): sem permissão, sem rede ou fora de um município conhecido, `null`.
 * Relê ao voltar para a tela (ex.: depois de dar a permissão na Nova solicitação) e guarda a
 * prefeitura para a tela 5 sem rede.
 */
export function useCurrentPlace(): { city: string | null } {
  const [city, setCity] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
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
          if (locate.status === 'served') {
            await new PlaceCache(await openAppDatabase()).save(placeFromLocate(locate, Date.now()));
          }
        } catch {
          // O chip é só informação: qualquer falha deixa ele como está.
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  return { city };
}
