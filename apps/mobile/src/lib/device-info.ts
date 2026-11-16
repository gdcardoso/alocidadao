import type { AppDevice } from '@alocidadao/shared';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Tamanho máximo de cada dado do aparelho, como em `appDeviceSchema`. */
const MAX_LENGTH = 64;

/** Valor do sistema só quando existe: nulo ou vazio não vai (a API mantém o que já tinha). */
function detail(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_LENGTH) : undefined;
}

/**
 * O aparelho como a API espera em `device`: plataforma e versão do app, mais versão do
 * sistema, fabricante e modelo. Nada que identifique o aparelho ou o chip.
 */
export function deviceInfo(): AppDevice {
  const osVersion = detail(Device.osVersion);
  const manufacturer = detail(Device.manufacturer);
  const model = detail(Device.modelName);
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: Constants.expoConfig?.version ?? 'dev',
    ...(osVersion && { osVersion }),
    ...(manufacturer && { manufacturer }),
    ...(model && { model }),
  };
}
