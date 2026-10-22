import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { compressToTarget, fitWithin, type PhotoResult } from './photo';

/** Adaptador nativo: reduz a foto para o lado maior permitido e comprime até o tamanho alvo. */
export async function compressPhoto(uri: string): Promise<PhotoResult> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const target = fitWithin(original.width, original.height);
  const resized = await ImageManipulator.manipulate(uri).resize(target).renderAsync();
  return compressToTarget(async (quality) => {
    const saved = await resized.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      bytes: new File(saved.uri).size,
    };
  });
}

/** Tamanho em bytes de um arquivo local. */
export function fileSize(uri: string): number {
  return new File(uri).size;
}
