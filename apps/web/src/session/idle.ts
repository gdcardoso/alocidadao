/** Sem ação da pessoa por este tempo, o painel sai sozinho. */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** O aviso "Sua sessão vai encerrar" aparece este tempo antes. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;
/** Hora da última ação, em `localStorage`, para as abas abertas contarem como uma só. */
export const LAST_ACTIVITY_KEY = 'ac_panel_last_activity';
/** Grava no máximo uma vez neste prazo (cliques e teclas chegam em rajadas). */
const WRITE_INTERVAL_MS = 5_000;

export type IdlePhase = 'active' | 'warning' | 'idle';

export interface IdleTracker {
  /** Ação da pessoa nesta aba. `force` grava na hora, sem esperar o intervalo. */
  touch(force?: boolean): void;
  /** Fase agora e quanto falta para sair, considerando a ação mais recente de qualquer aba. */
  check(): { phase: IdlePhase; remainingMs: number };
}

export interface IdleTrackerOptions {
  timeoutMs?: number;
  warningMs?: number;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function readStored(storage: IdleTrackerOptions['storage']): number {
  try {
    const value = Number(storage?.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Conta a falta de uso pela ação da pessoa (não pelas consultas automáticas do painel). Abrir o
 * painel conta como ação. Sem `localStorage`, cada aba conta sozinha.
 */
export function createIdleTracker({
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS,
  now = Date.now,
  storage = globalThis.localStorage ?? null,
}: IdleTrackerOptions = {}): IdleTracker {
  let last = 0;
  let written = 0;

  function touch(force = false) {
    last = now();
    if (!force && last - written < WRITE_INTERVAL_MS) return;
    written = last;
    try {
      storage?.setItem(LAST_ACTIVITY_KEY, String(last));
    } catch {
      // sem armazenamento: vale a conta desta aba.
    }
  }

  touch(true);

  return {
    touch,
    check() {
      const remainingMs = Math.max(last, readStored(storage)) + timeoutMs - now();
      if (remainingMs <= 0) return { phase: 'idle', remainingMs: 0 };
      return { phase: remainingMs <= warningMs ? 'warning' : 'active', remainingMs };
    },
  };
}
