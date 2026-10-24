import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MoveHorizontal, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { parseGalleryPhotos } from '../../citizen/detail-view';
import { Screen } from '../../ui/Screen';
import { colors, fonts } from '../../ui/theme';

/** Foto do Pencil: 334x420, com as bordas das vizinhas aparecendo. */
const PHOTO_WIDTH = 334;
const PHOTO_HEIGHT = 420;
const PEEK = 28;
const GAP = 8;

/** Tela 7 · Galeria de fotos: recebe as fotos (JSON) e o índice inicial por parâmetro. */
export default function Galeria() {
  const params = useLocalSearchParams<{ photos?: string; index?: string }>();
  const photos = useMemo(() => parseGalleryPhotos(params.photos), [params.photos]);
  const start = Math.min(Math.max(Number(params.index) || 0, 0), Math.max(photos.length - 1, 0));
  const [index, setIndex] = useState(start);
  const { width, height } = useWindowDimensions();

  const itemWidth = Math.min(PHOTO_WIDTH, width - PEEK * 2);
  // Em tela baixa (ou com fonte grande), a foto encolhe para o rodapé caber.
  const itemHeight = Math.min(PHOTO_HEIGHT, Math.max(200, height - 360));
  const interval = itemWidth + GAP;
  const side = (width - itemWidth) / 2;
  const current = photos[index];

  return (
    <Screen edges={['top', 'bottom']} background={colors.galleryBg}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <X size={22} color={colors.onPrimary} />
        </Pressable>
        <Text style={styles.counter} accessibilityLiveRegion="polite">
          {photos.length > 0 ? `${index + 1} de ${photos.length}` : ''}
        </Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.stage}>
        <View style={{ height: itemHeight }}>
          <FlatList
            data={photos}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(photo, i) => `${i}-${photo.url}`}
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({ length: interval, offset: interval * i, index: i })}
            snapToInterval={interval}
            decelerationRate="fast"
            disableIntervalMomentum
            contentContainerStyle={{ paddingHorizontal: side - GAP / 2 }}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / interval);
              setIndex(Math.min(Math.max(next, 0), photos.length - 1));
            }}
            renderItem={({ item, index: i }) => (
              <View style={{ width: interval, alignItems: 'center' }}>
                <Image
                  source={{ uri: item.url }}
                  resizeMode="cover"
                  style={[styles.photo, { width: itemWidth, height: itemHeight }]}
                  accessibilityLabel={`${item.caption}, foto ${i + 1} de ${photos.length}`}
                />
              </View>
            )}
          />
        </View>
      </View>

      <View style={styles.footer}>
        {photos.length > 1 ? (
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
            {photos.map((photo, i) => (
              <View
                key={`${i}-${photo.url}`}
                style={[styles.dot, i === index ? styles.dotActive : styles.dotIdle]}
              />
            ))}
          </View>
        ) : null}
        {current ? (
          <View style={styles.texts}>
            <Text style={styles.caption}>{current.caption}</Text>
            <Text style={styles.meta}>{current.meta}</Text>
          </View>
        ) : null}
        {photos.length > 1 ? (
          <View style={styles.hint}>
            <MoveHorizontal size={18} color={colors.galleryText} />
            <Text style={styles.meta}>Deslize para ver as outras fotos</Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.galleryButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: { opacity: 0.7 },
  counter: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.bodySemibold,
    fontSize: 17,
    color: colors.onPrimary,
  },
  spacer: { width: 44, height: 44 },
  stage: { flex: 1, justifyContent: 'center' },
  photo: { borderRadius: 12, backgroundColor: colors.galleryEdge },
  footer: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
  dotActive: { width: 24, backgroundColor: colors.onPrimary },
  dotIdle: { width: 8, backgroundColor: colors.galleryDot },
  texts: { gap: 4 },
  caption: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.onPrimary },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.galleryText, flexShrink: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
