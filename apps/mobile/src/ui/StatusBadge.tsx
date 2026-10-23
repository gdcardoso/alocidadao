import type { RequestStatus } from '@alocidadao/shared';
import { StyleSheet, Text, View } from 'react-native';
import { statusBadge, type StatusBadgeStyle } from './category';
import { fonts, radius } from './theme';

/** Selo de status: raio 14, padding 6/10, ícone 16 + texto 14/600. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge badge={statusBadge(status)} />;
}

/** Selo com rótulo, ícone e cores prontos (ex.: "Aguardando internet" da fila). */
export function Badge({ badge }: { badge: StatusBadgeStyle }) {
  const { label, icon: Icon, bg, fg } = badge;
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
