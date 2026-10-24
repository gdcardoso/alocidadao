import {
  CircleAlert,
  CircleCheck,
  CircleX,
  HardHat,
  Hourglass,
  type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from './theme';

/** Tom do aviso conforme o status da solicitação. */
export type StatusNoticeTone = 'open' | 'progress' | 'awaiting' | 'rejected' | 'done';

const TONES: Record<
  StatusNoticeTone,
  { icon: LucideIcon; bg: string; border: string; fg: string }
> = {
  open: {
    icon: Hourglass,
    bg: colors.openNotice,
    border: colors.borderInput,
    fg: colors.textSecondary,
  },
  progress: { icon: HardHat, bg: colors.primarySoft, border: colors.primary, fg: colors.primary },
  awaiting: {
    icon: CircleAlert,
    bg: colors.warningSoft,
    border: colors.warning,
    fg: colors.warning,
  },
  rejected: { icon: CircleX, bg: colors.dangerSoft, border: colors.danger, fg: colors.danger },
  // O Pencil não desenhou a concluída: segue o selo "Concluída" da lista.
  done: { icon: CircleCheck, bg: colors.successSoft, border: colors.success, fg: colors.success },
};

export interface StatusNoticeProps {
  tone: StatusNoticeTone;
  title: string;
  text: string;
  /** Troca o ícone do tom (ex.: cancelada usa o tom da aberta com outro ícone). */
  icon?: LucideIcon;
}

/** Aviso de status no topo do detalhe: raio 20, padding 16, ícone 22, título 16/600, texto 15. */
export function StatusNotice({ tone, title, text, icon }: StatusNoticeProps) {
  const { bg, border, fg } = TONES[tone];
  const Icon = icon ?? TONES[tone].icon;
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: border }]} accessible>
      <Icon size={22} color={fg} />
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 16,
  },
  texts: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  text: { fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary },
});
