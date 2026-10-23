import { Stack } from 'expo-router';
import { colors } from '../../ui/theme';

/** Telas de quem ainda não entrou: celular, código, cadastro e verificação por e-mail. */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
