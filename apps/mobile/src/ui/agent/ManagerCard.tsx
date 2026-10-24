import { ClipboardPen, Undo2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { ManagerCardView } from '../../agent/detail-view';
import { colors, fonts, radius } from '../theme';

/**
 * Cartão do gestor no topo do detalhe: instruções (A2, `primary-soft` com borda `primary`) ou
 * pedido de ajuste (A5, `warning-soft` com borda `warning` e título `warningStrong`).
 */
export function ManagerCard({ view }: { view: ManagerCardView }) {
  const rework = view.tone === 'rework';
  const Icon = rework ? Undo2 : ClipboardPen;
  return (
    <View style={[styles.card, rework ? styles.rework : styles.instructions]} accessible>
      <View style={styles.top}>
        <Icon size={20} color={rework ? colors.warning : colors.primary} />
        <Text
          style={[styles.title, { color: rework ? colors.warningStrong : colors.primary }]}
          accessibilityRole="header"
        >
          {view.title}
        </Text>
      </View>
      <Text style={[styles.text, view.muted && styles.muted]}>{view.text}</Text>
      {view.author ? <Text style={styles.author}>{view.author}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: 16, gap: 8, borderWidth: 1 },
  instructions: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  rework: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 16 },
  text: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.textPrimary },
  muted: { color: colors.textSecondary },
  author: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
});
