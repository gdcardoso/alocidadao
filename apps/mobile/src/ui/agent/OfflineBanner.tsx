import { WifiOff } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, space } from '../theme';

/** Faixa offline da A1 (largura total, `warning-soft`): `wifi-off` 18 + texto 15/600. */
export function OfflineBanner({ text }: { text: string }) {
  return (
    <View style={styles.banner} accessible accessibilityRole="alert" accessibilityLabel={text}>
      <WifiOff size={18} color={colors.warning} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: space.gutter,
    backgroundColor: colors.warningSoft,
  },
  text: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.warningStrong },
});
