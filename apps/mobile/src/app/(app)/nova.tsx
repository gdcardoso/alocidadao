import {
  MAX_PHOTOS_PER_REQUEST,
  type CategoryOption as Category,
  type GeoPoint,
  type LocateResponse,
  type SimilarOccurrence,
} from '@alocidadao/shared';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { router, useFocusEffect, useNavigation, usePreventRemove, type Href } from 'expo-router';
import {
  HandHeart,
  MapPin,
  MessageSquarePlus,
  Plus,
  Send,
  Trash2,
  Users,
  WifiOff,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { OUTBOX_OWNER_KEY } from '../../auth/login-flow';
import { sessionApi } from '../../auth/native-session';
import { useSession } from '../../auth/use-session';
import { takeAdjustedLocation } from '../../citizen/adjust-channel';
import {
  MAX_DESCRIPTION_LENGTH,
  buildCreateInput,
  canSubmit,
  closestSimilar,
  decideFlow,
  formatAddress,
  formatCoordinates,
  hasDraftData,
  reportCountLabel,
  type NewRequestDraft,
} from '../../citizen/new-request';
import { PlaceCache, placeFromLocate } from '../../citizen/place-cache';
import { requestHref } from '../../citizen/requests-view';
import { PhotoCapture } from '../../components/photo-capture';
import { getCurrentPoint } from '../../lib/location';
import { secureStore } from '../../lib/secure-store';
import type { OutboxMunicipality } from '../../offline/outbox';
import { submitCreateRequest } from '../../offline/outbox-service';
import {
  clearDraftPhotos,
  keepDraftPhoto,
  openAppDatabase,
} from '../../offline/sqlite-outbox-store';
import { BottomSheet } from '../../ui/BottomSheet';
import { PrimaryButton, SecondaryButton } from '../../ui/Button';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { CategoryOption } from '../../ui/CategoryOption';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldLabel } from '../../ui/FieldLabel';
import { Footer } from '../../ui/Footer';
import { Header } from '../../ui/Header';
import { Screen } from '../../ui/Screen';
import { StatusBadge } from '../../ui/StatusBadge';
import { TextField } from '../../ui/TextField';
import { colors, fonts, radius, space } from '../../ui/theme';

const PERMISSION_ROUTE = '/(app)/permissao-local';
const NOT_SERVED_ROUTE = '/(app)/nao-atende';
const ADJUST_ROUTE = '/(app)/ajustar-local';
const HOME_ROUTE = '/(app)/(tabs)/solicitacoes';

const SEND_ERROR = 'Não foi possível enviar a solicitação. Tente de novo.';
const CATEGORY_UNAVAILABLE = 'Este tipo de solicitação não está disponível nesta cidade.';

type LocationPhase = 'locating' | 'ready' | 'unavailable';
type CategoriesState =
  { phase: 'loading' } | { phase: 'ready'; list: Category[] } | { phase: 'missing' };

const isOnline = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
};

async function addressFor(point: GeoPoint): Promise<string | null> {
  try {
    const [first] = await Location.reverseGeocodeAsync({
      latitude: point.lat,
      longitude: point.lng,
    });
    return first ? formatAddress(first) : null;
  } catch {
    // Sem rede ou sem serviço de endereço: a tela mostra as coordenadas.
    return null;
  }
}

