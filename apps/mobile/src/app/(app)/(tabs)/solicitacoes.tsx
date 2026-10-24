import { ApiError } from '@alocidadao/api-client';
import type { RequestCard as RequestCardData, RequestListFilter } from '@alocidadao/shared';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { CircleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AGENT_ACCESS_ENDED_NOTICE } from '../../../auth/app-mode';
import { sessionApi } from '../../../auth/native-session';
import { useSession } from '../../../auth/use-session';
import {
  settledSentRequests,
  toCardModel,
  toQueuedCardModel,
  type CardModel,
  type QueuedCardModel,
} from '../../../citizen/requests-view';
import { useCurrentPlace } from '../../../citizen/use-current-place';
import { useQueuedRequests } from '../../../citizen/use-queued-requests';
import { onOutboxSynced } from '../../../offline/outbox-service';
import { SecondaryButton, TextButton } from '../../../ui/Button';
import { CityChip, FilterChip } from '../../../ui/Chip';
import { firstName } from '../../../ui/format';
import { ModePill } from '../../../ui/ModePill';
import { RequestCard } from '../../../ui/RequestCard';
import { Screen } from '../../../ui/Screen';
import { colors, fonts, radius, space } from '../../../ui/theme';

const FILTERS: { key: RequestListFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'active', label: 'Em andamento' },
  { key: 'done', label: 'Concluídas' },
];

type Row = { kind: 'queued'; model: QueuedCardModel } | { kind: 'request'; model: CardModel };

type ListState =
  { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; cards: RequestCardData[] };

