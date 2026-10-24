import { MAX_PHOTOS_PER_COMPLETION } from '@alocidadao/shared';
import { useLocalSearchParams } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  MAX_COMPLETION_NOTE,
  canSendCompletion,
  infoText,
  locationBand,
} from '../../../../../agent/finish-form';
import { useFinishScreen } from '../../../../../agent/use-finish-screen';
import { PhotoCapture } from '../../../../../components/photo-capture';
import { PrimaryButton } from '../../../../../ui/Button';
import { ConfirmDialog } from '../../../../../ui/ConfirmDialog';
import { Footer } from '../../../../../ui/Footer';
import { FormError } from '../../../../../ui/FormLayout';
import { Header } from '../../../../../ui/Header';
import { Screen } from '../../../../../ui/Screen';
import {
  InfoNote,
  NoteField,
  OfflineHint,
  SectionLabel,
  SectionLabelWithHint,
} from '../../../../../ui/agent/FinishForm';
import { LocationBand } from '../../../../../ui/agent/LocationBand';
import { PhotoThumbs } from '../../../../../ui/agent/PhotoThumbs';
import { WorkOrderUnavailable } from '../../../../../ui/agent/WorkOrderUnavailable';
import { space } from '../../../../../ui/theme';
import { useKeyboardHeight } from '../../../../../ui/use-keyboard-height';

const TITLE = 'Concluir atendimento';

/** A3 · Concluir atendimento (também o reenvio depois do ajuste, com o relato anterior). */
export default function ConcluirAtendimento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const form = useFinishScreen(id, { prefillNote: true });
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

  const canSend = canSendCompletion({ photos: form.photos, note: form.note });

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
            <SectionLabelWithHint
              label="Fotos do serviço feito"
              hint={`obrigatório · ${form.photos.length} de ${MAX_PHOTOS_PER_COMPLETION}`}
            />
            <PhotoThumbs
              photos={form.photos}
              max={MAX_PHOTOS_PER_COMPLETION}
              onRemove={form.removePhoto}
              onAdd={() => form.setCameraOpen(true)}
              disabled={form.sending}
            />
          </View>
          <LocationBand view={locationBand(form.location, detail.location)} />
          <View style={styles.section}>
            <SectionLabel label="O que foi feito?" requirement="required" />
            <NoteField
              value={form.note}
              onChangeText={form.setNote}
              maxLength={MAX_COMPLETION_NOTE}
              placeholder="Ex.: buraco tapado com asfalto a frio, área sinalizada"
              accessibilityLabel="O que foi feito?"
              editable={!form.sending}
            />
          </View>
          <InfoNote text={infoText(detail.citizenCount)} />
        </ScrollView>
        <Footer>
          <FormError message={form.error} />
          <PrimaryButton
            label={TITLE}
            icon={CircleCheck}
            onPress={() => void form.send('complete', { note: form.note })}
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
});
