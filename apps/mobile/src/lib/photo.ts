import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE_PX, PHOTO_TARGET_BYTES } from '@alocidadao/shared';

/** Qualidades JPEG tentadas, da maior para a menor. */
export const DEFAULT_QUALITIES: readonly number[] = [0.7, 0.6, 0.5, 0.4];

export type PhotoResult = { uri: string; width: number; height: number; bytes: number };

/** A foto passou do limite do servidor mesmo na menor qualidade: a pessoa tira outra. */
export class PhotoTooLargeError extends Error {
  constructor() {
    super('photo_too_large');
    this.name = 'PhotoTooLargeError';
  }
}

const TOO_LARGE_MESSAGE = 'A foto ficou grande demais. Tire outra.';
const CAMERA_FAILED_MESSAGE = 'Não foi possível usar a câmera. Tente de novo.';

/** O que a câmera mostra quando a foto falha: nunca a mensagem técnica. */
export function cameraErrorMessage(error: unknown): string {
  return error instanceof PhotoTooLargeError ? TOO_LARGE_MESSAGE : CAMERA_FAILED_MESSAGE;
}

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

export interface CompressOptions<T> {
  qualities?: readonly number[];
  /** Tamanho alvo: a primeira qualidade que fica nele é a escolhida. */
  targetBytes?: number;
  /** Limite rígido: acima dele, mesmo na menor qualidade, a foto é recusada. */
  maxBytes?: number;
  /** Apaga uma tentativa que não foi escolhida (o JPEG intermediário). */
  discard?: (attempt: T) => unknown;
}

/**
 * Tenta cada qualidade em ordem e devolve a primeira cujo tamanho fica dentro do alvo.
 * Se nenhuma chegar lá, devolve a menor das tentativas; se a menor ainda passar de
 * `maxBytes`, recusa com `PhotoTooLargeError`. As tentativas não escolhidas vão para `discard`.
 */
export async function compressToTarget<T extends { bytes: number }>(
  render: (quality: number) => Promise<T>,
  {
    qualities = DEFAULT_QUALITIES,
    targetBytes = PHOTO_TARGET_BYTES,
    maxBytes = PHOTO_MAX_BYTES,
    discard,
  }: CompressOptions<T> = {},
): Promise<T> {
  let smallest: T | null = null;
  for (const quality of qualities) {
    const attempt = await render(quality);
    if (attempt.bytes <= targetBytes) {
      if (smallest !== null) await discard?.(smallest);
      return attempt;
    }
    if (smallest === null || attempt.bytes < smallest.bytes) {
      if (smallest !== null) await discard?.(smallest);
      smallest = attempt;
    } else {
      await discard?.(attempt);
    }
  }
  if (smallest === null) throw new Error('compressToTarget: nenhuma qualidade informada');
  if (smallest.bytes > maxBytes) {
    await discard?.(smallest);
    throw new PhotoTooLargeError();
  }
  return smallest;
}
