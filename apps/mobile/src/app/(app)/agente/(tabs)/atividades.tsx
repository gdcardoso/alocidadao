import { router, type Href } from 'expo-router';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { CircleAlert, List, Map as MapIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { AgentQueueNotice } from '../../../../agent/agent-view';
import { useAgentWorkOrders } from '../../../../agent/use-agent-work-orders';
import { useSession } from '../../../../auth/use-session';
import { SecondaryButton, TextButton } from '../../../../ui/Button';
import { ModePill } from '../../../../ui/ModePill';
import { OfflineBanner } from '../../../../ui/agent/OfflineBanner';
import { SegmentedControl, type Segment } from '../../../../ui/agent/SegmentedControl';
import { WorkOrderCard } from '../../../../ui/agent/WorkOrderCard';
import { WorkOrderMap } from '../../../../ui/agent/WorkOrderMap';
import { Screen } from '../../../../ui/Screen';
import { colors, fonts, radius, space } from '../../../../ui/theme';

type DisplayMode = 'list' | 'map';

const SEGMENTS: readonly Segment<DisplayMode>[] = [
  { key: 'list', label: 'Lista', icon: List },
  { key: 'map', label: 'Mapa', icon: MapIcon },
];

const openWorkOrder = (id: string) => router.push(`/(app)/agente/atividade/${id}` as Href);

/** A1 · Minhas atividades: a tela inicial do modo agente, em lista ou mapa. */
export default function MinhasAtividades() {
  const { setMode } = useSession();
  const { list, phase, refreshing, refresh, online, here, banner, team, removeSend } =
    useAgentWorkOrders();
  const tabBarHeight = useBottomTabBarHeight();
  const [view, setView] = useState<DisplayMode>('list');

  const notices =
    list.notices.length > 0 ? (
      <View style={styles.notices}>
        {list.notices.map((notice) => (
          <Notice
            key={notice.itemId}
            notice={notice}
            onRemove={() => void removeSend(notice.itemId)}
          />
        ))}
      </View>
    ) : null;

  // Carregando, sem lista e vazia: os mesmos nos dois modos.
  const state =
    phase === 'loading' ? (
      <View style={styles.state}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Carregando" />
      </View>
    ) : phase === 'unavailable' ? (
      <View style={styles.state}>
        <Text style={styles.stateText}>Não foi possível carregar as atividades.</Text>
        <SecondaryButton label="Tentar de novo" onPress={() => void refresh()} size="medium" />
      </View>
    ) : list.items.length === 0 ? (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Nenhuma atividade agora</Text>
        <Text style={styles.stateText}>
          Quando o gestor atribuir uma atividade à sua equipe, ela aparece aqui.
        </Text>
      </View>
    ) : null;

  return (
    <Screen>
      {banner ? <OfflineBanner text={banner} /> : null}
      <View style={styles.header}>
        <View style={styles.texts}>
          {team ? <Text style={styles.team}>{team}</Text> : null}
          <Text style={styles.title} accessibilityRole="header">
            Minhas atividades
          </Text>
        </View>
        <ModePill mode="agent" onPress={() => void setMode('citizen')} />
      </View>
      <View style={styles.segments}>
        <SegmentedControl segments={SEGMENTS} value={view} onChange={setView} />
      </View>
      {view === 'list' ? (
        <FlatList
          data={phase === 'ready' ? list.items : []}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {notices}
              {phase === 'ready' && list.items.length > 0 ? (
                <Text style={styles.summary}>{list.summary}</Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={state ?? undefined}
          contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 20 }]}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && phase === 'ready'}
              onRefresh={() => void refresh()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <WorkOrderCard view={item} onPress={() => openWorkOrder(item.id)} />
          )}
        />
      ) : (
        <View style={styles.mapMode}>
          {notices ? <View style={styles.mapNotices}>{notices}</View> : null}
          {state ?? (
            <WorkOrderMap
              items={list.items}
              here={here}
              online={online}
              bottomInset={tabBarHeight}
              onOpen={openWorkOrder}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

/** Envio que o servidor não aplicou: aviso `danger-soft` com "Remover envio". */
function Notice({ notice, onRemove }: { notice: AgentQueueNotice; onRemove: () => void }) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeRow} accessible accessibilityRole="alert">
        <CircleAlert size={20} color={colors.danger} />
        <Text style={styles.noticeText}>{notice.text}</Text>
      </View>
      <TextButton
        label={notice.actionLabel}
        variant="danger"
        onPress={onRemove}
        style={styles.noticeButton}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
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
  // Conteúdo do Pencil: padding 8/20/20/20, gap 14.
  segments: { paddingTop: 8, paddingHorizontal: space.gutter, paddingBottom: 14 },
  content: { flexGrow: 1, paddingHorizontal: space.gutter },
  listHeader: { gap: 14, paddingBottom: 14 },
  summary: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  separator: { height: 14 },
  mapMode: { flex: 1 },
  mapNotices: { paddingHorizontal: space.gutter, paddingBottom: 14 },
  notices: { gap: 10 },
  notice: {
    padding: 14,
    paddingBottom: 4,
    gap: 4,
    borderRadius: radius.card,
    backgroundColor: colors.dangerSoft,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noticeText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary },
  noticeButton: { alignSelf: 'flex-end' },
  state: { paddingHorizontal: space.gutter, paddingTop: 32, gap: 8, alignItems: 'center' },
  stateTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
});
