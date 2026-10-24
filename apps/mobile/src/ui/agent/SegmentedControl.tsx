import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export interface Segment<K extends string> {
  key: K;
  label: string;
  icon: LucideIcon;
}

export interface SegmentedControlProps<K extends string> {
  segments: readonly Segment<K>[];
  value: K;
  onChange: (key: K) => void;
}

/**
 * Controle segmentado (Lista/Mapa da A1): trilho `border` de 48, padding 4, raio 24; segmento
 * ativo `surface` com ícone e texto `text-primary`, inativo transparente em `text-secondary`.
 */
export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<K>) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {segments.map(({ key, label, icon: Icon }) => {
        const selected = key === value;
        const color = selected ? colors.textPrimary : colors.textSecondary;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            // O segmento mede 40 dentro do trilho: a área de toque chega a 48.
            hitSlop={{ top: 4, bottom: 4 }}
            style={[styles.segment, selected && styles.selected]}
          >
            <Icon size={18} color={color} />
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    minHeight: 48,
    padding: 4,
    borderRadius: 24,
    backgroundColor: colors.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  selected: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.bodySemibold, fontSize: 15, flexShrink: 1 },
});
