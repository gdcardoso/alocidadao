import { Check, X } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

/**
 * Estado de cada etapa: `done` (verde com check), `current` (contorno `primary` com ponto),
 * `future` (contorno `border-input`), `waiting` (sua confirmação pendente, `warning`) e
 * `rejected` (vermelho com `x`).
 */
export type TimelineStepState = 'done' | 'current' | 'future' | 'waiting' | 'rejected';

export interface TimelineStep {
  title: string;
  detail: string;
  state: TimelineStepState;
}

const STATE_LABELS: Record<TimelineStepState, string> = {
  done: 'concluída',
  current: 'etapa atual',
  future: 'próxima etapa',
  waiting: 'aguardando você',
  rejected: 'recusada',
};

function Marker({ state }: { state: TimelineStepState }) {
  switch (state) {
    case 'done':
      return (
        <View style={[styles.marker, styles.markerDone]}>
          <Check size={14} color={colors.onPrimary} strokeWidth={3} />
        </View>
      );
    case 'rejected':
      return (
        <View style={[styles.marker, styles.markerRejected]}>
          <X size={14} color={colors.onPrimary} strokeWidth={3} />
        </View>
      );
    case 'current':
      return (
        <View style={[styles.marker, styles.markerCurrent]}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        </View>
      );
    case 'waiting':
      return (
        <View style={[styles.marker, styles.markerWaiting]}>
          <View style={[styles.dot, { backgroundColor: colors.warning }]} />
        </View>
      );
    default:
      return <View style={[styles.marker, styles.markerFuture]} />;
  }
}

/** Linha do tempo do detalhe: trilho de 24 com marcador e linha de 2. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const lineColor = step.state === 'done' ? colors.success : colors.borderInput;
        const muted = step.state === 'future';
        return (
          <View
            key={`${step.title}-${index}`}
            style={[styles.row, { minHeight: last ? 48 : 68 }]}
            accessible
            accessibilityLabel={`${step.title}, ${STATE_LABELS[step.state]}. ${step.detail}`}
          >
            <View style={styles.rail}>
              <Marker state={step.state} />
              {last ? null : <View style={[styles.line, { backgroundColor: lineColor }]} />}
            </View>
            <View style={styles.texts}>
              <Text style={[styles.title, muted && styles.titleMuted]}>{step.title}</Text>
              <Text style={styles.detail}>{step.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  rail: { width: 24, alignItems: 'center' },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  markerDone: { backgroundColor: colors.success, borderColor: colors.success },
  markerRejected: { backgroundColor: colors.danger, borderColor: colors.danger },
  markerCurrent: { borderColor: colors.primary },
  markerWaiting: { borderColor: colors.warning },
  markerFuture: { borderColor: colors.borderInput },
  dot: { width: 8, height: 8, borderRadius: 4 },
  line: { flex: 1, width: 2, marginVertical: 2 },
  texts: { flex: 1, gap: 2, paddingBottom: 16 },
  title: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  titleMuted: { color: colors.textSecondary },
  detail: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary },
});
