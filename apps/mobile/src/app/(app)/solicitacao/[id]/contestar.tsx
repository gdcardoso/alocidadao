import { MAX_PHOTOS_PER_REQUEST } from '@alocidadao/shared';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Send, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { createSessionTransport, sessionApi } from '../../../../auth/native-session';
import { useSession } from '../../../../auth/use-session';
import { NO_NETWORK_MESSAGE, actionFailure } from '../../../../citizen/detail-view';
import { PhotoCapture } from '../../../../components/photo-capture';
import { createActionLock } from '../../../../lib/action-lock';
import { isOnline } from '../../../../lib/net-info';
import { PrimaryButton, SecondaryButton } from '../../../../ui/Button';
import { FieldLabel } from '../../../../ui/FieldLabel';
import { FormError, FormLayout, FormTitle } from '../../../../ui/FormLayout';
import { Header } from '../../../../ui/Header';
import { TextField } from '../../../../ui/TextField';
import { colors } from '../../../../ui/theme';

const MIN_COMMENT = 3;
const MAX_COMMENT = 1000;

/**
 * Contestação ("Não foi resolvido"). O Pencil não desenhou: segue as telas de formulário.
 * Exige rede; as fotos sobem pela mesma rota de upload da Nova solicitação.
 */
export default function Contestar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshMe } = useSession();
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O mesmo envio repetido (ex.: resposta perdida) não conta duas vezes.
  const [clientActionId] = useState(() => randomUUID());
  // Foto já enviada numa tentativa anterior não sobe de novo.
  const uploaded = useRef(new Map<string, string>());
  // Toque duplo em "Enviar" não sobe as fotos nem contesta duas vezes.
  const [lock] = useState(createActionLock);

  const trimmed = comment.trim();
  const canSend = trimmed.length >= MIN_COMMENT;

  const send = () =>
    lock.run(async () => {
      if (!canSend) return;
      setError(null);
      setSending(true);
      try {
        if (!(await isOnline())) {
          setError(NO_NETWORK_MESSAGE);
          return;
        }
        const transport = await createSessionTransport();
        const photoKeys: string[] = [];
        for (const uri of photos) {
          let key = uploaded.current.get(uri);
          if (!key) {
            key = (await transport.uploadPhoto(uri, 'create_request')).key;
            uploaded.current.set(uri, key);
          }
          photoKeys.push(key);
        }
        await sessionApi.contestRequest(id, { clientActionId, comment: trimmed, photoKeys });
        // O detalhe se atualiza ao voltar ao foco.
        router.back();
      } catch (e) {
        const failure = actionFailure(e);
        // Sessão recusada: refreshMe leva para o login.
        if (failure.kind === 'session') void refreshMe().catch(() => undefined);
        else setError(failure.message);
      } finally {
        setSending(false);
      }
    });

  return (
    <>
      <FormLayout
        header={<Header nav="back" onNavPress={() => router.back()} />}
        footer={
          <>
            <FormError message={error} />
            <PrimaryButton
              label="Enviar"
              icon={Send}
              onPress={() => void send()}
              disabled={!canSend}
              loading={sending}
            />
          </>
        }
      >
        <FormTitle title="O que continua errado?" />
        <TextField
          label="Conte o que você viu"
          requirement="required"
          multiline
          autoFocus
          maxLength={MAX_COMMENT}
          value={comment}
          onChangeText={(text) => {
            setComment(text);
            setError(null);
          }}
        />
        <View style={styles.photos}>
          <FieldLabel label="Fotos" requirement="optional" />
          {photos.length > 0 ? (
            <View style={styles.thumbs}>
              {photos.map((uri, i) => (
                <View key={uri} style={styles.thumb}>
                  <Image
                    source={{ uri }}
                    style={styles.thumbImage}
                    accessibilityLabel={`Foto ${i + 1} de ${photos.length}`}
                  />
                  <Pressable
                    onPress={() => setPhotos((list) => list.filter((p) => p !== uri))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remover foto ${i + 1}`}
                    style={styles.remove}
                  >
                    <X size={18} color={colors.onPrimary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {photos.length < MAX_PHOTOS_PER_REQUEST ? (
            <SecondaryButton
              label="Adicionar foto"
              icon={Camera}
              size="medium"
              onPress={() => setCameraOpen(true)}
              disabled={sending}
              style={styles.add}
            />
          ) : null}
        </View>
      </FormLayout>
      <PhotoCapture
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(photo) => {
          setCameraOpen(false);
          setPhotos((list) => [...list, photo.uri].slice(0, MAX_PHOTOS_PER_REQUEST));
        }}
      />
    </>
  );
}

const THUMB = 96;

const styles = StyleSheet.create({
  photos: { gap: 12 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.galleryText,
  },
  thumbImage: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.photoOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: { alignSelf: 'flex-start' },
});
