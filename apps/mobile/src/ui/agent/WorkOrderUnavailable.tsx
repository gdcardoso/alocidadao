import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AgentWorkOrderState } from '../../agent/use-agent-work-order';
import { SecondaryButton } from '../Button';
import { colors, fonts, space } from '../theme';

export interface WorkOrderUnavailableProps {
  /** `ready` sem a tela pronta conta como carregando. */
  phase: AgentWorkOrderState['phase'];
  onBack: () => void;
  onRetry: () => void;
}

/** Atividade ainda carregando, que saiu do agente, ou sem cache e sem rede (A2, A3, A4). */
export function WorkOrderUnavailable({ phase, onBack, onRetry }: WorkOrderUnavailableProps) {
  return (
    <View style={styles.state}>
      {phase === 'loading' || phase === 'ready' ? (
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
});
