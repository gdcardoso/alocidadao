import type { IconGroup } from '@alocidadao/shared';
import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './Button';
import { CategoryIcon } from './CategoryIcon';
import type { StatusBadgeStyle } from './category';
import { Badge } from './StatusBadge';
import { colors, fonts, radius } from './theme';

/** O que o cartão mostra (ver `toCardModel` e `toQueuedCardModel` em citizen/requests-view). */
export interface RequestCardView {
  title: string;
  address: string | null;
  icon: string | null;
  iconGroup: IconGroup;
  badge: StatusBadgeStyle;
  meta: string;
}

export interface RequestCardProps {
  view: RequestCardView;
  /** Sem `onPress` (item da fila, ainda sem detalhe), o cartão não abre nada e não tem a seta. */
  onPress?: () => void;
  /** Borda `warning` 2: o que pede ação do cidadão (aguardando confirmação). */
  highlighted?: boolean;
  /** Botão dentro do cartão (ex.: "Ver atendimento e confirmar"). */
  action?: { label: string; onPress: () => void };
  /** Conteúdo extra no fim do cartão (ex.: motivo da recusa e "Remover"). */
  children?: ReactNode;
}

/** Cartão da lista: ícone da categoria, tipo, endereço, selo e "protocolo · data". */
export function RequestCard({ view, onPress, highlighted, action, children }: RequestCardProps) {
  const a11y = [view.title, view.address, view.badge.label, view.meta].filter(Boolean).join(', ');
  const body = (
    <>
      <View style={styles.top}>
        <CategoryIcon icon={view.icon} group={view.iconGroup} />
        <View style={styles.texts}>
          <Text style={styles.type}>{view.title}</Text>
          {view.address ? <Text style={styles.address}>{view.address}</Text> : null}
        </View>
        {onPress ? <ChevronRight size={20} color={colors.textSecondary} /> : null}
      </View>
      <View style={styles.bottom}>
        <Badge badge={view.badge} />
        <Text style={styles.meta}>{view.meta}</Text>
      </View>
    </>
  );
  return (
    <View style={[styles.card, highlighted ? styles.cardAction : styles.cardIdle]}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          style={styles.body}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.body} accessible accessibilityLabel={a11y}>
          {body}
        </View>
      )}
      {action ? (
        <PrimaryButton label={action.label} onPress={action.onPress} size="medium" />
      ) : null}
      {children}
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
