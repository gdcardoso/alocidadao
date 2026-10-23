import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Mostra o push também com o app aberto (por padrão o Expo o esconde em primeiro plano).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Alô Cidadão' }} />
        <Stack.Screen name="laboratorio/index" options={{ title: 'Laboratório' }} />
        <Stack.Screen name="laboratorio/entrar" options={{ title: 'Entrar' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
