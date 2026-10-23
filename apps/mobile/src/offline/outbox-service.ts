import NetInfo from '@react-native-community/netinfo';
import { createSessionTransport } from '../auth/native-session';
import { api } from '../lib/api';
import { measureApiLatency, toConnectionContext } from '../lib/connection';
import { readNetSnapshot } from '../lib/net-info';
import {
  processOutbox,
  processOutboxItem,
  type ItemOutcome,
  type OutboxItem,
  type ProcessOutboxDeps,
} from './outbox';
import { createSingleFlight } from './single-flight';
import {
  enqueueCreateRequestNative,
  openOutboxStore,
  type SqliteOutboxStore,
} from './sqlite-outbox-store';

// A fila do app, uma só para todas as telas: as passadas de envio, o envio imediato da Nova
// solicitação e a remoção rodam uma de cada vez, para nenhum item ser enviado duas vezes.

/** Monta o contexto de conexão de cada envio (rede, latência até a API, upload, offline). */
const connection: ProcessOutboxDeps['connection'] = async (m) => {
  const net = await readNetSnapshot();
  const apiLatencyMs = await measureApiLatency(() => api.health());
  return toConnectionContext(net, {
    apiLatencyMs,
    uploadDurationMs: m.uploadDurationMs,
    sentOffline: m.sentOffline,
  });
};

export interface OutboxSnapshot {
  items: OutboxItem[];
  syncing: boolean;
  lastSyncError: string | null;
}

let snapshot: OutboxSnapshot = { items: [], syncing: false, lastSyncError: null };
const listeners = new Set<() => void>();
const syncedListeners = new Set<() => void>();

function emit(patch: Partial<OutboxSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getOutboxSnapshot = (): OutboxSnapshot => snapshot;

/** Avisa depois de cada passada da fila (o Laboratório atualiza a lista dele). */
export function onOutboxSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

let chain: Promise<unknown> = Promise.resolve();

/** Roda as tarefas da fila uma de cada vez, na ordem em que chegaram. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/** Solicitação enviada não precisa mais ficar na tabela (as fotos já saíram com o `done`). */
async function pruneSentRequests(store: SqliteOutboxStore): Promise<void> {
  for (const item of await store.list()) {
    if (item.kind === 'create_request' && item.status === 'done') await store.remove(item.id);
  }
}

/** Relê a fila para as telas. */
export async function refreshOutbox(): Promise<void> {
  const store = await openOutboxStore();
  emit({ items: await store.list() });
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Itens em espera de backoff: tenta de novo quando vencerem (só com rede). */
async function scheduleRetry(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const store = await openOutboxStore();
  const waiting = await store.listPending();
  if (waiting.length === 0 || (await NetInfo.fetch()).isConnected !== true) return;
  const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
  retryTimer = setTimeout(() => void syncOutbox(), Math.max(next - Date.now(), 0) + 200);
}

async function syncPass(): Promise<void> {
  emit({ syncing: true });
  try {
    const store = await openOutboxStore();
    // Montado a cada passada: pega a sessão (e a prefeitura do Laboratório) do login atual.
    const transport = await createSessionTransport();
    await processOutbox({ store, transport, connection });
    await pruneSentRequests(store);
    emit({ lastSyncError: null });
  } catch (error) {
    // Uma passada que falha não pode derrubar o rearme do timer nem virar rejeição solta.
    console.warn('Falha na sincronização da fila', error);
    emit({ lastSyncError: error instanceof Error ? error.message : String(error) });
  } finally {
    emit({ syncing: false });
    await refreshOutbox().catch((error: unknown) => console.warn('Falha ao ler a fila', error));
    for (const listener of syncedListeners) listener();
  }
  await scheduleRetry().catch((error: unknown) => console.warn('Falha ao reagendar a fila', error));
}

/** Uma passada pela fila; chamadas ao mesmo tempo compartilham a mesma passada. */
export const syncOutbox: () => Promise<void> = createSingleFlight(() => exclusive(syncPass));

type EnqueueInput = Parameters<typeof enqueueCreateRequestNative>[1];

/**
 * Guarda a solicitação na fila e, com rede, envia na hora. Se a rede cair no meio, o item
 * fica na fila (`retry`) e sai sozinho depois: o relato nunca se perde. Recusa na hora não
 * fica na fila: quem chama mostra o motivo com a tela ainda aberta.
 */
export function submitCreateRequest(
  input: EnqueueInput,
): Promise<{ item: OutboxItem; outcome: ItemOutcome | null }> {
  return exclusive(async () => {
    const store = await openOutboxStore();
    const item = await enqueueCreateRequestNative(store, input);
    let outcome: ItemOutcome | null = null;
    if (input.online) {
      try {
        const transport = await createSessionTransport();
        outcome = await processOutboxItem({ store, transport, connection }, item);
        // Enviada ou recusada na hora: a tela mostra o resultado e o item sai da fila.
        if (outcome.kind !== 'retry') await store.remove(item.id);
      } catch (error) {
        // Erro fora do envio (ex.: banco): o item continua pendente para a próxima passada.
        console.warn('Falha ao enviar a solicitação', error);
        await store.update(item.id, { status: 'pending' }).catch(() => undefined);
        outcome = { kind: 'retry', error: error instanceof Error ? error.message : String(error) };
      }
    }
    await refreshOutbox().catch(() => undefined);
    if (outcome?.kind === 'retry') void scheduleRetry().catch(() => undefined);
    return { item, outcome };
  });
}

/** Tira o item da fila (e as fotos guardadas dele). */
export function removeOutboxItem(id: string): Promise<void> {
  return exclusive(async () => {
    const store = await openOutboxStore();
    await store.remove(id);
    await refreshOutbox();
  });
}
