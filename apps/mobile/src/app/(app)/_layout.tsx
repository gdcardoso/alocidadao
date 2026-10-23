import { Stack } from 'expo-router';
import { useOutboxSync } from '../../offline/use-outbox-sync';
import { colors } from '../../ui/theme';

// Abrindo direto numa tela interna (ex.: link de push), as abas ficam embaixo para o Voltar.
// O Expo Router lê esta constante do arquivo do layout.
// oxlint-disable-next-line react/only-export-components
export const unstable_settings = { initialRouteName: '(tabs)' };

/** Telas de quem está logado: as abas e, por cima delas, as telas internas. */
export default function AppLayout() {
  // A fila offline sai sozinha enquanto a pessoa está logada (rede, primeiro plano, espera).
  useOutboxSync();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
