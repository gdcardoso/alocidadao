import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const STATUS_CHANNEL_ID = 'status';

export type PushRegistration =
  | { platform: 'android' | 'ios'; token: string }
  | { error: 'permission_denied' | 'unsupported' | 'push_not_configured' };

/**
 * Pede permissão e devolve o token nativo (FCM no Android, APNs no iOS).
 * No Android o canal `status` é criado antes da permissão (exigência do Android 13+).
 * Sem `google-services.json` no build, o FirebaseApp não inicia e o token não sai:
 * devolve `push_not_configured`.
 */
export async function registerForPush(): Promise<PushRegistration> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { error: 'unsupported' };
  const platform = Platform.OS;

  // Simulador do iOS não recebe push remoto. Emulador Android com Google Play recebe.
  if (platform === 'ios' && !Device.isDevice) return { error: 'unsupported' };

  if (platform === 'android') {
    await Notifications.setNotificationChannelAsync(STATUS_CHANNEL_ID, {
      name: 'Andamento das solicitações',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { error: 'permission_denied' };

  try {
    const token = await Notifications.getDevicePushTokenAsync();
    if (typeof token.data !== 'string') return { error: 'unsupported' };
    return { platform, token: token.data };
  } catch {
    return { error: 'push_not_configured' };
  }
}
