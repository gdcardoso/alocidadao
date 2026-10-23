import { ArrowLeft, X } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { colors } from './theme';

export interface NavButtonProps {
  kind: 'back' | 'close';
  onPress: () => void;
}

/** Voltar ou Fechar: círculo de 44, `surface`, borda `border`, ícone 20. */
export function NavButton({ kind, onPress }: NavButtonProps) {
  const Icon = kind === 'back' ? ArrowLeft : X;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={kind === 'back' ? 'Voltar' : 'Fechar'}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon size={20} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.bg },
});
