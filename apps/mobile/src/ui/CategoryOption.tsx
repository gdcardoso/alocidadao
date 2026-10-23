import type { IconGroup } from '@alocidadao/shared';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryIcon } from './CategoryIcon';
import { colors, fonts, radius } from './theme';

export interface CategoryOptionProps {
  name: string;
  icon: string | null;
  group: IconGroup;
  selected: boolean;
  onPress: () => void;
}

/**
 * Opção da grade "Tipo de solicitação": 100 de altura, raio 20. Selecionada: fundo
 * `primary-soft`, borda `primary` 2 e selo verde com `check` no canto do ícone.
 */
export function CategoryOption({ name, icon, group, selected, onPress }: CategoryOptionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={name}
      style={[styles.option, selected ? styles.selected : styles.idle]}
    >
      <View>
        <CategoryIcon icon={icon} group={group} shape="circle" />
        {selected ? (
          <View style={styles.check}>
            <Check size={14} color={colors.onPrimary} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.name, selected && styles.nameSelected]}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flex: 1,
    minHeight: 100,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  idle: { borderWidth: 1, borderColor: colors.borderInput },
  selected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  check: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  nameSelected: { fontFamily: fonts.bodySemibold, color: colors.primary },
});
