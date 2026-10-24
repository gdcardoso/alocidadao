import type { ImpedimentReason } from '@alocidadao/shared';
import {
  Ban,
  CircleCheck,
  CircleEllipsis,
  Landmark,
  PackageX,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts } from '../theme';

/** Ícone de cada motivo de impedimento (decisões do plano). */
const IMPEDIMENT_REASON_ICONS: Record<ImpedimentReason, LucideIcon> = {
  missing_material: PackageX,
  inaccessible: Ban,
  needs_other_team: Users,
  not_municipal: Landmark,
  other: CircleEllipsis,
};

export interface ReasonOptionProps {
  reason: ImpedimentReason;
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * Opção de motivo da A4 (escolha única): linha de 56, raio 16. Selecionada: `primary-soft`,
 * borda `primary` 2 e o ícone trocado por `circle-check`.
 */
export function ReasonOption({ reason, label, selected, onPress }: ReasonOptionProps) {
  const Icon = selected ? CircleCheck : IMPEDIMENT_REASON_ICONS[reason];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }}
      style={({ pressed }) => [
        styles.option,
        selected ? styles.selected : styles.idle,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Icon size={22} color={selected ? colors.primary : colors.textSecondary} />
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingVertical: 8,
  },
  // A borda de 2 da selecionada não empurra o conteúdo.
  idle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    paddingHorizontal: 16,
  },
  selected: {
    backgroundColor: colors.primarySoft,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingHorizontal: 15,
  },
  pressed: { backgroundColor: colors.bg },
  label: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
  labelSelected: { fontFamily: fonts.bodySemibold, color: colors.primary },
});
