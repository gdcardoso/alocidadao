import { ApiError } from '@alocidadao/api-client';
import type { RequestDetail } from '@alocidadao/shared';
import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { CircleX, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { homeFor } from '../../../auth/app-mode';
import { sessionApi } from '../../../auth/native-session';
import { useSession } from '../../../auth/use-session';
import {
  NO_NETWORK_MESSAGE,
  actionFailure,
  toDetailModel,
  toGalleryPhotos,
  type DetailModel,
} from '../../../citizen/detail-view';
import { createActionLock } from '../../../lib/action-lock';
import { isOnline } from '../../../lib/net-info';
import { PrimaryButton, SecondaryButton } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Footer } from '../../../ui/Footer';
import { Header } from '../../../ui/Header';
import { PhotoStack } from '../../../ui/PhotoStack';
import { Screen } from '../../../ui/Screen';
import { StatusNotice } from '../../../ui/StatusNotice';
import { TeamReport } from '../../../ui/TeamReport';
import { Timeline } from '../../../ui/Timeline';
import { colors, fonts, radius, space } from '../../../ui/theme';

// Fluxo do cidadão: volta sempre à lista do cidadão.
const HOME_ROUTE = homeFor('citizen');
const GALLERY_ROUTE = '/(app)/galeria';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'not_found' }
  | { phase: 'ready'; detail: RequestDetail };

const photosLabel = (n: number) => (n === 1 ? '1 foto' : `${n} fotos`);

