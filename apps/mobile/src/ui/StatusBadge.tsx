import type { RequestStatus } from '@alocidadao/shared';
import { StyleSheet, Text, View } from 'react-native';
import { statusBadge } from './category';
import { fonts, radius } from './theme';

/** Selo de status: raio 14, padding 6/10, ícone 16 + texto 14/600. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  const { label, icon: Icon, bg, fg } = statusBadge(status);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Icon size={16} color={fg} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.digit,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexShrink: 1,
  },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14, flexShrink: 1 },
});
