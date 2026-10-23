import { ApiError } from '@alocidadao/api-client';
import type { RequestCard as RequestCardData, RequestListFilter } from '@alocidadao/shared';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { sessionApi } from '../../../auth/native-session';
import { useSession } from '../../../auth/use-session';
import {
  toCardModel,
  toQueuedCardModel,
  type CardModel,
  type QueuedCardModel,
} from '../../../citizen/requests-view';
import { useCurrentPlace } from '../../../citizen/use-current-place';
import { useQueuedRequests } from '../../../citizen/use-queued-requests';
import { SecondaryButton, TextButton } from '../../../ui/Button';
import { CityChip, FilterChip } from '../../../ui/Chip';
import { firstName } from '../../../ui/format';
import { RequestCard } from '../../../ui/RequestCard';
import { Screen } from '../../../ui/Screen';
import { colors, fonts, space } from '../../../ui/theme';

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
  const { me, refreshMe } = useSession();
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

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(filter), queue.reload()]);
    setRefreshing(false);
  };

  const state = lists[filter] ?? { phase: 'loading' };
  // As da fila ainda não têm status da prefeitura: entram em "Todas" e "Em andamento".
  const queued = filter === 'done' ? [] : queue.items.map((item) => toQueuedCardModel(item, now));
  const rows: Row[] = [
    ...queued.map((model): Row => ({ kind: 'queued', model })),
    ...(state.phase === 'ready'
      ? state.cards.map((card): Row => ({ kind: 'request', model: toCardModel(card, now) }))
      : []),
  ];

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.header}>
        {me ? <Text style={styles.hello}>Olá, {firstName(me.name)}</Text> : null}
        <Text style={styles.title} accessibilityRole="header">
          Minhas solicitações
        </Text>
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
