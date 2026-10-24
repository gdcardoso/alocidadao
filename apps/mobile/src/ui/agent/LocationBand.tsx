import { MapPinCheck, MapPinOff, MapPinX } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { LocationBandView } from '../../agent/finish-form';
import { colors, fonts } from '../theme';

const TONES = {
  success: { bg: colors.successSoft, icon: colors.success, text: colors.success },
  warning: { bg: colors.warningSoft, icon: colors.warning, text: colors.warningStrong },
  neutral: { bg: colors.openNotice, icon: colors.textSecondary, text: colors.textSecondary },
} as const;

const ICONS = { 'map-pin-check': MapPinCheck, 'map-pin-x': MapPinX, 'map-pin-off': MapPinOff };

/**
 * Faixa de local da A3 (raio 16, padding 14, gap 10): no local em `success-soft`; longe ou
 * sem posição em `warning-soft`; lendo a posição, neutra com o indicador.
 */
export function LocationBand({ view }: { view: LocationBandView }) {
  const tone = TONES[view.tone];
  const Icon = view.icon === 'loading' ? null : ICONS[view.icon];
  return (
    <View
      style={[styles.band, { backgroundColor: tone.bg }]}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      {Icon ? (
        <Icon size={20} color={tone.icon} />
      ) : (
        <ActivityIndicator size="small" color={tone.icon} style={styles.spinner} />
      )}
      <Text style={[styles.text, { color: tone.text }]}>{view.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 16,
  },
  spinner: { width: 20, height: 20 },
  text: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 20 },
});
