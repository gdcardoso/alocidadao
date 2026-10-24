import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { compressToTarget, fitWithin, type PhotoResult } from './photo';

/** Apaga um arquivo local sem derrubar quem chama (o cache do app é limpo de qualquer jeito). */
export function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Falha ao apagar arquivo temporário', error);
  }
}

/**
 * Adaptador nativo: decodifica a foto uma vez, reduz para o lado maior permitido e comprime até
 * o tamanho alvo. Os JPEGs das qualidades não escolhidas são apagados; acima do limite do
 * servidor mesmo na menor qualidade, recusa com `PhotoTooLargeError`.
 */
export async function compressPhoto(uri: string): Promise<PhotoResult> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const target = fitWithin(original.width, original.height);
  const needsResize = target.width !== original.width || target.height !== original.height;
  // Redimensiona a imagem já decodificada (não lê o arquivo de novo).
  const resized = needsResize
    ? await ImageManipulator.manipulate(original).resize(target).renderAsync()
    : original;
  try {
    return await compressToTarget(
      async (quality) => {
        const saved = await resized.saveAsync({ compress: quality, format: SaveFormat.JPEG });
        return {
          uri: saved.uri,
          width: saved.width,
          height: saved.height,
          bytes: new File(saved.uri).size,
        };
      },
      { discard: (attempt) => deleteFile(attempt.uri) },
    );
  } finally {
    // Libera a memória das imagens decodificadas.
    if (resized !== original) resized.release();
    original.release();
  }
}

/** Tamanho em bytes de um arquivo local. */
export function fileSize(uri: string): number {
  return new File(uri).size;
}