/** Tela 5 · Nova solicitação, com o painel 5b de relato parecido. */
export default function NovaSolicitacao() {
  const { me } = useSession();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const photoWidth = width - space.gutter * 2;

  const [draft, setDraft] = useState<NewRequestDraft>({
    photos: [],
    category: null,
    gps: null,
    location: null,
    address: null,
    description: '',
  });
  const [locationPhase, setLocationPhase] = useState<LocationPhase>('locating');
  const [categories, setCategories] = useState<CategoriesState>({ phase: 'loading' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarOccurrence | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Saída da tela já decidida: libera o "Fechar" sem confirmação e navega no efeito.
  const [exit, setExit] = useState<(() => void) | null>(null);
  const pendingRemoval = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const photoScroll = useRef<ScrollViewInstance>(null);

  const dirty = hasDraftData(draft);

  usePreventRemove(dirty && exit === null, ({ data }) => {
    pendingRemoval.current = data.action;
    setConfirmDiscard(true);
  });

  useEffect(() => {
    exit?.();
  }, [exit]);

  const leave = useCallback((go: () => void) => setExit(() => go), []);

  const goNotServed = useCallback(
    (municipality: OutboxMunicipality | null) => {
      setCameraOpen(false);
      leave(() =>
        router.replace({
          pathname: NOT_SERVED_ROUTE,
          params: municipality
            ? {
                name: municipality.name,
                state: municipality.state,
                ibgeCode: municipality.ibgeCode,
              }
            : {},
        } as Href),
      );
    },
    [leave],
  );

  /** Tipos da prefeitura do ponto; sem rede (ou sem resposta), os da última prefeitura. */
  const loadCategories = useCallback(
    async (point: GeoPoint | null) => {
      const db = await openAppDatabase();
      const cache = new PlaceCache(db);
      if (point && (await isOnline())) {
        let locate: LocateResponse | null = null;
        try {
          locate = await sessionApi.locate(point);
        } catch {
          locate = null;
        }
        if (locate?.status === 'not_served') {
          goNotServed(locate.municipality);
          return;
        }
        if (locate?.status === 'served') {
          setCategories({ phase: 'ready', list: locate.categories });
          await cache.save(placeFromLocate(locate, Date.now())).catch(() => undefined);
          return;
        }
      }
      const cached = await cache.load().catch(() => null);
      setCategories(cached ? { phase: 'ready', list: cached.categories } : { phase: 'missing' });
    },
    [goNotServed],
  );

  const locate = useCallback(async () => {
    setLocationPhase('locating');
    const current = await getCurrentPoint();
    if ('error' in current) {
      setLocationPhase('unavailable');
      await loadCategories(null);
      return;
    }
    const { point } = current;
    setDraft((d) => ({ ...d, gps: point, location: point, address: null }));
    setLocationPhase('ready');
    void addressFor(point).then((address) =>
      setDraft((d) => (d.location === point ? { ...d, address } : d)),
    );
    await loadCategories(point);
  }, [loadCategories]);

  // Abertura: sem permissão de localização, vai para a tela que pede; com ela, abre a câmera
  // e lê o local ao mesmo tempo.
  useEffect(() => {
    let active = true;
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!active) return;
      if (!permission.granted) {
        leave(() => router.replace(PERMISSION_ROUTE as Href));
        return;
      }
      setCameraOpen(true);
      await locate();
    })();
    return () => {
      active = false;
    };
  }, [leave, locate]);

  // Volta do mapa com o ponto ajustado.
  useFocusEffect(
    useCallback(() => {
      const adjusted = takeAdjustedLocation();
      if (!adjusted) return;
      setDraft((d) => ({ ...d, location: adjusted, address: null }));
      void addressFor(adjusted).then((address) =>
        setDraft((d) => (d.location === adjusted ? { ...d, address } : d)),
      );
    }, []),
  );

  const addPhoto = async (uri: string) => {
    setCameraOpen(false);
    let kept: string;
    try {
      kept = await keepDraftPhoto(uri);
    } catch (e) {
      console.warn('Falha ao guardar a foto', e);
      setError('Não foi possível guardar a foto. Tente de novo.');
      return;
    }
    setDraft((d) => {
      const photos = [...d.photos, kept].slice(0, MAX_PHOTOS_PER_REQUEST);
      setPhotoIndex(photos.length - 1);
      return { ...d, photos };
    });
  };

  // As fotos de rascunho de uma tela anterior não servem mais; ao sair, as desta também não.
  useEffect(() => {
    clearDraftPhotos();
    return clearDraftPhotos;
  }, []);

  // Mostra a foto nova (ou a anterior, depois de remover).
  useEffect(() => {
    photoScroll.current?.scrollTo({ x: photoIndex * photoWidth, animated: false });
  }, [photoIndex, photoWidth]);

  const removePhoto = () => {
    const photos = draft.photos.filter((_, i) => i !== photoIndex);
    setDraft((d) => ({ ...d, photos }));
    setPhotoIndex(Math.max(0, Math.min(photoIndex, photos.length - 1)));
  };

  const close = () => {
    if (dirty) setConfirmDiscard(true);
    else router.back();
  };

  const discard = () => {
    setConfirmDiscard(false);
    const action = pendingRemoval.current;
    pendingRemoval.current = null;
    leave(() => (action ? navigation.dispatch(action) : router.back()));
  };

  /** Guarda na fila e, com rede, envia na hora. */
  const send = async (online: boolean, occurrenceId?: string) => {
    const payload = buildCreateInput(draft, new Date(), {
      clientActionId: randomUUID(),
      ...(occurrenceId ? { occurrenceId } : {}),
    });
    const userId = me?.id ?? (await secureStore.getItem(OUTBOX_OWNER_KEY)) ?? '';
    const { outcome } = await submitCreateRequest({
      userId,
      payload,
      photoUris: draft.photos,
      online,
    });
    if (!outcome || outcome.kind === 'retry') {
      // Na fila: a tela 4 mostra o item no topo, "Aguardando internet".
      leave(() => router.dismissTo(HOME_ROUTE as Href));
      return;
    }
    if (outcome.kind === 'sent' && outcome.result) {
      const href = requestHref(outcome.result.requestId) as Href;
      leave(() => router.replace(href));
      return;
    }
    if (outcome.kind === 'rejected' && outcome.rejection.code === 'municipality_not_served') {
      goNotServed(outcome.rejection.municipality ?? null);
      return;
    }
    setError(
      outcome.kind === 'rejected' && outcome.rejection.code === 'category_unavailable'
        ? CATEGORY_UNAVAILABLE
        : SEND_ERROR,
    );
  };

  const submit = async () => {
    if (!canSubmit(draft) || sending || !draft.location || !draft.category) return;
    setSending(true);
    setError(null);
    try {
      const online = await isOnline();
      let located: LocateResponse | null = null;
      let found: SimilarOccurrence[] = [];
      if (online) {
        try {
          located = await sessionApi.locate(draft.location);
          if (located.status === 'served') {
            found = await sessionApi
              .similar({ ...draft.location, categoryId: draft.category.id })
              .catch(() => []);
          }
        } catch {
          // Sem resposta da API: o relato vai para a fila.
          located = null;
        }
      }
      const flow = decideFlow(online, located, found);
      if (flow === 'not_served' && located?.status === 'not_served') {
        goNotServed(located.municipality);
      } else if (flow === 'pick_similar') {
        // Com o painel aberto, nada é enviado até a escolha.
        setSimilar(closestSimilar(found));
      } else {
        await send(flow === 'submit');
      }
    } catch (e) {
      console.warn('Falha ao registrar a solicitação', e);
      setError(SEND_ERROR);
    } finally {
      setSending(false);
    }
  };

  const chooseSimilar = async (support: boolean) => {
    const chosen = similar;
    setSimilar(null);
    if (!chosen) return;
    setSending(true);
    setError(null);
    try {
      await send(true, support ? chosen.occurrenceId : undefined);
    } catch (e) {
      console.warn('Falha ao registrar a solicitação', e);
      setError(SEND_ERROR);
    } finally {
      setSending(false);
    }
  };

  const openAdjust = () => {
    if (!draft.gps || !draft.location) return;
    router.push({
      pathname: ADJUST_ROUTE,
      params: {
        gpsLat: String(draft.gps.lat),
        gpsLng: String(draft.gps.lng),
        lat: String(draft.location.lat),
        lng: String(draft.location.lng),
      },
    } as Href);
  };

  const locationText =
    locationPhase === 'locating'
      ? 'Buscando sua localização…'
      : locationPhase === 'unavailable' || !draft.location
        ? 'Não foi possível obter a localização.'
        : (draft.address ?? formatCoordinates(draft.location));

  const categoryList = categories.phase === 'ready' ? categories.list : [];
  const rows: Category[][] = [];
  for (let i = 0; i < categoryList.length; i += 3) rows.push(categoryList.slice(i, i + 3));

  return (
    <Screen>
      <Header nav="close" onNavPress={close} title="Nova solicitação" align="center" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 1. Foto, com as fotos, o contador e o local por cima. */}
          <View style={[styles.photo, { width: photoWidth }]}>
            {draft.photos.length > 0 ? (
              <ScrollView
                ref={photoScroll}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) =>
                  setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / photoWidth))
                }
              >
                {draft.photos.map((uri, i) => (
                  <Image
                    key={uri}
                    source={{ uri }}
                    style={{ width: photoWidth, height: PHOTO_HEIGHT }}
                    resizeMode="cover"
                    accessibilityLabel={`Foto ${i + 1} de ${draft.photos.length}`}
                  />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.photoEmpty}>
                <SecondaryButton
                  label="Adicionar foto"
                  icon={Plus}
                  size="medium"
                  onPress={() => setCameraOpen(true)}
                />
              </View>
            )}
            <Svg width={photoWidth} height={120} style={styles.gradient} pointerEvents="none">
              <Defs>
                <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#0F172A" stopOpacity="0" />
                  <Stop offset="1" stopColor="#0F172A" stopOpacity="0.85" />
                </LinearGradient>
              </Defs>
              <Rect width={photoWidth} height={120} fill="url(#fade)" />
            </Svg>

            {draft.photos.length > 0 ? (
              <View style={styles.photoTop}>
                <View style={styles.photosPill}>
                  <Text style={styles.photosCount}>
                    {draft.photos.length} de {MAX_PHOTOS_PER_REQUEST}
                  </Text>
                  {draft.photos.length < MAX_PHOTOS_PER_REQUEST ? (
                    <Pressable
                      onPress={() => setCameraOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar foto"
                      hitSlop={6}
                      style={styles.addPhoto}
                    >
                      <Plus size={18} color={colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={removePhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Remover foto"
                  style={styles.removePhoto}
                >
                  <Trash2 size={18} color={colors.onPrimary} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.locationPill}>
              <MapPin size={20} color={colors.primary} />
              <Text style={styles.locationText} numberOfLines={2}>
                {locationText}
              </Text>
              {locationPhase === 'locating' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : locationPhase === 'unavailable' ? (
                <Pressable
                  onPress={() => void locate()}
                  accessibilityRole="button"
                  style={styles.adjust}
                >
                  <Text style={styles.adjustText}>Tentar de novo</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={openAdjust}
                  accessibilityRole="button"
                  accessibilityLabel="Ajustar local"
                  style={styles.adjust}
                >
                  <Text style={styles.adjustText}>Ajustar</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* 2. Tipo de solicitação. */}
          <View style={styles.section}>
            <FieldLabel label="Tipo de solicitação" requirement="required" section />
            {categories.phase === 'loading' ? (
              <ActivityIndicator color={colors.primary} accessibilityLabel="Carregando" />
            ) : categories.phase === 'missing' ? (
              <Text style={styles.notice}>
                Conecte-se à internet para carregar os tipos de solicitação.
              </Text>
            ) : (
              <View style={styles.grid} accessibilityRole="radiogroup">
                {rows.map((row) => (
                  <View key={row[0]!.id} style={styles.gridRow}>
                    {row.map((c) => (
                      <CategoryOption
                        key={c.id}
                        name={c.name}
                        icon={c.icon}
                        group={c.iconGroup}
                        selected={draft.category?.id === c.id}
                        onPress={() => setDraft((d) => ({ ...d, category: c }))}
                      />
                    ))}
                    {Array.from({ length: 3 - row.length }, (_, i) => (
                      <View key={`empty-${i}`} style={styles.flex} />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 3. Observação opcional. */}
          {noteOpen ? (
            <TextField
              label="Observação"
              requirement="optional"
              multiline
              autoFocus
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={draft.description}
              onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
            />
          ) : (
            <Pressable
              onPress={() => setNoteOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Adicionar observação, opcional"
              style={({ pressed }) => [styles.noteRow, pressed && styles.noteRowPressed]}
            >
              <MessageSquarePlus size={22} color={colors.primary} />
              <Text style={styles.noteText}>Adicionar observação</Text>
              <Text style={styles.optional}>opcional</Text>
            </Pressable>
          )}
        </ScrollView>

        <Footer>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Enviar solicitação"
            icon={Send}
            onPress={() => void submit()}
            disabled={!canSubmit(draft)}
            loading={sending}
          />
          <View style={styles.offline}>
            <WifiOff size={16} color={colors.textSecondary} />
            <Text style={styles.offlineText}>Sem internet? Enviamos assim que conectar.</Text>
          </View>
        </Footer>
      </KeyboardAvoidingView>

      <PhotoCapture
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(photo) => void addPhoto(photo.uri)}
      />

      {/* 5b · Já relataram aqui. */}
      <BottomSheet visible={similar !== null} onClose={() => setSimilar(null)}>
        {similar ? (
          <>
            <View style={styles.sheetTexts}>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                Já relataram isso aqui perto
              </Text>
              <Text style={styles.sheetText}>
                Se for o mesmo problema, apoie o relato existente. Você acompanha o atendimento e
                recebe os avisos do mesmo jeito.
              </Text>
            </View>
            <View style={styles.similarCard}>
              <View style={styles.similarTop}>
                <CategoryIcon icon={similar.icon} group={similar.iconGroup} />
                <View style={styles.flex}>
                  <Text style={styles.similarName}>{similar.categoryName}</Text>
                  <Text style={styles.similarMeta}>A {similar.distanceM} m de você</Text>
                </View>
              </View>
              <View style={styles.similarChips}>
                <View style={styles.reportChip}>
                  <Users size={16} color={colors.textPrimary} />
                  <Text style={styles.reportChipText}>{reportCountLabel(similar.reportCount)}</Text>
                </View>
                <StatusBadge status={similar.status === 'in_progress' ? 'in_progress' : 'open'} />
              </View>
            </View>
            <View style={styles.sheetButtons}>
              <PrimaryButton
                label="É o mesmo, apoiar relato"
                icon={HandHeart}
                onPress={() => void chooseSimilar(true)}
              />
              <SecondaryButton
                label="Não, é outro problema"
                onPress={() => void chooseSimilar(false)}
              />
            </View>
          </>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDiscard}
        title="Descartar esta solicitação?"
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        destructive
        onConfirm={discard}
        onCancel={() => {
          pendingRemoval.current = null;
          setConfirmDiscard(false);
        }}
      />
    </Screen>
  );
}

const PHOTO_HEIGHT = 230;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 8, paddingHorizontal: space.gutter, paddingBottom: 24, gap: 24 },
  photo: {
    height: PHOTO_HEIGHT,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.galleryText,
  },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 56 },
  gradient: { position: 'absolute', left: 0, bottom: 0 },
  photoTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photosPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: colors.photoOverlay,
    paddingLeft: 14,
    paddingRight: 6,
  },
  photosCount: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.onPrimary },
  addPhoto: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.photoOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationPill: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.glass,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  locationText: {
    flex: 1,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  adjust: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.primary },
  section: { gap: 12 },
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  notice: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  noteRow: {
    minHeight: 56,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  noteRowPressed: { backgroundColor: colors.bg },
  noteText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  optional: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  error: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.danger,
    textAlign: 'center',
  },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  offlineText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  sheetTexts: { gap: 8 },
  sheetTitle: { fontFamily: fonts.heading, fontSize: 22, color: colors.textPrimary },
  sheetText: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  similarCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderInput,
    padding: 16,
    gap: 14,
  },
  similarTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  similarName: { fontFamily: fonts.bodySemibold, fontSize: 17, color: colors.textPrimary },
  similarMeta: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  similarChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reportChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.digit,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  reportChipText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.textPrimary },
  sheetButtons: { gap: 12 },
});
