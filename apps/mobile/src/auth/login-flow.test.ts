import { ApiError } from '@alocidadao/api-client';
import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../lib/installation-id';
import {
  apiErrorMessage,
  apiRetryAfterSeconds,
  errorMessage,
  formatCountdown,
  nextStepAfterVerify,
  OUTBOX_OWNER_KEY,
  phoneFromInput,
  SIGNUP_EXPIRED_MESSAGE,
  syncOutboxOwner,
} from './login-flow';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
}

const SESSION = { accessToken: 'a', refreshToken: 'r', accessExpiresInSeconds: 900 };
const CHALLENGE_ID = '7d0c6a3e-8f43-4c1e-9a55-2b4f0f6d1a10';

describe('login flow', () => {
  it('nextStepAfterVerify routes each status', () => {
    expect(nextStepAfterVerify({ status: 'signed_in', session: SESSION })).toEqual({
      route: 'home',
    });
    expect(nextStepAfterVerify({ status: 'needs_profile', signupToken: 'st-1' })).toEqual({
      route: '/(auth)/quase-la',
      signupToken: 'st-1',
    });
    expect(
      nextStepAfterVerify({
        status: 'email_check',
        recoveryChallengeId: CHALLENGE_ID,
        maskedEmail: 'm•••@exemplo.com',
        signupToken: 'st-2',
      }),
    ).toEqual({
      route: '/(auth)/confirmar-email',
      recoveryChallengeId: CHALLENGE_ID,
      maskedEmail: 'm•••@exemplo.com',
      signupToken: 'st-2',
    });
  });

  it('errorMessage covers every API code and falls back', () => {
    expect(errorMessage('code_invalid')).toBe('Código incorreto. Confira e tente de novo.');
    expect(errorMessage('code_expired')).toBe('O código venceu. Peça um novo.');
    expect(errorMessage('code_locked')).toBe('Muitas tentativas. Peça um novo código.');
    expect(errorMessage('code_rate_limited', 30)).toBe('Aguarde 30 s para pedir outro código.');
    expect(errorMessage('rate_limited', 30)).toBe('Aguarde 30 s para pedir outro código.');
    expect(errorMessage('phone_in_use')).toBe(
      'Este número já tem uma conta. Volte e entre de novo.',
    );
    expect(errorMessage('email_in_use')).toBe(
      'Este e-mail já está em uso. Deixe em branco ou use outro.',
    );
    expect(errorMessage('phone_code_not_configured')).toBe(
      'Não foi possível enviar o código agora. Tente mais tarde.',
    );
    expect(errorMessage('phone_code_not_sent')).toBe(
      'Não foi possível enviar o código agora. Tente de novo em instantes.',
    );
    expect(errorMessage('signup_token_invalid')).toBe('Algo deu errado. Tente de novo.');
    expect(errorMessage(undefined)).toBe('Algo deu errado. Tente de novo.');
  });

  it('rate limit message uses retryAfterSeconds', () => {
    const error = new ApiError(429, { code: 'code_rate_limited', retryAfterSeconds: 42 });
    expect(apiErrorMessage(error)).toBe('Aguarde 42 s para pedir outro código.');
    expect(apiErrorMessage(new ApiError(429, { code: 'rate_limited', retryAfterSeconds: 7 }))).toBe(
      'Aguarde 7 s para pedir outro código.',
    );
    // Sem o tempo na resposta, usa o intervalo padrão de reenvio.
    expect(errorMessage('code_rate_limited')).toBe('Aguarde 60 s para pedir outro código.');
  });

  it('apiRetryAfterSeconds reads the wait of a rate limit', () => {
    expect(
      apiRetryAfterSeconds(new ApiError(429, { code: 'code_rate_limited', retryAfterSeconds: 42 })),
    ).toBe(42);
    expect(apiRetryAfterSeconds(new ApiError(429, { code: 'rate_limited' }))).toBeNull();
    expect(apiRetryAfterSeconds(new ApiError(400, { code: 'code_invalid' }))).toBeNull();
    expect(apiRetryAfterSeconds(new TypeError('Network request failed'))).toBeNull();
  });

  it('profile and signup messages', () => {
    expect(errorMessage('email_managed_by_admin')).toBe(
      'O e-mail da sua conta do painel é alterado pelo administrador.',
    );
    expect(SIGNUP_EXPIRED_MESSAGE).toBe('O tempo para concluir o cadastro acabou. Comece de novo.');
  });

  it('apiErrorMessage falls back for network errors and odd bodies', () => {
    expect(apiErrorMessage(new TypeError('Network request failed'))).toBe(
      'Algo deu errado. Tente de novo.',
    );
    expect(apiErrorMessage(new ApiError(502, '<html>'))).toBe('Algo deu errado. Tente de novo.');
    expect(apiErrorMessage(new ApiError(400, { code: 'code_expired' }))).toBe(
      'O código venceu. Peça um novo.',
    );
  });

  it('switching user clears offline data', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const clearOfflineData = vi.fn(async () => undefined);

    await syncOutboxOwner({ store, userId: 'user-b', clearOfflineData });

    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-b');
  });

  it('same user keeps offline data', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const clearOfflineData = vi.fn(async () => undefined);

    await syncOutboxOwner({ store, userId: 'user-a', clearOfflineData });

    expect(clearOfflineData).not.toHaveBeenCalled();
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('unknown owner clears offline data before saving the new one', async () => {
    const store = memoryStore();
    const order: string[] = [];
    const clearOfflineData = vi.fn(async () => {
      order.push(`clear:${store.data.get(OUTBOX_OWNER_KEY) ?? 'none'}`);
    });

    await syncOutboxOwner({ store, userId: 'user-a', clearOfflineData });

    expect(order).toEqual(['clear:none']);
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('failed clear keeps the previous owner', async () => {
    const store = memoryStore({ [OUTBOX_OWNER_KEY]: 'user-a' });
    const clearOfflineData = vi.fn(async () => {
      throw new Error('disk');
    });

    await expect(syncOutboxOwner({ store, userId: 'user-b', clearOfflineData })).rejects.toThrow(
      'disk',
    );
    expect(store.data.get(OUTBOX_OWNER_KEY)).toBe('user-a');
  });

  it('phoneFromInput accepts only a complete Brazilian mobile', () => {
    expect(phoneFromInput('(11) 98765-4321')).toBe('+5511987654321');
    expect(phoneFromInput('(11) 98765-432')).toBeNull();
    expect(phoneFromInput('(11) 38765-4321')).toBeNull();
    expect(phoneFromInput('(01) 98765-4321')).toBeNull();
  });

  it('formatCountdown shows minutes and seconds', () => {
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