/** Tela 4 · Minhas solicitações: a tela inicial de quem está logado. */
export default function MinhasSolicitacoes() {
  const { me, refreshMe, isAgent, setMode, agentAccessEnded, dismissAgentAccessEnded } =
    useSession();
  // Vínculo de agente encerrado: o aviso fica nesta tela enquanto ela existir e não volta (a
  // sessão o esquece assim que ele aparece).
  const [showAccessEnded, setShowAccessEnded] = useState(agentAccessEnded);
  if (agentAccessEnded && !showAccessEnded) setShowAccessEnded(true);
  useEffect(() => {
    if (agentAccessEnded) dismissAgentAccessEnded();
  }, [agentAccessEnded, dismissAgentAccessEnded]);
  const { city } = useCurrentPlace();
  const queue = useQueuedRequests();
  const reloadQueue = queue.reload;
  const tabBarHeight = useBottomTabBarHeight();
  const [filter, setFilter] = useState<RequestListFilter>('all');
  // Uma lista por filtro: trocar de filtro mostra a última enquanto atualiza.
  const [lists, setLists] = useState<Partial<Record<RequestListFilter, ListState>>>({});
  const [refreshing, setRefreshing] = useState(false);
  // Referência de "Hoje" nas datas dos cartões, renovada a cada busca.
  const [now, setNow] = useState(() => new Date());
  // Última busca de cada filtro: resposta atrasada de uma busca antiga é descartada.
  const latest = useRef<Partial<Record<RequestListFilter, number>>>({});

  const load = useCallback(
    async (which: RequestListFilter) => {
      const call = (latest.current[which] ?? 0) + 1;
      latest.current[which] = call;
      setLists((prev) =>
        prev[which]?.phase === 'ready' ? prev : { ...prev, [which]: { phase: 'loading' } },
      );
      try {
        const cards = await sessionApi.listRequests(which);
        setNow(new Date());
        if (call === latest.current[which])
          setLists((prev) => ({ ...prev, [which]: { phase: 'ready', cards } }));
      } catch (error) {
        // Sessão recusada: refreshMe leva para o login.
        if (error instanceof ApiError && error.status === 401)
          void refreshMe().catch(() => undefined);
        if (call === latest.current[which]) {
          setLists((prev) =>
            // Com uma lista já na tela, a falha de atualizar não a apaga.
            prev[which]?.phase === 'ready' ? prev : { ...prev, [which]: { phase: 'error' } },
          );
        }
      }
    },
    [refreshMe],
  );

  // Ao voltar para a aba (ex.: depois do detalhe), a lista e a fila se atualizam.
  useFocusEffect(
    useCallback(() => {
      void load(filter);
      void reloadQueue();
    }, [filter, load, reloadQueue]),
  );

  // A fila enviou algo sozinha (ex.: a rede voltou): a lista busca as solicitações novas.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(
    () =>
      onOutboxSynced(({ sent }) => {
        if (sent > 0) void load(filterRef.current);
      }),
    [load],
  );

  const state = lists[filter] ?? { phase: 'loading' };
  const serverCards = state.phase === 'ready' ? state.cards : null;
  const { sent, forgetSent } = queue;
  // A lista do servidor trouxe as enviadas: os cartões delas saem da fila em memória.
  useEffect(() => {
    if (!serverCards) return;
    const settled = settledSentRequests(sent, serverCards);
    if (settled.length > 0) forgetSent(settled);
  }, [serverCards, sent, forgetSent]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(filter), queue.reload()]);
    setRefreshing(false);
  };

  // As da fila ainda não têm status da prefeitura: entram em "Todas" e "Em andamento". Uma
  // enviada fica com o cartão da fila até a lista do servidor trazê-la.
  const queued =
    filter === 'done'
      ? []
      : queue.withSent(serverCards).map((item) => toQueuedCardModel(item, now));
  const rows: Row[] = [
    ...queued.map((model): Row => ({ kind: 'queued', model })),
    ...(state.phase === 'ready'
      ? state.cards.map((card): Row => ({ kind: 'request', model: toCardModel(card, now) }))
      : []),
  ];

  const header = (
    <View style={styles.headerBlock}>
      {showAccessEnded ? (
        <View style={styles.accessEnded} accessible accessibilityRole="alert">
          <CircleAlert size={20} color={colors.warning} />
          <Text style={styles.accessEndedText}>{AGENT_ACCESS_ENDED_NOTICE}</Text>
        </View>
      ) : null}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleTexts}>
            {me ? <Text style={styles.hello}>Olá, {firstName(me.name)}</Text> : null}
            <Text style={styles.title} accessibilityRole="header">
              Minhas solicitações
            </Text>
          </View>
          {isAgent ? <ModePill mode="citizen" onPress={() => void setMode('agent')} /> : null}
        </View>
        {city ? <CityChip label={`Você está em ${city}`} /> : null}
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>
    </View>
  );

  // Carregando e erro aparecem mesmo com itens da fila na tela: embaixo deles, no rodapé.
  const listState =
    state.phase === 'loading' ? (
      <View style={styles.state}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Carregando" />
      </View>
    ) : state.phase === 'error' ? (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Não foi possível carregar as solicitações</Text>
        <Text style={styles.stateText}>Confira sua internet e tente de novo.</Text>
        <SecondaryButton label="Tentar de novo" onPress={() => void load(filter)} size="medium" />
      </View>
    ) : null;

  const empty = listState ?? (
    <View style={styles.state}>
      <Text style={styles.stateTitle}>Nenhuma solicitação ainda</Text>
      <Text style={styles.stateText}>
        Toque em Nova para avisar a prefeitura sobre um problema.
      </Text>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.model.key}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={rows.length > 0 ? (listState ?? undefined) : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 20 }]}
        ItemSeparatorComponent={Separator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item: row }) =>
          row.kind === 'request' ? (
            <View style={styles.item}>
              <RequestCard
                view={row.model}
                highlighted={row.model.needsAction}
                onPress={() => router.push(row.model.href as Href)}
                action={
                  row.model.needsAction
                    ? {
                        label: 'Ver atendimento e confirmar',
                        onPress: () => router.push(row.model.href as Href),
                      }
                    : undefined
                }
              />
            </View>
          ) : (
            <View style={styles.item}>
              <RequestCard view={row.model}>
                {row.model.rejectionReason ? (
                  <Text style={styles.reason}>{row.model.rejectionReason}</Text>
                ) : null}
                {row.model.canRemove ? (
                  <TextButton
                    label="Remover"
                    variant="danger"
                    onPress={() => void queue.remove(row.model.id)}
                    style={styles.remove}
                  />
                ) : null}
              </RequestCard>
            </View>
          )
        }
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  headerBlock: { gap: 8, paddingBottom: 16 },
  header: { paddingTop: 4, paddingHorizontal: space.gutter, paddingBottom: 8, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleTexts: { flex: 1, gap: 8 },
  accessEnded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.gutter,
    marginTop: 4,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  accessEndedText: {
    flex: 1,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.warningStrong,
  },
  hello: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: space.gutter,
  },
  item: { paddingHorizontal: space.gutter },
  separator: { height: 16 },
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
  reason: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.danger },
  remove: { alignSelf: 'flex-start', paddingHorizontal: 0 },
});
