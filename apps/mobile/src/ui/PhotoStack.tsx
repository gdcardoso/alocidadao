import { Images } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

export interface PhotoStackProps {
  /** Primeira foto; sem ela, o espaço da foto fica em `#CBD5E1`. */
  uri: string | null;
  count: number;
  onPress: () => void;
  /** Ex.: "Sua foto, 1 foto. Abrir galeria". */
  accessibilityLabel: string;
}

/** Pilha de fotos do Pencil (170x162): dois fundos, a foto com borda branca e o contador. */
export function PhotoStack({ uri, count, onPress, accessibilityLabel }: PhotoStackProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
      style={styles.stack}
    >
      <View style={styles.back} />
      <View style={styles.middle} />
      <View style={styles.photo}>
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" /> : null}
        <View style={styles.count}>
          <Images size={16} color={colors.onPrimary} />
          <Text style={styles.countText} allowFontScaling={false}>
            {count}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { width: 170, height: 162 },
  back: {
    position: 'absolute',
    left: 16,
    top: 0,
    width: 138,
    height: 140,
    borderRadius: 16,
    backgroundColor: colors.photoStackBack,
  },
  middle: {
    position: 'absolute',
    left: 8,
    top: 6,
    width: 154,
    height: 140,
    borderRadius: 17,
    backgroundColor: colors.photoStackMiddle,
  },
  photo: {
    position: 'absolute',
    left: 0,
    top: 12,
    width: 170,
    height: 150,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.galleryText,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  count: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    minWidth: 62,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.photoGradientEnd,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  countText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.onPrimary },
});
