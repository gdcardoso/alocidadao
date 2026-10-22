import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getCurrentPoint, type CurrentPoint } from '../../lib/location';
import { compressPhoto, fileSize } from '../../lib/photo-native';
import type { PhotoResult } from '../../lib/photo';

const formatKb = (bytes: number) => `${Math.round(bytes / 1000)} KB`;

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function PermissionDenied({ reason }: { reason: string }) {
  return (
    <View style={styles.denied}>
      <Text style={styles.row}>{reason}</Text>
      <Button label="Abrir configurações" onPress={() => void Linking.openSettings()} />
    </View>
  );
}

/** Tira a foto, reduz no aparelho e entrega o resultado em `onCaptured`. Reutilizado na Task 8. */
export function PhotoCapture({ onCaptured }: { onCaptured: (photo: PhotoResult) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [open, setOpen] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<{ width: number; height: number; bytes: number } | null>(
    null,
  );
  const [photo, setPhoto] = useState<PhotoResult | null>(null);

  const start = async () => {
    setError(null);
    const current = permission?.granted ? permission : await requestPermission();
    if (current.granted) {
      setDenied(false);
      setOpen(true);
    } else {
      setDenied(true);
    }
  };

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await camera.current.takePictureAsync({ quality: 1 });
      setOriginal({ width: raw.width, height: raw.height, bytes: fileSize(raw.uri) });
      const compressed = await compressPhoto(raw.uri);
      setPhoto(compressed);
      setOpen(false);
      onCaptured(compressed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível tirar a foto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.subtitle}>Foto</Text>
      {open ? (
        <>
          <CameraView ref={camera} style={styles.camera} facing="back" />
          <Button
            label={busy ? 'Processando...' : 'Capturar'}
            onPress={() => void capture()}
            disabled={busy}
          />
        </>
      ) : (
        <Button label="Tirar foto" onPress={() => void start()} />
      )}
      {busy && <ActivityIndicator />}
      {denied && (
        <PermissionDenied reason="Sem acesso à câmera não dá para registrar a foto do problema. Libere a permissão nas configurações do aparelho." />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {photo && original && (
        <View style={styles.result}>
          <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
          <Text style={styles.row}>
            Antes: {original.width} x {original.height} px, {formatKb(original.bytes)}
          </Text>
          <Text style={styles.row}>
            Depois: {photo.width} x {photo.height} px, {formatKb(photo.bytes)}
          </Text>
        </View>
      )}
    </View>
  );
}

function LocationSection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CurrentPoint | null>(null);

  const read = async () => {
    setBusy(true);
    setResult(await getCurrentPoint());
    setBusy(false);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.subtitle}>Localização</Text>
      <Button
        label={busy ? 'Buscando...' : 'Pegar localização'}
        onPress={() => void read()}
        disabled={busy}
      />
      {result && 'point' in result && (
        <>
          <Text style={styles.row}>
            Ponto: {result.point.lat.toFixed(5)}, {result.point.lng.toFixed(5)}
          </Text>
          <Text style={styles.row}>
            Precisão:{' '}
            {result.accuracyM === null ? 'desconhecida' : `${Math.round(result.accuracyM)} m`}
          </Text>
        </>
      )}
      {result && 'error' in result && result.error === 'permission_denied' && (
        <PermissionDenied reason="Sem acesso à localização não dá para saber onde está o problema nem qual prefeitura atende. Libere a permissão nas configurações do aparelho." />
      )}
      {result && 'error' in result && result.error === 'unavailable' && (
        <Text style={styles.error}>Não foi possível obter a localização. Tente de novo.</Text>
      )}
    </View>
  );
}

export default function CameraLab() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Câmera e local</Text>
      <PhotoCapture onCaptured={() => undefined} />
      <LocationSection />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  section: { gap: 12 },
  row: { fontSize: 16 },
  error: { fontSize: 16, color: '#b00020' },
  camera: { height: 360, borderRadius: 8, overflow: 'hidden' },
  preview: { height: 200, width: '100%', backgroundColor: '#eee' },
  result: { gap: 6 },
  denied: { gap: 12 },
  button: { backgroundColor: '#0b5fff', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
