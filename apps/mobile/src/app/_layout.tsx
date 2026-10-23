import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useAppFonts } from '../ui/fonts';

// A abertura nativa fica até as fontes carregarem (sem piscar a fonte do sistema).
void SplashScreen.preventAutoHideAsync();

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
  const ready = useAppFonts();

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Alô Cidadão' }} />
        <Stack.Screen name="laboratorio/index" options={{ title: 'Laboratório' }} />
        <Stack.Screen name="laboratorio/entrar" options={{ title: 'Entrar' }} />
        <Stack.Screen name="dev/kit" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
