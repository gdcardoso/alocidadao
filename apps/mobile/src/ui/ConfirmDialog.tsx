import { Modal, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from './Button';
import { colors, fonts } from './theme';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Ação destrutiva: botão de confirmar em `danger`. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmação (cancelar, excluir, sair). O Pencil não desenhou: segue os tokens, com o cartão
 * no centro sobre o escurecimento e os botões de 56 empilhados.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={loading ? () => undefined : onCancel}
    >
      <View style={styles.root}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttons}>
            <PrimaryButton
              label={confirmLabel}
              onPress={onConfirm}
              loading={loading}
              variant={destructive ? 'danger' : 'default'}
            />
            <SecondaryButton label={cancelLabel} onPress={onCancel} disabled={loading} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.scrim,
  },
  card: { backgroundColor: colors.surface, borderRadius: 28, padding: 24, gap: 12 },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.textPrimary },
  message: { fontFamily: fonts.body, fontSize: 16, color: colors.textSecondary },
  buttons: { gap: 12, marginTop: 12 },
});
