import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PhotoCapture, type CapturedPhoto } from '../../components/photo-capture';
import { getCurrentPoint, type CurrentPoint } from '../../lib/location';

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

/** Abre a câmera do app e mostra a foto antes e depois da redução. */
function PhotoSection() {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);

  return (
    <View style={styles.section}>
      <Text style={styles.subtitle}>Foto</Text>
      <Button label="Tirar foto" onPress={() => setOpen(true)} />
      <PhotoCapture
        visible={open}
        onClose={() => setOpen(false)}
        onCaptured={(p) => {
          setPhoto(p);
          setOpen(false);
        }}
      />
      {photo && (
        <View style={styles.result}>
          <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
          <Text style={styles.row}>
            Antes: {photo.original.width} x {photo.original.height} px,{' '}
            {formatKb(photo.original.bytes)}
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
      <PhotoSection />
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
  preview: { height: 200, width: '100%', backgroundColor: '#eee' },
  result: { gap: 6 },
  denied: { gap: 12 },
  button: { backgroundColor: '#0b5fff', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
