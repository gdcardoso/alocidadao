import type { OutboxItem } from './outbox';

// Estado da fila em memória, compartilhado pelas telas, sem nada nativo (testável em Node).

/** Solicitação enviada pela fila que a lista do servidor ainda não trouxe. */
export interface SentRequest {
  item: OutboxItem;
  requestId: string;
}

export interface OutboxSnapshot {
  items: OutboxItem[];
  /** Enviadas numa passada: o cartão delas fica na tela 4 até a lista do servidor trazê-las. */
  sent: SentRequest[];
  syncing: boolean;
  lastSyncError: string | null;
}

const EMPTY: OutboxSnapshot = { items: [], sent: [], syncing: false, lastSyncError: null };

let snapshot: OutboxSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function emitOutbox(patch: Partial<OutboxSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getOutboxSnapshot = (): OutboxSnapshot => snapshot;

export function setOutboxItems(items: OutboxItem[]): void {
  emitOutbox({ items });
}

export function rememberSentRequests(sent: readonly SentRequest[]): void {
  if (sent.length === 0) return;
  const ids = new Set(sent.map((s) => s.item.id));
  emitOutbox({ sent: [...snapshot.sent.filter((s) => !ids.has(s.item.id)), ...sent] });
}

/** A lista do servidor já trouxe estas solicitações: os cartões da fila saem. */
export function forgetSentRequests(requestIds: readonly string[]): void {
  const settled = new Set(requestIds);
  const sent = snapshot.sent.filter((s) => !settled.has(s.requestId));
  if (sent.length !== snapshot.sent.length) emitOutbox({ sent });
}

let chain: Promise<unknown> = Promise.resolve();

/** Roda as tarefas da fila uma de cada vez, na ordem em que chegaram. */
export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Apaga os dados da fila (`wipe`) na vez dela, depois da passada em andamento, e esvazia o
 * que as telas mostram: a fila de quem saiu não aparece para a próxima conta.
 */
export function clearOutbox(wipe: () => Promise<void>): Promise<void> {
  return exclusive(async () => {
    try {
      await wipe();
    } finally {
      emitOutbox({ items: [], sent: [], lastSyncError: null });
    }
  });
}
