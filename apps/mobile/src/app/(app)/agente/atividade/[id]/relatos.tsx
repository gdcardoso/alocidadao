import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { toAgentDetail } from '../../../../../agent/detail-view';
import { useAgentWorkOrder } from '../../../../../agent/use-agent-work-order';
import { Header } from '../../../../../ui/Header';
import { Screen } from '../../../../../ui/Screen';
import { ReportList } from '../../../../../ui/agent/ReportList';
import { colors, fonts, space } from '../../../../../ui/theme';

/** Relatos dos cidadãos: todos os relatos da ocorrência ("Ver os N relatos" da A2/A5). */
export default function RelatosDosCidadaos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, here, now } = useAgentWorkOrder(id);
  const detail = state.phase === 'ready' ? state.detail : null;
  const view = useMemo(
    () => (detail ? toAgentDetail(detail, { here, queue: [], now }) : null),
    [detail, here, now],
  );

  return (
    <Screen>
      <Header
        nav="back"
        onNavPress={() => router.back()}
        title="Relatos dos cidadãos"
        subtitle={view?.subtitle}
      />
      {view ? (
        <ScrollView contentContainerStyle={styles.content}>
          <ReportList reports={view.reports.all} />
        </ScrollView>
      ) : state.phase === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Carregando" />
        </View>
      ) : (
        <View style={styles.state}>
          <Text style={styles.stateText}>Não foi possível carregar os relatos.</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 8, paddingHorizontal: space.gutter, paddingBottom: 24 },
  state: { paddingHorizontal: space.gutter, paddingTop: 32, alignItems: 'center' },
  stateText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
