import { PHOTO_MAX_SIDE_PX, PHOTO_TARGET_BYTES } from '@alocidadao/shared';

/** Qualidades JPEG tentadas, da maior para a menor. */
export const DEFAULT_QUALITIES: readonly number[] = [0.7, 0.6, 0.5, 0.4];

export type PhotoResult = { uri: string; width: number; height: number; bytes: number };

/** Reduz as dimensões para o lado maior caber em `maxSide`, sem ampliar nem distorcer. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number = PHOTO_MAX_SIDE_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Tenta cada qualidade em ordem e devolve a primeira cujo tamanho fica dentro do alvo.
 * Se nenhuma chegar lá, devolve a menor das tentativas.
 */
export async function compressToTarget<T extends { bytes: number }>(
  render: (quality: number) => Promise<T>,
  qualities: readonly number[] = DEFAULT_QUALITIES,
  targetBytes: number = PHOTO_TARGET_BYTES,
): Promise<T> {
  let smallest: T | null = null;
  for (const quality of qualities) {
    const attempt = await render(quality);
    if (attempt.bytes <= targetBytes) return attempt;
    if (smallest === null || attempt.bytes < smallest.bytes) smallest = attempt;
  }
  if (smallest === null) throw new Error('compressToTarget: nenhuma qualidade informada');
  return smallest;
}
