import { Stack } from 'expo-router';
import { colors } from '../../../ui/theme';

// Abrindo direto numa tela interna do agente, as abas ficam embaixo para o Voltar.
// O Expo Router lê esta constante do arquivo do layout.
// oxlint-disable-next-line react/only-export-components
export const unstable_settings = { initialRouteName: '(tabs)' };

/** Modo agente: as abas (Atividades e Perfil) e, por cima delas, as telas das atividades. */
export default function AgentLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
