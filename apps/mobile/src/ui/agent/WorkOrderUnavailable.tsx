import { Info } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AgentWorkOrderState } from '../../agent/use-agent-work-order';
import { SecondaryButton } from '../Button';
import { colors, fonts, space } from '../theme';

export interface WorkOrderUnavailableProps {
  /** `ready` sem a tela pronta conta como carregando. */
  phase: AgentWorkOrderState['phase'];
  onBack: () => void;
  onRetry: () => void;
  /**
   * A3/A4 de atividade que já não aceita a ação (aguardando revisão, impedida): mostra a nota
   * de só leitura da A2 no lugar do formulário.
   */
  readOnlyNote?: string | null;
}

/**
 * Atividade ainda carregando, que saiu do agente, sem cache e sem rede (A2, A3, A4), ou só de
 * leitura (A3, A4).
 */
export function WorkOrderUnavailable({
  phase,
  onBack,
  onRetry,
  readOnlyNote,
}: WorkOrderUnavailableProps) {
  return (
    <View style={styles.state}>
      {readOnlyNote ? (
        <>
          <View style={styles.note} accessible accessibilityRole="text">
            <Info size={18} color={colors.textSecondary} />
            <Text style={styles.noteText}>{readOnlyNote}</Text>
          </View>
          <SecondaryButton label="Voltar para minhas atividades" size="medium" onPress={onBack} />
        </>
      ) : phase === 'loading' || phase === 'ready' ? (
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Carregando" />
      ) : phase === 'gone' ? (
        <>
          <Text style={styles.title}>Esta atividade não está mais com você</Text>
          <Text style={styles.text}>
            Ela foi concluída, cancelada ou passada para outra equipe.
          </Text>
          <SecondaryButton label="Voltar para minhas atividades" size="medium" onPress={onBack} />
        </>
      ) : (
        <>
          <Text style={styles.title}>Não foi possível carregar a atividade</Text>
          <Text style={styles.text}>Confira sua internet e tente de novo.</Text>
          <SecondaryButton label="Tentar de novo" size="medium" onPress={onRetry} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { paddingHorizontal: space.gutter, paddingTop: 32, gap: 8, alignItems: 'center' },
  title: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  noteText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
});
