import { StyleSheet, Text, View } from 'react-native';
import { useAgentWorkOrders } from '../../../../agent/use-agent-work-orders';
import { useSession } from '../../../../auth/use-session';
import { ModePill } from '../../../../ui/ModePill';
import { Screen } from '../../../../ui/Screen';
import { colors, fonts, space } from '../../../../ui/theme';

/** A1 · Minhas atividades: a tela inicial do modo agente (a lista entra na Task 8). */
export default function MinhasAtividades() {
  const { setMode } = useSession();
  const { team } = useAgentWorkOrders();
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.texts}>
          {team ? <Text style={styles.team}>{team}</Text> : null}
          <Text style={styles.title} accessibilityRole="header">
            Minhas atividades
          </Text>
        </View>
        <ModePill mode="agent" onPress={() => void setMode('citizen')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Pencil: padding 14/20/8/20, textos à esquerda e pílula à direita.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: space.gutter,
    paddingBottom: 8,
  },
  texts: { flex: 1, gap: 2 },
  team: { fontFamily: fonts.body, fontSize: 15, color: colors.textSecondary },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
});
