import { MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Chip de filtro: 40 de altura, raio 20; selecionado em `text-primary` com texto branco. */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      hitSlop={{ top: 2, bottom: 2 }}
      style={[styles.filter, selected ? styles.filterSelected : styles.filterIdle]}
    >
      <Text style={[styles.filterText, { color: selected ? colors.surface : colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface CityChipProps {
  label: string;
}

/** Chip de cidade ("Você está em São Paulo"): só informação. */
export function CityChip({ label }: CityChipProps) {
  return (
    <View style={styles.city}>
      <MapPin size={16} color={colors.primary} />
      <Text style={styles.cityText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filter: {
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSelected: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  filterIdle: { backgroundColor: colors.surface, borderColor: colors.borderInput },
  filterText: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  city: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cityText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
