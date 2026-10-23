import type { RequestCard as RequestCardData } from '@alocidadao/shared';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './Button';
import { CategoryIcon } from './CategoryIcon';
import { statusBadge } from './category';
import { formatShortDate } from './format';
import { StatusBadge } from './StatusBadge';
import { colors, fonts, radius } from './theme';

export interface RequestCardProps {
  request: RequestCardData;
  onPress: () => void;
  /** Botão dentro do cartão (ex.: "Ver atendimento e confirmar"). */
  action?: { label: string; onPress: () => void };
  now?: Date;
}

/**
 * Cartão da lista: ícone da categoria, tipo, endereço, selo e "protocolo · data". O que pede
 * ação do cidadão (aguardando confirmação) tem borda `warning` 2.
 */
export function RequestCard({ request, onPress, action, now }: RequestCardProps) {
  const needsAction = request.status === 'awaiting_confirmation';
  const meta = `${request.protocol} · ${formatShortDate(request.createdAt, now)}`;
  const a11y = [request.categoryName, request.address, statusBadge(request.status).label, meta]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.card, needsAction ? styles.cardAction : styles.cardIdle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={styles.body}
      >
        <View style={styles.top}>
          <CategoryIcon icon={request.icon} group={request.iconGroup} />
          <View style={styles.texts}>
            <Text style={styles.type}>{request.categoryName}</Text>
            {request.address ? <Text style={styles.address}>{request.address}</Text> : null}
          </View>
          <ChevronRight size={20} color={colors.textSecondary} />
        </View>
        <View style={styles.bottom}>
          <StatusBadge status={request.status} />
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </Pressable>
      {action ? (
        <PrimaryButton label={action.label} onPress={action.onPress} size="medium" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, backgroundColor: colors.surface, padding: 16, gap: 14 },
  cardIdle: { borderWidth: 1, borderColor: colors.border },
  cardAction: { borderWidth: 2, borderColor: colors.warning, padding: 15 },
  body: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 2 },
  type: { fontFamily: fonts.bodySemibold, fontSize: 17, color: colors.textPrimary },
  address: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary },
});
