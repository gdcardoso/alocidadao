import { ApiError } from '@alocidadao/api-client';
import type { RefreshResponse, SessionTokens } from '@alocidadao/shared';
import type { KeyValueStore } from '../lib/installation-id';
import { NetworkError } from '../offline/outbox';

/** O que a sessão usa da API (o `api-client` atende; nos testes, um falso). */
export interface SessionApi {
  refresh(refreshToken: string): Promise<RefreshResponse>;
  logout(accessToken: string): Promise<void>;
}

export interface SessionManager {
  signIn(tokens: SessionTokens): Promise<void>;
  /** Token de acesso válido, renovado se preciso; `null` sem sessão. Falha de rede rejeita. */
  getAccessToken(): Promise<string | null>;
  signOut(): Promise<void>;
  isSignedIn(): Promise<boolean>;
}

const REFRESH_KEY = 'refresh-token';
/** Renova quando faltam menos de 30 s para o token de acesso vencer. */
const REFRESH_MARGIN_MS = 30_000;

/**
 * Sessão do app, sem nada nativo (testável em Node). O token de renovação fica no `store`;
 * o de acesso, só em memória, com o vencimento calculado por `accessExpiresInSeconds`.
 */
export function createSessionManager({
  store,
  api,
  now = Date.now,
}: {
  store: KeyValueStore;
  api: SessionApi;
  now?: () => number;
}): SessionManager {
  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string | null> | null = null;
  // Muda a cada login/saída: renovação que termina depois disso é descartada.
  let generation = 0;

  const valid = () => (access && access.expiresAt - now() >= REFRESH_MARGIN_MS ? access : null);

  async function clear() {
    generation++;
    access = null;
    refreshing = null;
    await store.deleteItem(REFRESH_KEY);
  }

  async function refresh(): Promise<string | null> {
    const startedGeneration = generation;
    const refreshToken = await store.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    const startedAt = now();
    let response: RefreshResponse;
    try {
      response = await api.refresh(refreshToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Sessão encerrada, conta congelada ou excluída: só um novo login resolve.
        if (generation === startedGeneration) await clear();
        return null;
      }
      // Sem rede, tempo esgotado ou servidor fora: a sessão continua e o chamador tenta depois.
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : 'refresh_failed');
    }
    if (generation !== startedGeneration) return valid()?.token ?? null;
    access = {
      token: response.accessToken,
      expiresAt: startedAt + response.accessExpiresInSeconds * 1000,
    };
    return access.token;
  }

  function getAccessToken(): Promise<string | null> {
    const current = valid();
    if (current) return Promise.resolve(current.token);
    // Renovações simultâneas viram uma só.
    if (!refreshing) {
      const run: Promise<string | null> = refresh().finally(() => {
        if (refreshing === run) refreshing = null;
      });
      refreshing = run;
    }
    return refreshing;
  }

  return {
    async signIn(tokens) {
      generation++;
      refreshing = null;
      await store.setItem(REFRESH_KEY, tokens.refreshToken);
      access = {
        token: tokens.accessToken,
        expiresAt: now() + tokens.accessExpiresInSeconds * 1000,
      };
    },

    getAccessToken,

    async signOut() {
      let token = valid()?.token ?? null;
      if (!token) {
        // Depois de reabrir o app não há token em memória: tenta um para avisar o servidor.
        token = await getAccessToken().catch(() => null);
      }
      if (token) {
        try {
          await api.logout(token);
        } catch {
          // Sem rede ou erro do servidor: sai do aparelho mesmo assim.
        }
      }
      await clear();
    },

    async isSignedIn() {
      return (await store.getItem(REFRESH_KEY)) !== null;
    },
  };
}
