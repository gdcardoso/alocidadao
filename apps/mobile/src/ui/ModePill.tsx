import { HardHat, User } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppMode } from '../auth/app-mode';
import { colors, fonts } from './theme';

export interface ModePillProps {
  /** Modo atual: o agente vê `Agente` (`hard-hat`); o cidadão com vínculo, `Cidadão` (`user`). */
  mode: AppMode;
  /** Troca de modo. Sem ele, a pílula só indica o modo. */
  onPress?: () => void;
}

const LOOKS = {
  // A1 do Pencil: fundo `text-primary`, ícone e texto brancos.
  agent: {
    icon: HardHat,
    label: 'Agente',
    a11y: 'Trocar para o modo cidadão',
    bg: colors.textPrimary,
    border: colors.textPrimary,
    fg: colors.onPrimary,
  },
  // Sem desenho no Pencil: a mesma pílula em `surface`, borda `border` e texto `text-primary`.
  citizen: {
    icon: User,
    label: 'Cidadão',
    a11y: 'Trocar para o modo agente',
    bg: colors.surface,
    border: colors.border,
    fg: colors.textPrimary,
  },
} as const;

/** Pílula de modo do topo (padding 8/12, gap 6, raio 20; ícone 16, texto 14/600). */
export function ModePill({ mode, onPress }: ModePillProps) {
  const look = LOOKS[mode];
  const Icon = look.icon;
  const body = (pressed: boolean) => (
    <View
      style={[
        styles.pill,
        { backgroundColor: look.bg, borderColor: look.border },
        pressed && styles.pressed,
      ]}
    >
      <Icon size={16} color={look.fg} />
      <Text style={[styles.label, { color: look.fg }]}>{look.label}</Text>
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={look.label}>
        {body(false)}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={look.a11y}
      // A pílula tem 34 de altura: a área de toque chega a 44.
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  pressed: { opacity: 0.8 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14 },
});
