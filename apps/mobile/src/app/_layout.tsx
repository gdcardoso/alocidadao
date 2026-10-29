import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AberturaOverlay } from '../abertura/AberturaOverlay';
import { SessionProvider } from '../auth/session-context';
import { useSession } from '../auth/use-session';
import { useNotificationTaps } from '../lib/use-notification-taps';
import { useAppFonts } from '../ui/fonts';
import { colors } from '../ui/theme';

// A abertura nativa (branca) fica até a tela 0 desenhar as imagens (AberturaOverlay).
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
  const fontsReady = useAppFonts();

  // A pilha só entra com as fontes (sem piscar a fonte do sistema); a tela 0 fica por cima.
  return (
    <SessionProvider>
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {fontsReady ? <RootStack /> : null}
        <Gate fontsReady={fontsReady} />
      </View>
      <StatusBar style="dark" />
    </SessionProvider>
  );
}

/** Tela 0 até as fontes e a sessão ficarem prontas (no mínimo 1,5 s). */
function Gate({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useSession();
  return <AberturaOverlay ready={fontsReady && status !== 'loading'} />;
}

/**
 * Cada grupo só existe no estado certo da sessão: ao entrar ou sair, o Expo Router tira as
 * telas que ficaram proibidas e volta ao `index`, que redireciona.
 */
function RootStack() {
  const { status } = useSession();
  // Toque no push: abre a solicitação ou a atividade quando a sessão e o roteador estão prontos.
  useNotificationTaps();
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
        <Stack.Screen name="laboratorio/rede" options={{ headerShown: true, title: 'Rede' }} />
        <Stack.Screen
          name="laboratorio/camera"
          options={{ headerShown: true, title: 'Câmera e local' }}
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
