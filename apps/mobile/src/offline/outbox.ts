import type { ConnectionContext, WorkOrderActionInput } from '@alocidadao/shared';

export type OutboxStatus = 'pending' | 'sending' | 'done' | 'conflict' | 'failed';

export interface OutboxItem {
  id: string;
  workOrderId: string;
  action: 'start' | 'complete';
  occurredAt: string;
  note: string | null;
  photoPaths: string[];
  photoKeys: (string | null)[];
  createdOffline: boolean;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
}

export interface OutboxStore {
  add(item: OutboxItem): Promise<void>;
  /** Itens `pending`, em ordem de `createdAt` (empate: ordem de inserção). */
  listPending(): Promise<OutboxItem[]>;
  update(id: string, patch: Partial<OutboxItem>): Promise<void>;
  resetInFlight(): Promise<void>;
  list(): Promise<OutboxItem[]>;
}

export type SendActionResult =
  { kind: 'ok' } | { kind: 'conflict'; status: string } | { kind: 'rejected'; code: string };

export interface Transport {
  uploadPhoto(path: string): Promise<{ key: string; durationMs: number }>;
  sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendActionResult>;
}

/** Falha de rede ou tempo esgotado: o item volta para a fila. */
export class NetworkError extends Error {
  constructor(message = 'network_error') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** O arquivo da foto não existe mais no aparelho. */
export class PhotoMissingError extends Error {
  constructor(message = 'photo_missing') {
    super(message);
    this.name = 'PhotoMissingError';
  }
}

/** Erros inesperados (não de rede) esgotam a paciência depois de tantas tentativas. */
export const MAX_UNEXPECTED_ATTEMPTS = 5;

export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** (attempts - 1), 300_000);
}

export interface ProcessOutboxDeps {
  store: OutboxStore;
  transport: Transport;
  connection: (m: {
    uploadDurationMs: number | null;
    sentOffline: boolean;
  }) => Promise<ConnectionContext>;
  now?: () => number;
}

export interface ProcessOutboxResult {
  sent: number;
  conflicts: number;
  failed: number;
  stoppedByNetwork: boolean;
}

export async function processOutbox(deps: ProcessOutboxDeps): Promise<ProcessOutboxResult> {
  const { store, transport, connection } = deps;
  const now = deps.now ?? Date.now;
  const result: ProcessOutboxResult = {
    sent: 0,
    conflicts: 0,
    failed: 0,
    stoppedByNetwork: false,
  };

  await store.resetInFlight();
  const items = await store.listPending();

  for (const item of items) {
    // Fila estritamente FIFO: um item em espera de backoff trava os mais novos.
    if (item.nextAttemptAt > now()) break;
    await store.update(item.id, { status: 'sending' });
    try {
      const photoKeys = [...item.photoKeys];
      let uploadedMs = 0;
      let uploads = 0;
      for (let i = 0; i < item.photoPaths.length; i++) {
        if (photoKeys[i]) continue;
        const uploaded = await transport.uploadPhoto(item.photoPaths[i]!);
        photoKeys[i] = uploaded.key;
        uploadedMs += uploaded.durationMs;
        uploads++;
        await store.update(item.id, { photoKeys: [...photoKeys] });
      }

      const context = await connection({
        uploadDurationMs: uploads > 0 ? uploadedMs : null,
        sentOffline: item.createdOffline,
      });
      const input: WorkOrderActionInput = {
        clientActionId: item.id,
        action: item.action,
        occurredAt: item.occurredAt,
        ...(item.note ? { note: item.note } : {}),
        photoKeys: photoKeys.filter((k): k is string => k !== null),
        connection: context,
      };
      const outcome = await transport.sendAction(item.workOrderId, input);

      if (outcome.kind === 'ok') {
        await store.update(item.id, { status: 'done', lastError: null });
        result.sent++;
      } else if (outcome.kind === 'conflict') {
        await store.update(item.id, { status: 'conflict', lastError: outcome.status });
        result.conflicts++;
      } else {
        await store.update(item.id, { status: 'failed', lastError: outcome.code });
        result.failed++;
      }
    } catch (error) {
      if (error instanceof NetworkError) {
        const attempts = item.attempts + 1;
        await store.update(item.id, {
          status: 'pending',
          attempts,
          nextAttemptAt: now() + backoffMs(attempts),
          lastError: error.message,
        });
        result.stoppedByNetwork = true;
        break;
      }
      if (error instanceof PhotoMissingError) {
        await store.update(item.id, { status: 'failed', lastError: 'photo_missing' });
        result.failed++;
        continue;
      }
      const attempts = item.attempts + 1;
      const detail = error instanceof Error ? error.message : String(error);
      if (attempts >= MAX_UNEXPECTED_ATTEMPTS) {
        await store.update(item.id, {
          status: 'failed',
          attempts,
          lastError: `unexpected_error: ${detail}`,
        });
        result.failed++;
        continue;
      }
      await store.update(item.id, {
        status: 'pending',
        attempts,
        nextAttemptAt: now() + backoffMs(attempts),
        lastError: `unexpected_error: ${detail}`,
      });
      result.stoppedByNetwork = true;
      break;
    }
  }
  return result;
}

export interface EnqueueDeps {
  randomUuid: () => string;
  /** Copia a foto para a pasta durável do item e devolve o novo caminho. */
  stashPhoto: (id: string, uri: string, index: number) => Promise<string>;
  now?: () => number;
}

/**
 * Enfileira uma ação do agente. Diferença da assinatura do plano: o 3º parâmetro
 * injeta `randomUuid` e `stashPhoto` (nativos); veja `nativeEnqueueDeps`.
 */
export async function enqueueWorkOrderAction(
  store: OutboxStore,
  input: {
    workOrderId: string;
    action: 'start' | 'complete';
    note?: string;
    photoUris?: string[];
    online: boolean;
  },
  deps: EnqueueDeps,
): Promise<OutboxItem> {
  const now = deps.now ?? Date.now;
  const id = deps.randomUuid();
  const photoPaths: string[] = [];
  const uris = input.photoUris ?? [];
  for (let i = 0; i < uris.length; i++) {
    photoPaths.push(await deps.stashPhoto(id, uris[i]!, i));
  }
  const item: OutboxItem = {
    id,
    workOrderId: input.workOrderId,
    action: input.action,
    occurredAt: new Date(now()).toISOString(),
    note: input.note ?? null,
    photoPaths,
    photoKeys: photoPaths.map(() => null),
    createdOffline: !input.online,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: now(),
  };
  await store.add(item);
  return item;
}
