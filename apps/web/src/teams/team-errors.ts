import { ApiError } from '@alocidadao/api-client';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';

/** Código do corpo de um `ApiError`, ou undefined. */
export function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : undefined;
}

/** Campo extra de texto do corpo de um `ApiError` (ex.: `teamName`). */
export function apiErrorField(error: unknown, key: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const value = (error.body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Mensagem geral para falhas que o diálogo não trata no campo. */
export function generalErrorMessage(error: unknown): string {
  return error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE;
}
