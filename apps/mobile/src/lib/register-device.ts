import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { sessionApi } from '../auth/native-session';
import { getDeviceInstallationId } from './device-installation-id';
import { registerForPush } from './push';

/** Plataforma e versão do app, como a API espera em `device`. */
export function deviceInfo() {
  return {
    platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
    appVersion: Constants.expoConfig?.version ?? 'dev',
  };
}

/**
 * Grava este aparelho na conta (`PUT /me/devices/:installationId`), com o token de push quando
 * `registerForPush` consegue um. Roda depois do login (pede a permissão de notificação) e a
 * cada abertura logada (só usa a permissão que já existe, sem perguntar de novo). Nenhuma falha
 * (push negado, sem rede) impede o uso do app.
 */
export async function registerDevice({
  askPermission = false,
}: { askPermission?: boolean } = {}): Promise<void> {
  try {
    const installationId = await getDeviceInstallationId();
    const push = await registerForPush({ requestPermission: askPermission }).catch(() => null);
    // Sem token, o campo não vai: a API mantém o que já tinha.
    const pushToken = push && 'token' in push ? push.token : undefined;
    await sessionApi.registerDevice(installationId, {
      ...deviceInfo(),
      ...(pushToken ? { pushToken } : {}),
    });
  } catch (error) {
    console.warn('Falha ao registrar o aparelho', error);
  }
}
