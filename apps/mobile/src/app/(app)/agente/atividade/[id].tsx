import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Camera, CircleCheck, Info, OctagonAlert, Play } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { toAgentDetail, type AgentDetailView } from '../../../../agent/detail-view';
import { useAgentWorkOrder } from '../../../../agent/use-agent-work-order';
import { homeFor } from '../../../../auth/app-mode';
import { OUTBOX_OWNER_KEY } from '../../../../auth/login-flow';
import { useSession } from '../../../../auth/use-session';
import { createActionLock } from '../../../../lib/action-lock';
import { isOnline } from '../../../../lib/net-info';
import { openRoute } from '../../../../lib/open-route';
import { secureStore } from '../../../../lib/secure-store';
import { submitWorkOrderAction } from '../../../../offline/outbox-service';
import { useOutbox } from '../../../../offline/use-outbox-sync';
import { PrimaryButton, SecondaryButton } from '../../../../ui/Button';
import { Footer } from '../../../../ui/Footer';
import { Header } from '../../../../ui/Header';
import { PhotoStack } from '../../../../ui/PhotoStack';
import { Screen } from '../../../../ui/Screen';
import { LocationCard } from '../../../../ui/agent/LocationCard';
import { ManagerCard } from '../../../../ui/agent/ManagerCard';
import { ReportList } from '../../../../ui/agent/ReportList';
import { colors, fonts, space } from '../../../../ui/theme';

const HOME_ROUTE = homeFor('agent');
const GALLERY_ROUTE = '/(app)/galeria';

const photosLabel = (n: number) => (n === 1 ? '1 foto' : `${n} fotos`);

/** Volta à A1 (que fica montada embaixo, com Lista ou Mapa como estava). */
const backToList = () => (router.canGoBack() ? router.back() : router.replace(HOME_ROUTE as Href));

/** A2 · Detalhe da atividade e A5 · Ajuste pedido pelo gestor. */
export default function DetalheAtividade() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const { items: queue } = useOutbox();
  const { state, here, now, reload } = useAgentWorkOrder(id);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Toque duplo em "Iniciar atendimento" não enfileira duas vezes.
  const [lock] = useState(createActionLock);

  const detail = state.phase === 'ready' ? state.detail : null;
  const view = useMemo(
    () => (detail ? toAgentDetail(detail, { here, queue, now }) : null),
    [detail, here, queue, now],
  );

  if (!detail || !view) {
    return (
      <Screen>
        <Header nav="back" onNavPress={backToList} />
        <View style={styles.state}>
          {state.phase === 'loading' ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              accessibilityLabel="Carregando"
            />
          ) : state.phase === 'gone' ? (
            <>
              <Text style={styles.stateTitle}>Esta atividade não está mais com você</Text>
              <Text style={styles.stateText}>
                Ela foi concluída, cancelada ou passada para outra equipe.
              </Text>
              <SecondaryButton
                label="Voltar para minhas atividades"
                size="medium"
                onPress={backToList}
              />
            </>
          ) : (
            <>
              <Text style={styles.stateTitle}>Não foi possível carregar a atividade</Text>
              <Text style={styles.stateText}>Confira sua internet e tente de novo.</Text>
              <SecondaryButton label="Tentar de novo" size="medium" onPress={() => void reload()} />
            </>
          )}
        </View>
      </Screen>
    );
  }

  /** Iniciar: sempre pela fila (com ou sem rede); a A1 mostra "Em execução" na hora. */
  const start = () =>
    lock.run(async () => {
      setActionError(null);
      setStarting(true);
      try {
        const userId = me?.id ?? (await secureStore.getItem(OUTBOX_OWNER_KEY)) ?? '';
        await submitWorkOrderAction({
          tenantId: detail.tenantId,
          workOrderId: detail.id,
          action: 'start',
          online: await isOnline(),
          userId,
          display: { categoryName: detail.categoryName, address: detail.address },
        });
        backToList();
      } catch (error) {
        console.warn('Falha ao iniciar o atendimento', error);
        setActionError('Não foi possível iniciar. Tente de novo.');
      } finally {
        setStarting(false);
      }
    });

  const goTo = (step: 'concluir' | 'impedimento') =>
    router.push(`/(app)/agente/atividade/${detail.id}/${step}` as Href);

  const openGallery = (index: number) =>
    router.push({
      pathname: GALLERY_ROUTE,
      params: { photos: JSON.stringify(view.photos.gallery), index: String(index) },
    } as Href);

  return (
    <Screen>
      <Header nav="back" onNavPress={backToList} title={view.title} subtitle={view.subtitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {view.readOnlyNote ? (
          <View style={styles.note} accessible accessibilityRole="text">
            <Info size={18} color={colors.textSecondary} />
            <Text style={styles.noteText}>{view.readOnlyNote}</Text>
          </View>
        ) : null}
        <ManagerCard view={view.manager} />
        <LocationCard
          address={view.location.address}
          distance={view.location.distance}
          onOpenRoute={() => void openRoute(detail.location, detail.address)}
        />
        {view.photos.count > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Fotos dos cidadãos
            </Text>
            <PhotoStack
              uri={view.photos.cover}
              count={view.photos.count}
              onPress={() => openGallery(0)}
              accessibilityLabel={`Fotos dos cidadãos, ${photosLabel(view.photos.count)}. Abrir galeria`}
            />
          </View>
        ) : null}
        {view.reports.shown.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              O que os cidadãos disseram
            </Text>
            <ReportList reports={view.reports.shown} />
            {view.reports.moreLabel ? (
              <Pressable
                onPress={() => router.push(`/(app)/agente/atividade/${detail.id}/relatos` as Href)}
                accessibilityRole="link"
                accessibilityLabel={view.reports.moreLabel}
                hitSlop={4}
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}
              >
                <Text style={styles.moreText}>{view.reports.moreLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <DetailFooter
        view={view}
        starting={starting}
        error={actionError}
        onStart={() => void start()}
        onComplete={() => goTo('concluir')}
        onImpediment={() => goTo('impedimento')}
      />
    </Screen>
  );
}

interface DetailFooterProps {
  view: AgentDetailView;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onComplete: () => void;
  onImpediment: () => void;
}

/** Rodapé: Iniciar / Concluir / Enviar novas fotos + "Não consigo resolver"; só leitura: nenhum. */
function DetailFooter({
  view,
  starting,
  error,
  onStart,
  onComplete,
  onImpediment,
}: DetailFooterProps) {
  if (view.footer === null || view.primaryLabel === null) return null;
  const icon =
    view.footer === 'start'
      ? Play
      : view.primaryLabel === 'Enviar novas fotos'
        ? Camera
        : CircleCheck;
  return (
    <Footer>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={view.primaryLabel}
        icon={icon}
        onPress={view.footer === 'start' ? onStart : onComplete}
        loading={starting}
      />
      <SecondaryButton
        label="Não consigo resolver"
        icon={OctagonAlert}
        iconColor={colors.warning}
        onPress={onImpediment}
        disabled={starting}
      />
    </Footer>
  );
}

const styles = StyleSheet.create({
  // Pencil: padding 8/20/24/20, gap 22.
  content: {
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
    gap: 22,
  },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.textPrimary },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.primary },
  pressed: { opacity: 0.6 },
  error: { fontFamily: fonts.body, fontSize: 15, color: colors.danger, textAlign: 'center' },
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