/** Telas 6a–6d · Detalhe da solicitação. */
export default function DetalheSolicitacao() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshMe } = useSession();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [busy, setBusy] = useState<'cancel' | 'confirm' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const latest = useRef(0);
  // Toque duplo em cancelar, confirmar ou contestar não dispara a ação duas vezes.
  const [lock] = useState(createActionLock);

  const load = useCallback(async () => {
    const call = ++latest.current;
    try {
      const detail = await sessionApi.getRequest(id);
      if (call === latest.current) setState({ phase: 'ready', detail });
    } catch (error) {
      // Sessão recusada: refreshMe leva para o login.
      if (error instanceof ApiError && error.status === 401)
        void refreshMe().catch(() => undefined);
      const missing = error instanceof ApiError && error.status === 404;
      // Com o detalhe já na tela, a falha de atualizar não o apaga.
      if (call === latest.current)
        setState((prev) =>
          missing ? { phase: 'not_found' } : prev.phase === 'ready' ? prev : { phase: 'error' },
        );
    }
  }, [id, refreshMe]);

  // Ao abrir e ao voltar da galeria ou da contestação.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace(HOME_ROUTE as Href));

  /** Mostra o erro da ação; sessão recusada volta ao login. */
  const fail = (error: unknown) => {
    const failure = actionFailure(error);
    if (failure.kind === 'session') void refreshMe().catch(() => undefined);
    else setActionError(failure.message);
  };

  /** Cancelar e confirmar: só com rede, e o detalhe se atualiza depois. */
  const act = (kind: 'cancel' | 'confirm') =>
    lock.run(async () => {
      setActionError(null);
      setBusy(kind);
      try {
        if (!(await isOnline())) {
          setActionError(NO_NETWORK_MESSAGE);
          return;
        }
        const body = { clientActionId: randomUUID() };
        if (kind === 'cancel') await sessionApi.cancelRequest(id, body);
        else await sessionApi.confirmRequest(id, body);
        await load();
      } catch (error) {
        fail(error);
        await load();
      } finally {
        setBusy(null);
        setConfirmCancel(false);
      }
    });

  const contest = () =>
    lock.run(async () => {
      setActionError(null);
      if (!(await isOnline())) {
        setActionError(NO_NETWORK_MESSAGE);
        return;
      }
      router.push(`/(app)/solicitacao/${id}/contestar` as Href);
    });

  if (state.phase !== 'ready') {
    return (
      <Screen>
        <Header nav="back" onNavPress={back} />
        <View style={styles.state}>
          {state.phase === 'loading' ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              accessibilityLabel="Carregando"
            />
          ) : state.phase === 'not_found' ? (
            <>
              <Text style={styles.stateTitle}>Solicitação não encontrada</Text>
              <Text style={styles.stateText}>
                Ela não está entre as suas solicitações. Confira a lista.
              </Text>
              <SecondaryButton
                label="Voltar para minhas solicitações"
                size="medium"
                onPress={() => router.replace(HOME_ROUTE as Href)}
              />
            </>
          ) : (
            <>
              <Text style={styles.stateTitle}>Não foi possível carregar a solicitação</Text>
              <Text style={styles.stateText}>Confira sua internet e tente de novo.</Text>
              <SecondaryButton
                label="Tentar de novo"
                size="medium"
                onPress={() => {
                  setState({ phase: 'loading' });
                  void load();
                }}
              />
            </>
          )}
        </View>
      </Screen>
    );
  }

  const model = toDetailModel(state.detail);
  return (
    <Screen>
      <Header nav="back" onNavPress={back} title={model.title} subtitle={model.subtitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <StatusNotice
          tone={model.notice.tone}
          icon={model.notice.icon}
          title={model.notice.title}
          text={model.notice.text}
        />
        <BeforeAfter model={model} />
        {model.report ? (
          <TeamReport
            kind={model.report.kind}
            title={model.report.title}
            date={model.report.date}
            text={model.report.text}
          />
        ) : null}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Sua solicitação
          </Text>
          <View style={styles.facts}>
            {model.facts.map((fact, index) => (
              <View
                key={fact.label}
                style={[styles.fact, index > 0 && styles.factDivider]}
                accessible
              >
                <fact.icon size={20} color={colors.primary} />
                <View style={styles.factTexts}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Andamento
          </Text>
          <Timeline steps={model.steps} />
        </View>
      </ScrollView>

      {model.footer || actionError ? (
        <Footer>
          {actionError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {actionError}
            </Text>
          ) : null}
          {model.footer === 'cancel' ? (
            <SecondaryButton
              label="Cancelar solicitação"
              icon={CircleX}
              variant="danger"
              onPress={() => setConfirmCancel(true)}
              disabled={busy !== null}
            />
          ) : model.footer === 'confirm_contest' ? (
            <>
              <PrimaryButton
                label="Sim, foi resolvido"
                icon={ThumbsUp}
                onPress={() => void act('confirm')}
                loading={busy === 'confirm'}
                disabled={busy !== null}
              />
              <SecondaryButton
                label="Não foi resolvido"
                icon={ThumbsDown}
                onPress={() => void contest()}
                disabled={busy !== null}
              />
            </>
          ) : null}
        </Footer>
      ) : null}

      <ConfirmDialog
        visible={confirmCancel}
        title="Cancelar esta solicitação?"
        confirmLabel="Cancelar solicitação"
        cancelLabel="Voltar"
        destructive
        loading={busy === 'cancel'}
        onConfirm={() => void act('cancel')}
        onCancel={() => setConfirmCancel(false)}
      />
    </Screen>
  );
}

/** "Sua foto" e, depois da conclusão, "Depois do atendimento"; cada pilha abre a galeria. */
function BeforeAfter({ model }: { model: DetailModel }) {
  if (model.before.length === 0 && !model.after) return null;
  const gallery = toGalleryPhotos(model);
  const open = (index: number) =>
    router.push({
      pathname: GALLERY_ROUTE,
      params: { photos: JSON.stringify(gallery), index: String(index) },
    } as Href);
  const columns = [
    { label: 'Sua foto', photos: model.before, start: 0 },
    ...(model.after
      ? [{ label: 'Depois do atendimento', photos: model.after, start: model.before.length }]
      : []),
  ].filter((c) => c.photos.length > 0);
  return (
    <View style={styles.photos}>
      {columns.map((column) => (
        <View key={column.label} style={styles.photoColumn}>
          <Text style={styles.photoLabel}>{column.label}</Text>
          <PhotoStack
            uri={column.photos[0]!.url}
            count={column.photos.length}
            onPress={() => open(column.start)}
            accessibilityLabel={`${column.label}, ${photosLabel(column.photos.length)}. Abrir galeria`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
    gap: space.section,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoColumn: { gap: 8 },
  photoLabel: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.textSecondary },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.textPrimary },
  facts: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fact: { flexDirection: 'row', gap: 12, padding: 16 },
  factDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  factTexts: { flex: 1, gap: 2 },
  factLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  factValue: { fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
  error: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.danger,
    textAlign: 'center',
  },
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
