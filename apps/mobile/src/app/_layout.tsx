import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider } from '../auth/session-context';
import { useSession } from '../auth/use-session';
import { useAppFonts } from '../ui/fonts';
import { colors } from '../ui/theme';

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
    <SessionProvider>
      <RootStack />
      <StatusBar style="dark" />
    </SessionProvider>
  );
}

/**
 * Cada grupo só existe no estado certo da sessão: ao entrar ou sair, o Expo Router tira as
 * telas que ficaram proibidas e volta ao `index`, que redireciona.
 */
function RootStack() {
  const { status } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={status === 'loading'}>
        <Stack.Screen name="abertura" options={{ animation: 'none' }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
      </Stack.Protected>
      {/* Laboratório e kit de componentes: só em desenvolvimento. */}
      <Stack.Protected guard={__DEV__}>
        <Stack.Screen
          name="laboratorio/index"
          options={{ headerShown: true, title: 'Laboratório' }}
        />
        <Stack.Screen name="laboratorio/entrar" options={{ headerShown: true, title: 'Entrar' }} />
        <Stack.Screen name="laboratorio/rede" options={{ headerShown: true, title: 'Rede' }} />
        <Stack.Screen
          name="laboratorio/camera"
          options={{ headerShown: true, title: 'Câmera e local' }}
        />
        <Stack.Screen
          name="laboratorio/offline"
          options={{ headerShown: true, title: 'Atividades offline' }}
        />
        <Stack.Screen
          name="laboratorio/notificacoes"
          options={{ headerShown: true, title: 'Notificações' }}
        />
        <Stack.Screen name="dev/kit" />
      </Stack.Protected>
    </Stack>
  );
}
