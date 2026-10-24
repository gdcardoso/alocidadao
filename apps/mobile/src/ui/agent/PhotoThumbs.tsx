import { Camera, X } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, space } from '../theme';

export interface PhotoThumbsProps {
  photos: readonly string[];
  /** Máximo de fotos: com ele, o "Tirar foto" some. */
  max: number;
  onRemove: (index: number) => void;
  /** Sem `onAdd`, só as miniaturas (a A4 tem o próprio botão). */
  onAdd?: () => void;
  disabled?: boolean;
}

const THUMB = 104;
const GAP = 10;
/** Três por linha (o máximo da conclusão), também na A4. */
const COLUMNS = 3;

/**
 * Miniaturas 104x104 (raio 16) com o `x` de remover e o quadro "Tirar foto" (A3). Em tela
 * estreita as três miniaturas encolhem para caber numa linha.
 */
export function PhotoThumbs({ photos, max, onRemove, onAdd, disabled = false }: PhotoThumbsProps) {
  const { width } = useWindowDimensions();
  const size = Math.min(
    THUMB,
    Math.floor((width - space.gutter * 2 - GAP * (COLUMNS - 1)) / COLUMNS),
  );
  const box = { width: size, height: size };
  return (
    <View style={styles.row}>
      {photos.map((uri, i) => (
        <View key={uri} style={[styles.thumb, box]}>
          <Image
            source={{ uri }}
            style={styles.image}
            accessibilityLabel={`Foto ${i + 1} de ${photos.length}`}
          />
          <Pressable
            onPress={() => onRemove(i)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Remover foto ${i + 1}`}
            style={styles.remove}
          >
            {({ pressed }) => (
              <View style={[styles.removeCircle, pressed && styles.removePressed]}>
                <X size={16} color={colors.onPrimary} />
              </View>
            )}
          </Pressable>
        </View>
      ))}
      {onAdd && photos.length < max ? (
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Tirar foto"
          style={({ pressed }) => [styles.add, box, pressed && styles.addPressed]}
        >
          <Camera size={24} color={colors.primary} />
          <Text style={styles.addLabel}>Tirar foto</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  thumb: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.galleryText },
  image: { width: '100%', height: '100%' },
  // Área de toque de 44 no canto; o círculo visível é menor para não cobrir a foto.
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.photoOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { backgroundColor: colors.textPrimary },
  add: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  addPressed: { backgroundColor: colors.primarySoft },
  addLabel: {
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    color: colors.primary,
    textAlign: 'center',
  },
});
