import { Navigation, Users } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { workOrderCardLabel } from '../../agent/agent-screen';
import type { AgentCardView } from '../../agent/agent-view';
import { CategoryIcon } from '../CategoryIcon';
import { colors, fonts, radius } from '../theme';

export interface WorkOrderCardProps {
  view: AgentCardView;
  onPress: () => void;
}

/**
 * Cartão de atividade da A1: categoria, tipo (+ selo "Nova"), endereço e distância; embaixo o
 * selo de status (sem ícone), o chip de relatos e o tempo. A nova tem borda `primary` 2.
 */
export function WorkOrderCard({ view, onPress }: WorkOrderCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={workOrderCardLabel(view)}
      style={({ pressed }) => [
        styles.card,
        view.isNew ? styles.cardNew : styles.cardIdle,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.top}>
        <CategoryIcon icon={view.categoryIcon} group={view.categoryGroup} />
        <View style={styles.texts}>
          <View style={styles.titleRow}>
            <Text style={styles.type}>{view.categoryName}</Text>
            {view.isNew ? (
              <View style={styles.newBadge}>
                <Text style={styles.newText}>Nova</Text>
              </View>
            ) : null}
          </View>
          {view.address ? <Text style={styles.address}>{view.address}</Text> : null}
        </View>
        {view.distance ? (
          <View style={styles.distance}>
            <Navigation size={18} color={colors.primary} />
            <Text style={styles.distanceText}>{view.distance}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.bottom}>
        <View style={[styles.badge, { backgroundColor: colors[view.badge.tone.bg] }]}>
          <Text style={[styles.badgeText, { color: colors[view.badge.tone.fg] }]}>
            {view.badge.label}
          </Text>
        </View>
        <View style={styles.reports}>
          <Users size={14} color={colors.textSecondary} />
          <Text style={styles.reportsText}>{view.reportsLabel}</Text>
        </View>
        <Text style={styles.time}>{view.timeLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, backgroundColor: colors.surface, padding: 16, gap: 12 },
  cardIdle: { borderWidth: 1, borderColor: colors.border },
  // Borda 2: o padding cai 1 para o conteúdo não mudar de lugar.
  cardNew: { borderWidth: 2, borderColor: colors.primary, padding: 15 },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8 },
  type: { fontFamily: fonts.bodySemibold, fontSize: 17, color: colors.textPrimary, flexShrink: 1 },
  // Pencil: 12/700; o app carrega só até 600.
  newBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  newText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.onPrimary },
  address: { fontFamily: fonts.body, fontSize: 15, color: colors.textSecondary },
  distance: { alignItems: 'flex-end', gap: 2 },
  distanceText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.primary },
  bottom: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  badge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.digit },
  badgeText: { fontFamily: fonts.bodySemibold, fontSize: 14 },
  reports: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.digit,
    backgroundColor: colors.bg,
  },
  reportsText: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  time: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
});
