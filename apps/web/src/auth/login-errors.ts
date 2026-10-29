import { ApiError } from '@alocidadao/api-client';

export const INVALID_CPF_MESSAGE = 'Confira o CPF.';
export const NETWORK_ERROR_MESSAGE =
  'Não foi possível conectar. Confira sua internet e tente de novo.';
export const UNEXPECTED_ERROR_MESSAGE = 'Não foi possível concluir. Tente de novo.';

const MESSAGES: Record<string, string> = {
  panel_access_not_found:
    'Não encontramos acesso ao painel para este CPF. Fale com o administrador do Alô Cidadão na sua prefeitura.',
  code_invalid: 'Código incorreto. Confira e tente de novo.',
  code_expired: 'O código expirou. Peça um novo.',
  code_locked: 'Muitas tentativas. Peça um novo código.',
};

/** `m:ss`, como na contagem do reenvio (`0:45`). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

function retryAfter(body: unknown): number {
  if (typeof body !== 'object' || body === null || !('retryAfterSeconds' in body)) return 0;
  return typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : 0;
}

/** Aviso do 429 no pedido de código: `Aguarde 0:45 para pedir outro código.` */
export function codeRateLimitMessage(error: ApiError): string {
  return `Aguarde ${formatCountdown(retryAfter(error.body))} para pedir outro código.`;
}

/** Mensagem do login para um erro do pedido de código ou da verificação. */
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  if (error.status === 429) return codeRateLimitMessage(error);
  const code = errorCode(error.body);
  return (code && MESSAGES[code]) ?? UNEXPECTED_ERROR_MESSAGE;
}
