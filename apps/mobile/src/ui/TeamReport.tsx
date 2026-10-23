import { HardHat, Landmark } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from './theme';

export interface TeamReportProps {
  /** `team`: relato da equipe (capacete azul). `rejection`: motivo da recusa (prédio vermelho). */
  kind: 'team' | 'rejection';
  title: string;
  date: string;
  text?: string | null;
}

/** Cartão "Relato da equipe": ícone em círculo 40, título 16/600, data 14 e relato 16. */
export function TeamReport({ kind, title, date, text }: TeamReportProps) {
  const team = kind === 'team';
  const Icon = team ? HardHat : Landmark;
  return (
    <View style={styles.card} accessible>
      <View style={styles.head}>
        <View
          style={[styles.icon, { backgroundColor: team ? colors.primarySoft : colors.dangerSoft }]}
        >
          <Icon size={20} color={team ? colors.primary : colors.danger} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.date}>{date}</Text>
        </View>
      </View>
      {text ? <Text style={styles.text}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  date: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  text: { fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
});
