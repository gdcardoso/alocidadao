import { CameraView, useCameraPermissions } from 'expo-camera';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PhotoResult } from '../lib/photo';
import { compressPhoto, fileSize } from '../lib/photo-native';
import { PrimaryButton } from '../ui/Button';
import { colors, fonts } from '../ui/theme';

/** Foto reduzida no aparelho, com as medidas da original (o Laboratório compara as duas). */
export interface CapturedPhoto extends PhotoResult {
  original: { width: number; height: number; bytes: number };
}

export interface PhotoCaptureProps {
  visible: boolean;
  onClose: () => void;
  onCaptured: (photo: CapturedPhoto) => void;
}

const DENIED_TEXT =
  'Sem acesso à câmera não dá para registrar a foto do problema. Libere a permissão nas configurações do aparelho.';

/**
 * Câmera em tela cheia: pede a permissão, tira a foto, reduz no aparelho e entrega em
 * `onCaptured`. Quem chama decide quantas fotos aceita.
 */
export function PhotoCapture({ visible, onClose, onCaptured }: PhotoCaptureProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ao abrir, pede a permissão se ela ainda puder ser pedida.
  useEffect(() => {
    if (!visible || !permission || permission.granted || !permission.canAskAgain) return;
    void requestPermission();
  }, [visible, permission, requestPermission]);

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await camera.current.takePictureAsync({ quality: 1 });
      const original = { width: raw.width, height: raw.height, bytes: fileSize(raw.uri) };
      const compressed = await compressPhoto(raw.uri);
      onCaptured({ ...compressed, original });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível tirar a foto.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setError(null);
    onClose();
  };

  const denied = permission !== null && !permission.granted && !permission.canAskAgain;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        ) : denied ? (
          <View style={styles.denied}>
            <Text style={styles.deniedText}>{DENIED_TEXT}</Text>
            <PrimaryButton
              label="Abrir configurações"
              onPress={() => void Linking.openSettings()}
            />
          </View>
        ) : (
          <View style={styles.denied}>
            <ActivityIndicator color={colors.onPrimary} />
          </View>
        )}

        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Fechar câmera"
          hitSlop={8}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <X size={22} color={colors.onPrimary} />
        </Pressable>

        {permission?.granted ? (
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 28 }]}>
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <Pressable
              onPress={() => void capture()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Tirar foto"
              accessibilityState={{ disabled: busy, busy }}
              style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}
            >
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  close: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.photoOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 16 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { opacity: 0.7 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.onPrimary },
  denied: { flex: 1, justifyContent: 'center', padding: 24, gap: 24 },
  deniedText: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.onPrimary,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.onPrimary,
    backgroundColor: colors.photoOverlay,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginHorizontal: 24,
    textAlign: 'center',
  },
});
