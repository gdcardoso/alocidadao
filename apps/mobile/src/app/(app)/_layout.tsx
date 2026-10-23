import { Stack } from 'expo-router';
import { colors } from '../../ui/theme';

/** Telas de quem está logado (a Task 8 traz as abas). */
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
