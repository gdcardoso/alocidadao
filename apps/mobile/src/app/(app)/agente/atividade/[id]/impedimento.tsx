import {
  IMPEDIMENT_REASONS,
  IMPEDIMENT_REASON_LABELS,
  MAX_PHOTOS_PER_IMPEDIMENT,
} from '@alocidadao/shared';
import { useLocalSearchParams } from 'expo-router';
import { Camera, Send } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MAX_IMPEDIMENT_NOTE, canSendImpediment } from '../../../../../agent/finish-form';
import { useFinishScreen } from '../../../../../agent/use-finish-screen';
import { PhotoCapture } from '../../../../../components/photo-capture';
import { PrimaryButton } from '../../../../../ui/Button';
import { ConfirmDialog } from '../../../../../ui/ConfirmDialog';
import { Footer } from '../../../../../ui/Footer';
import { FormError } from '../../../../../ui/FormLayout';
import { Header } from '../../../../../ui/Header';
import { Screen } from '../../../../../ui/Screen';
import { InfoNote, NoteField, OfflineHint, SectionLabel } from '../../../../../ui/agent/FinishForm';
import { PhotoThumbs } from '../../../../../ui/agent/PhotoThumbs';
import { ReasonOption } from '../../../../../ui/agent/ReasonOption';
import { WorkOrderUnavailable } from '../../../../../ui/agent/WorkOrderUnavailable';
import { DISABLED_OPACITY, colors, fonts, space } from '../../../../../ui/theme';
import { useKeyboardHeight } from '../../../../../ui/use-keyboard-height';

const TITLE = 'Não consigo resolver';

/** A4 · Não consigo resolver: relata o impedimento e a atividade volta ao gestor. */
export default function NaoConsigoResolver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const form = useFinishScreen(id, { prefillNote: false });
  const keyboardHeight = useKeyboardHeight();
  const { detail, view } = form;

  if (!detail || !view) {
    return (
      <Screen>
        <Header nav="close" onNavPress={form.close} title={TITLE} />
        <WorkOrderUnavailable
          phase={form.state.phase}
          onBack={form.close}
          onRetry={() => void form.reload()}
        />
      </Screen>
    );
  }

  const canSend = canSendImpediment({
    reason: form.reason,
    note: form.note,
    photos: form.photos,
  });

  const send = () => {
    if (!form.reason) return;
    void form.send('report_impediment', { note: form.note, impedimentReason: form.reason });
  };

  return (
    <Screen>
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <Header
          nav="close"
          onNavPress={form.close}
          title={TITLE}
          subtitle={`${detail.categoryName} · ${view.location.address}`}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <SectionLabel label="Qual o motivo?" requirement="required" />
            <View style={styles.options} accessibilityRole="radiogroup">
              {IMPEDIMENT_REASONS.map((reason) => (
                <ReasonOption
                  key={reason}
                  reason={reason}
                  label={IMPEDIMENT_REASON_LABELS[reason]}
                  selected={form.reason === reason}
                  onPress={() => form.setReason(reason)}
                />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <SectionLabel label="Detalhes" requirement="required" />
            <NoteField
              value={form.note}
              onChangeText={form.setNote}
              maxLength={MAX_IMPEDIMENT_NOTE}
              placeholder="Ex.: precisamos de rolo compactador, buraco maior que o previsto"
              accessibilityLabel="Detalhes"
              editable={!form.sending}
            />
          </View>
          <View style={styles.section}>
            <SectionLabel label="Foto" requirement="optional" />
            {form.photos.length > 0 ? (
              <PhotoThumbs
                photos={form.photos}
                max={MAX_PHOTOS_PER_IMPEDIMENT}
                onRemove={form.removePhoto}
                disabled={form.sending}
              />
            ) : null}
            {form.photos.length < MAX_PHOTOS_PER_IMPEDIMENT ? (
              <Pressable
                onPress={() => form.setCameraOpen(true)}
                disabled={form.sending}
                accessibilityRole="button"
                accessibilityLabel="Tirar foto"
                accessibilityState={{ disabled: form.sending }}
                style={({ pressed }) => [
                  styles.photoButton,
                  pressed && styles.photoButtonPressed,
                  form.sending && styles.disabled,
                ]}
              >
                <Camera size={20} color={colors.primary} />
                <Text style={styles.photoButtonText}>Tirar foto</Text>
              </Pressable>
            ) : null}
          </View>
          <InfoNote text="A atividade volta para o gestor decidir o próximo passo. Os cidadãos não veem este motivo." />
        </ScrollView>
        <Footer>
          <FormError message={form.error} />
          <PrimaryButton
            label="Enviar ao gestor"
            icon={Send}
            variant="warning"
            onPress={send}
            disabled={!canSend}
            loading={form.sending}
          />
          <OfflineHint />
        </Footer>
      </View>
      <PhotoCapture
        visible={form.cameraOpen}
        onClose={() => form.setCameraOpen(false)}
        onCaptured={(photo) => void form.addPhoto(photo)}
      />
      <ConfirmDialog
        visible={form.confirmDiscard}
        title="Descartar o que você preencheu?"
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        destructive
        onConfirm={form.discard}
        onCancel={form.keepEditing}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Pencil: padding 8/20/24/20, gap 24.
  content: {
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
    gap: space.section,
  },
  section: { gap: 12 },
  options: { gap: 12 },
  // Pencil: largura total, 56, raio 16, borda `border-input` 1.
  photoButton: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  photoButtonPressed: { backgroundColor: colors.primarySoft },
  disabled: { opacity: DISABLED_OPACITY },
  photoButtonText: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.primary },
});
