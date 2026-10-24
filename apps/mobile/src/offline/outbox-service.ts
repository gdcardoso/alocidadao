import NetInfo from '@react-native-community/netinfo';
import { OUTBOX_OWNER_KEY } from '../auth/login-flow';
import { createSessionTransport } from '../auth/native-session';
import { api } from '../lib/api';
import { measureApiLatency, toConnectionContext } from '../lib/connection';
import { readNetSnapshot } from '../lib/net-info';
import { secureStore } from '../lib/secure-store';
import {
  processOutbox,
  processOutboxItem,
  type CreatedRequest,
  type ItemOutcome,
  type OutboxItem,
  type ProcessOutboxDeps,
} from './outbox';
import {
  emitOutbox,
  exclusive,
  rememberSentRequests,
  setOutboxItems,
  type SentRequest,
} from './outbox-state';
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

export { getOutboxSnapshot, subscribeOutbox, type OutboxSnapshot } from './outbox-state';

/** Resultado de uma passada para quem a acompanha. */
export interface OutboxSyncedEvent {
  /** Itens enviados nesta passada (ações e solicitações). */
  sent: number;
}

const syncedListeners = new Set<(event: OutboxSyncedEvent) => void>();

/** Avisa depois de cada passada da fila (as telas atualizam as listas). */
export function onOutboxSynced(listener: (event: OutboxSyncedEvent) => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
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
  setOutboxItems(await store.list());
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

/** Guarda as solicitações enviadas (com o id do servidor) antes de elas saírem da fila. */
async function rememberCreated(store: SqliteOutboxStore, created: readonly CreatedRequest[]) {
  if (created.length === 0) return;
  const byId = new Map((await store.list()).map((item) => [item.id, item]));
  const sent: SentRequest[] = [];
  for (const { itemId, requestId } of created) {
    const item = byId.get(itemId);
    if (item) sent.push({ item, requestId });
  }
  rememberSentRequests(sent);
}

async function syncPass(): Promise<void> {
  emitOutbox({ syncing: true });
  let sent = 0;
  try {
    const store = await openOutboxStore();
    // Montado a cada passada: pega a sessão do login atual (a prefeitura vem de cada item).
    const transport = await createSessionTransport();
    const ownerId = await secureStore.getItem(OUTBOX_OWNER_KEY);
    const result = await processOutbox({ store, transport, connection, ownerId });
    sent = result.sent;
    // O cartão da enviada fica na tela 4 até a lista do servidor trazer a solicitação.
    await rememberCreated(store, result.created);
    await pruneSentRequests(store);
    emitOutbox({ lastSyncError: null });
  } catch (error) {
    // Uma passada que falha não pode derrubar o rearme do timer nem virar rejeição solta.
    console.warn('Falha na sincronização da fila', error);
    emitOutbox({ lastSyncError: error instanceof Error ? error.message : String(error) });
  } finally {
    emitOutbox({ syncing: false });
    await refreshOutbox().catch((error: unknown) => console.warn('Falha ao ler a fila', error));
    for (const listener of syncedListeners) listener({ sent });
  }
  await scheduleRetry().catch((error: unknown) => console.warn('Falha ao reagendar a fila', error));
}

/** Uma passada pela fila; chamadas ao mesmo tempo compartilham a mesma passada. */
export const syncOutbox: () => Promise<void> = createSingleFlight(() => exclusive(syncPass));

type EnqueueInput = Parameters<typeof enqueueCreateRequestNative>[1];

/**
 * Guarda a solicitação na fila e, com `sendNow`, envia na hora. Se a rede cair no meio, o item
 * fica na fila (`retry`) e sai sozinho depois: o relato nunca se perde. Recusa na hora não
 * fica na fila: quem chama mostra o motivo com a tela ainda aberta. `online` diz só se o
 * aparelho tinha rede (o item criado sem ela vai marcado como offline).
 */
export function submitCreateRequest(
  input: EnqueueInput & { sendNow: boolean },
): Promise<{ item: OutboxItem; outcome: ItemOutcome | null }> {
  return exclusive(async () => {
    const store = await openOutboxStore();
    const { sendNow, ...enqueueInput } = input;
    const item = await enqueueCreateRequestNative(store, enqueueInput);
    let outcome: ItemOutcome | null = null;
    if (sendNow) {
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
