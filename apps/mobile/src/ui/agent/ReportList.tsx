import { StyleSheet, Text, View } from 'react-native';
import type { ReportView } from '../../agent/detail-view';
import { colors, fonts, radius } from '../theme';

/** Relatos dos cidadãos em cartão com linhas divididas (sem nome: anônimos para o agente). */
export function ReportList({ reports }: { reports: readonly ReportView[] }) {
  return (
    <View style={styles.card}>
      {reports.map((report, index) => (
        <View
          // A lista não muda de ordem; o índice basta.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          style={[styles.row, index < reports.length - 1 && styles.divider]}
          accessible
        >
          <Text style={[styles.text, report.empty && styles.empty]}>{report.text}</Text>
          <Text style={styles.date}>{report.date}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { padding: 16, gap: 4 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
  empty: { color: colors.textSecondary },
  date: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
});
