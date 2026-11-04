import { Stack } from 'expo-router';
import { needsTermsAcceptance } from '../../legal/terms-route';
import { useSession } from '../../auth/use-session';
import { useOutboxSync } from '../../offline/use-outbox-sync';
import { colors } from '../../ui/theme';

// Abrindo direto numa tela interna (ex.: link de push), as abas ficam embaixo para o Voltar.
// O Expo Router lê esta constante do arquivo do layout. A âncora `(tabs)` só existe no modo
// cidadão; no modo agente ela fica proibida e a âncora do agente é a de `agente/_layout.tsx`.
// oxlint-disable-next-line react/only-export-components
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Telas de quem está logado: as abas do modo atual e, por cima delas, as telas internas. As
 * abas do outro modo ficam proibidas: trocar de modo tira da pilha as telas do modo anterior.
 */
export default function AppLayout() {
  const { mode, me } = useSession();
  // Conta que ainda não aceitou os Termos só enxerga a tela de aceite.
  const mustAccept = needsTermsAcceptance(me);
  // A fila offline sai sozinha enquanto a pessoa está logada (rede, primeiro plano, espera),
  // menos antes do aceite dos Termos: a API recusaria tudo.
  useOutboxSync(!mustAccept);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={mode === 'citizen' && !mustAccept}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={mode === 'agent' && !mustAccept}>
        <Stack.Screen name="agente" />
      </Stack.Protected>
      <Stack.Protected guard={mustAccept}>
        <Stack.Screen name="aceite" />
      </Stack.Protected>
    </Stack>
  );
}
