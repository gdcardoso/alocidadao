import type { MeResponse } from '@alocidadao/shared';
import type { KeyValueStore } from '../lib/installation-id';
import { OUTBOX_OWNER_KEY, syncOutboxOwner } from './login-flow';

// Abertura, login e saída da sessão, sem nada nativo (testável em Node). O dono da fila
// offline (OUTBOX_OWNER_KEY) só fica gravado quando se sabe que a fila é dele.

export type RestoredSession =
  { status: 'signedOut' } | { status: 'signedIn'; me: MeResponse | null };

/**
 * Abertura do app. Com `me`, confere o dono da fila antes de liberar as telas. Sem rede, abre
 * logado; se não há dono gravado (login que não terminou), a fila pode ser de outra pessoa e
 * é apagada.
 */
export async function restoreSession({
  store,
  hasTokens,
  fetchMe,
  clearOfflineData,
  dropTokens,
  isUnauthorized,
}: {
  store: KeyValueStore;
  hasTokens: () => Promise<boolean>;
  fetchMe: () => Promise<MeResponse>;
  clearOfflineData: () => Promise<void>;
  /** Apaga só a sessão (a fila fica para o mesmo dono, se ele voltar). */
  dropTokens: () => Promise<void>;
  isUnauthorized: (error: unknown) => boolean;
}): Promise<RestoredSession> {
  if (!(await hasTokens().catch(() => false))) return { status: 'signedOut' };

  const signedOut = async (): Promise<RestoredSession> => {
    await dropTokens().catch(() => undefined);
    return { status: 'signedOut' };
  };

  let me: MeResponse;
  try {
    me = await fetchMe();
  } catch (error) {
    if (isUnauthorized(error)) return signedOut();
    // Sem rede ou servidor fora: o app abre logado, com o que tiver guardado.
    try {
      if ((await store.getItem(OUTBOX_OWNER_KEY)) === null) await clearOfflineData();
    } catch {
      return signedOut();
    }
    return { status: 'signedIn', me: null };
  }

  try {
    await syncOutboxOwner({ store, userId: me.id, clearOfflineData });
  } catch {
    // Sem conseguir limpar a fila de outra pessoa, não dá para abrir: um novo login tenta de novo.
    return signedOut();
  }
  return { status: 'signedIn', me };
}

/**
 * Login com a conferência do dono da fila. O dono anterior é esquecido antes de gravar a
 * sessão: se o app fechar no meio, a próxima abertura ou login apaga a fila.
 */
export async function signInWithOwnerCheck({
  store,
  saveTokens,
  fetchMe,
  clearOfflineData,
  undoTokens,
}: {
  store: KeyValueStore;
  saveTokens: () => Promise<void>;
  fetchMe: () => Promise<MeResponse>;
  clearOfflineData: () => Promise<void>;
  undoTokens: () => Promise<void>;
}): Promise<MeResponse> {
  const previousOwner = await store.getItem(OUTBOX_OWNER_KEY);
  await store.deleteItem(OUTBOX_OWNER_KEY);
  let clearing = false;
  try {
    await saveTokens();
    const me = await fetchMe();
    if (previousOwner !== me.id) {
      clearing = true;
      await clearOfflineData();
    }
    await store.setItem(OUTBOX_OWNER_KEY, me.id);
    return me;
  } catch (error) {
    // Sem saber quem entrou, não dá para conferir a fila: desfaz o login e a tela mostra o erro.
    await undoTokens().catch(() => undefined);
    // A fila não foi tocada: continua do dono anterior. Limpeza pela metade: fica sem dono.
    if (!clearing && previousOwner !== null) {
      await store.setItem(OUTBOX_OWNER_KEY, previousOwner).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Saída que nunca falha: apaga a sessão e, se pedido, a fila e o cache. Se a limpeza falhar,
 * esquece o dono da fila, para o próximo login apagar tudo; o erro vai para `onError`.
 */
export async function signOutSafely({
  store,
  dropTokens,
  clearOfflineData,
  onError,
}: {
  store: KeyValueStore;
  dropTokens: () => Promise<void>;
  /** `null`: mantém a fila e o cache no aparelho. */
  clearOfflineData: (() => Promise<void>) | null;
  onError: (error: unknown) => void;
}): Promise<void> {
  try {
    await dropTokens();
  } catch (error) {
    onError(error);
  }
  if (!clearOfflineData) return;
  try {
    await clearOfflineData();
  } catch (error) {
    await store.deleteItem(OUTBOX_OWNER_KEY).catch(() => undefined);
    onError(error);
  }
}
