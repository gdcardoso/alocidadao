import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

export interface FieldLabelProps {
  label: string;
  /** Texto pequeno à direita do rótulo: "obrigatório" ou "opcional". */
  requirement?: 'required' | 'optional';
  /** Rótulo de seção (Lexend 18, "Tipo de solicitação") em vez de rótulo de campo (16/500). */
  section?: boolean;
}

/** Rótulo de campo com a marcação "obrigatório"/"opcional" do Pencil. */
export function FieldLabel({ label, requirement, section = false }: FieldLabelProps) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, section && styles.section]}>{label}</Text>
      {requirement ? (
        <Text style={styles.requirement}>
          {requirement === 'required' ? 'obrigatório' : 'opcional'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  label: {
    fontFamily: fonts.headingMedium,
    fontSize: 16,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  section: { fontFamily: fonts.heading, fontSize: 18 },
  requirement: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
});
