import { ApiError } from '@alocidadao/api-client';
import { CODE_RESEND_SECONDS, phoneSchema, type PhoneVerifyResponse } from '@alocidadao/shared';
import type { KeyValueStore } from '../lib/installation-id';
import { parsePhoneInput } from '../ui/format';

// Regras das telas de entrada, sem nada nativo (testável em Node).

/** Para onde o app segue depois que o código do SMS confere. */
export type LoginStep =
  | { route: '/(app)' }
  | { route: '/(auth)/quase-la'; signupToken: string }
  | {
      route: '/(auth)/confirmar-email';
      recoveryChallengeId: string;
      maskedEmail: string;
      signupToken: string;
    };

export function nextStepAfterVerify(response: PhoneVerifyResponse): LoginStep {
  switch (response.status) {
    case 'signed_in':
      return { route: '/(app)' };
    case 'needs_profile':
      return { route: '/(auth)/quase-la', signupToken: response.signupToken };
    case 'email_check':
      return {
        route: '/(auth)/confirmar-email',
        recoveryChallengeId: response.recoveryChallengeId,
        maskedEmail: response.maskedEmail,
        signupToken: response.signupToken,
      };
  }
}

const FALLBACK_MESSAGE = 'Algo deu errado. Tente de novo.';

const MESSAGES: Record<string, string> = {
  code_invalid: 'Código incorreto. Confira e tente de novo.',
  code_expired: 'O código venceu. Peça um novo.',
  code_locked: 'Muitas tentativas. Peça um novo código.',
  phone_in_use: 'Este número já tem uma conta. Volte e entre de novo.',
  email_in_use: 'Este e-mail já está em uso. Deixe em branco ou use outro.',
  sms_not_configured: 'Não foi possível enviar o SMS agora. Tente mais tarde.',
};

/** Mensagem para o cidadão a partir do `code` da API. Sem o tempo de espera, usa o de reenvio. */
export function errorMessage(code: string | null | undefined, retryAfterSeconds?: number): string {
  if (code === 'code_rate_limited' || code === 'rate_limited') {
    return `Aguarde ${retryAfterSeconds ?? CODE_RESEND_SECONDS} s para pedir outro código.`;
  }
  return (code && MESSAGES[code]) || FALLBACK_MESSAGE;
}

/** `code` da resposta de erro da API, se houver. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const { code } = body as { code?: unknown };
  return typeof code === 'string' ? code : null;
}

/** Mensagem de qualquer falha (erro da API, rede fora, tempo esgotado). */
export function apiErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  if (!code || !(error instanceof ApiError)) return FALLBACK_MESSAGE;
  const { retryAfterSeconds } = error.body as { retryAfterSeconds?: unknown };
  return errorMessage(code, typeof retryAfterSeconds === 'number' ? retryAfterSeconds : undefined);
}

/** Chave do SecureStore com o id do dono da fila offline e do cache. */
export const OUTBOX_OWNER_KEY = 'outbox-owner';

/**
 * No login: se a fila e o cache pertencem a outra pessoa (ou a ninguém conhecido), apaga tudo
 * antes de seguir. O novo dono só é gravado depois da limpeza: se ela falhar, a próxima
 * tentativa limpa de novo.
 */
export async function syncOutboxOwner({
  store,
  userId,
  clearOfflineData,
}: {
  store: KeyValueStore;
  userId: string;
  clearOfflineData: () => Promise<void>;
}): Promise<void> {
  const owner = await store.getItem(OUTBOX_OWNER_KEY);
  if (owner === userId) return;
  await clearOfflineData();
  await store.setItem(OUTBOX_OWNER_KEY, userId);
}

/** Celular digitado → E.164, só quando é um celular brasileiro completo e válido. */
export function phoneFromInput(text: string): string | null {
  const phone = parsePhoneInput(text);
  return phone && phoneSchema.safeParse(phone).success ? phone : null;
}

/** Contador de reenvio: `45` → `'0:45'`. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
