import { ApiError } from '@alocidadao/api-client';
import { clearSupportTenant } from './support-tenant';

/** O que a sessão usa do cliente da API: só a renovação e a saída, que vão pelo cookie. */
export interface PanelSessionClient {
  panelRefresh(): Promise<{ accessToken: string; accessExpiresInSeconds: number }>;
  panelLogout(): Promise<void>;
}

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

export interface SessionState {
  status: SessionStatus;
  /** A sessão venceu durante o uso: o login mostra a faixa "Sua sessão expirou". */
  expiredNotice: boolean;
}

export interface AccessSession {
  accessToken: string;
  accessExpiresInSeconds: number;
}

export interface PanelSession {
  getAccessToken(): string | null;
  /** Renovação inicial, ao abrir o painel: `true` se o cookie ainda vale. */
  restore(): Promise<boolean>;
  signIn(session: AccessSession): void;
  /** Encerra no servidor; `expired` mostra no login a faixa "Sua sessão expirou" (falta de uso). */
  signOut(options?: { expired?: boolean }): Promise<void>;
  /** Faz a chamada; num 401, renova uma vez e repete. Renovações simultâneas viram uma só. */
  withAuth<T>(call: () => Promise<T>): Promise<T>;
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
}

export interface PanelSessionOptions {
  client: PanelSessionClient;
  /** Chamado quando a renovação falha com a sessão aberta (antes do login de novo). */
  onExpired?: () => void;
}

/** Renova o token de acesso este tempo antes de ele vencer. */
const REFRESH_MARGIN_SECONDS = 60;
/** Depois de uma falha (rede, 429, 5xx) na renovação agendada, tenta de novo neste prazo. */
const RETRY_DELAY_MS = 30_000;

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/**
 * Sessão do painel. O token de acesso fica só na memória; o de renovação, no cookie
 * HttpOnly `ac_panel_refresh`, que só a API lê.
 */
export function createPanelSession({ client, onExpired }: PanelSessionOptions): PanelSession {
  let accessToken: string | null = null;
  let state: SessionState = { status: 'loading', expiredNotice: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshing: Promise<boolean> | null = null;
  let restoring: Promise<boolean> | null = null;
  // Muda a cada entrada ou saída: renovação que termina depois disso é descartada.
  let generation = 0;
  const listeners = new Set<() => void>();

  function setState(next: SessionState) {
    if (next.status === state.status && next.expiredNotice === state.expiredNotice) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** Agenda a renovação. Falha que não seja 401 tenta de novo em 30 s com a sessão aberta. */
  function scheduleRefresh(delayMs: number) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      refresh().catch(() => {
        // Um 401 já encerrou a sessão dentro de `refresh`; aqui chega falha de rede, 429 ou 5xx. Se
        // outra entrada ou renovação já agendou um timer, ele vale.
        if (state.status === 'signed_in' && timer === null) scheduleRefresh(RETRY_DELAY_MS);
      });
    }, delayMs);
  }

  function apply(session: AccessSession) {
    accessToken = session.accessToken;
    scheduleRefresh(Math.max(0, session.accessExpiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000);
    setState({ status: 'signed_in', expiredNotice: false });
  }

  function clear(expiredNotice: boolean) {
    generation += 1;
    accessToken = null;
    // O modo suporte é de quem entrou: saída, expiração e restauração falha o apagam.
    clearSupportTenant();
    clearTimer();
    setState({ status: 'signed_out', expiredNotice });
  }

  function expire() {
    clear(true);
    onExpired?.();
  }

  /** Renova o token (uma só renovação por vez). Só o 401 da API encerra a sessão. */
  function refresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    const started = generation;
    refreshing = client
      .panelRefresh()
      .then(
        (session) => {
          if (started !== generation) return false;
          apply(session);
          return true;
        },
        (error: unknown) => {
          if (started !== generation) return false;
          // Só a recusa do cookie (401 session_expired) encerra a sessão. Rede, 429 e 5xx
          // não derrubam o gestor: o erro volta à chamada e a renovação agendada tenta de novo.
          if (!isUnauthorized(error)) throw error;
          expire();
          return false;
        },
      )
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  return {
    getAccessToken: () => accessToken,

    restore() {
      if (restoring) return restoring;
      const started = generation;
      restoring = client
        .panelRefresh()
        .then(
          (session) => {
            if (started !== generation) return state.status === 'signed_in';
            apply(session);
            return true;
          },
          () => {
            if (started !== generation) return state.status === 'signed_in';
            clear(false);
            return false;
          },
        )
        .finally(() => {
          restoring = null;
        });
      return restoring;
    },

    signIn(session) {
      generation += 1;
      // Nova entrada nunca herda o modo suporte de outra pessoa.
      clearSupportTenant();
      apply(session);
    },

    async signOut(options) {
      clear(options?.expired ?? false);
      try {
        await client.panelLogout();
      } catch {
        // O token de acesso já saiu da memória; o cookie vence sozinho.
      }
    },

    async withAuth<T>(call: () => Promise<T>): Promise<T> {
      const tokenBefore = accessToken;
      try {
        return await call();
      } catch (error) {
        if (!isUnauthorized(error) || state.status !== 'signed_in') throw error;
        // Outra chamada já renovou enquanto esta estava no ar: só repete.
        const renewed = accessToken !== tokenBefore || (await refresh());
        if (!renewed) throw error;
        return call();
      }
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
