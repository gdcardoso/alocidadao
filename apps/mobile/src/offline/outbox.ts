import type {
  ConnectionContext,
  CreateRequestInput,
  CreateRequestResponse,
  IconGroup,
  WorkOrderActionInput,
} from '@alocidadao/shared';

export type OutboxStatus = 'pending' | 'sending' | 'done' | 'conflict' | 'failed' | 'rejected';

export type OutboxKind = 'work_order_action' | 'create_request';

/** Município devolvido com `municipality_not_served` (a mensagem da 5c no item). */
export interface OutboxMunicipality {
  ibgeCode: string;
  name: string;
  state: string;
}

/** Motivo de uma recusa definitiva da API (não há nova tentativa). */
export interface OutboxRejection {
  code: string;
  municipality?: OutboxMunicipality | null;
}

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** Dono do item (o cidadão ou agente que registrou); `''` quando não se sabe. */
  userId: string;
  /** `WorkOrderActionPayload` ou `CreateRequestPayload`, conforme `kind`. */
  payload: unknown;
  photoPaths: string[];
  photoKeys: (string | null)[];
  createdOffline: boolean;
  status: OutboxStatus;
  rejection: OutboxRejection | null;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
}

export interface WorkOrderActionPayload {
  workOrderId: string;
  action: 'start' | 'complete';
  occurredAt: string;
  note: string | null;
}

/** O que a tela 4 mostra do item enquanto ele não vira solicitação. Não vai para a API. */
export interface QueuedRequestDisplay {
  categoryName: string;
  icon: string | null;
  iconGroup: IconGroup;
}

/** `CreateRequestInput` sem `photoKeys` e `connection`, que entram no envio. */
export type CreateRequestPayload = Omit<CreateRequestInput, 'photoKeys' | 'connection'> & {
  display: QueuedRequestDisplay;
};

export interface OutboxStore {
  add(item: OutboxItem): Promise<void>;
  /** Itens `pending`, em ordem de `createdAt` (empate: ordem de inserção). */
  listPending(): Promise<OutboxItem[]>;
  update(id: string, patch: Partial<OutboxItem>): Promise<void>;
  resetInFlight(): Promise<void>;
  list(): Promise<OutboxItem[]>;
  /** Tira o item da fila e apaga as fotos guardadas dele. */
  remove(id: string): Promise<void>;
}

export type SendActionResult =
  { kind: 'ok' } | { kind: 'conflict'; status: string } | { kind: 'rejected'; code: string };

export type SendCreateRequestResult =
  | { kind: 'ok'; result: CreateRequestResponse }
  | { kind: 'rejected'; code: string; municipality?: OutboxMunicipality | null }
  | { kind: 'occurrence_unavailable' };

export interface Transport {
  /** Envia a foto pela rota do tipo do item (agente ou cidadão). */
  uploadPhoto(path: string, kind: OutboxKind): Promise<{ key: string; durationMs: number }>;
  sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendActionResult>;
  sendCreateRequest(input: CreateRequestInput): Promise<SendCreateRequestResult>;
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

/** A API recusou o pedido de upload (4xx): reenviar não adianta. */
export class UploadRejectedError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'UploadRejectedError';
  }
}

/** Recusas da solicitação que ficam na fila como "recusada", com o motivo. */
export const REJECTION_CODES: readonly string[] = [
  'municipality_not_served',
  'category_unavailable',
];

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
  /**
   * Dono da fila guardado no aparelho (`OUTBOX_OWNER_KEY`). Com ele, itens de outra pessoa
   * ficam de fora da passada; itens sem dono (`''`) seguem.
   */
  ownerId?: string | null;
}

/** Solicitação que a passada criou: o item da fila e o id que ela ganhou no servidor. */
export interface CreatedRequest {
  itemId: string;
  requestId: string;
}

export interface ProcessOutboxResult {
  sent: number;
  conflicts: number;
  /** Itens que falharam ou foram recusados (os dois são finais). */
  failed: number;
  stoppedByNetwork: boolean;
  created: CreatedRequest[];
}

/** Como terminou o envio de um item. `retry`: voltou para a fila com espera. */
export type ItemOutcome =
  | { kind: 'sent'; result?: CreateRequestResponse }
  | { kind: 'conflict' }
  | { kind: 'failed'; code: string }
  | { kind: 'rejected'; rejection: OutboxRejection }
  | { kind: 'retry'; error: string };

/** Envia as fotos que faltam, guardando cada chave assim que ela chega. */
async function uploadMissingPhotos(
  deps: ProcessOutboxDeps,
  item: OutboxItem,
): Promise<{ photoKeys: string[]; uploadDurationMs: number | null }> {
  const photoKeys = [...item.photoKeys];
  let uploadedMs = 0;
  let uploads = 0;
  for (let i = 0; i < item.photoPaths.length; i++) {
    if (photoKeys[i]) continue;
    const uploaded = await deps.transport.uploadPhoto(item.photoPaths[i]!, item.kind);
    photoKeys[i] = uploaded.key;
    uploadedMs += uploaded.durationMs;
    uploads++;
    await deps.store.update(item.id, { photoKeys: [...photoKeys] });
  }
  return {
    photoKeys: photoKeys.filter((k): k is string => k !== null),
    uploadDurationMs: uploads > 0 ? uploadedMs : null,
  };
}

async function sendWorkOrderAction(
  deps: ProcessOutboxDeps,
  item: OutboxItem,
): Promise<ItemOutcome> {
  const payload = item.payload as WorkOrderActionPayload;
  const { photoKeys, uploadDurationMs } = await uploadMissingPhotos(deps, item);
  const context = await deps.connection({ uploadDurationMs, sentOffline: item.createdOffline });
  const input: WorkOrderActionInput = {
    clientActionId: item.id,
    action: payload.action,
    occurredAt: payload.occurredAt,
    ...(payload.note ? { note: payload.note } : {}),
    photoKeys,
    connection: context,
  };
  const outcome = await deps.transport.sendAction(payload.workOrderId, input);
  if (outcome.kind === 'ok') {
    await deps.store.update(item.id, { status: 'done', lastError: null });
    return { kind: 'sent' };
  }
  if (outcome.kind === 'conflict') {
    await deps.store.update(item.id, { status: 'conflict', lastError: outcome.status });
    return { kind: 'conflict' };
  }
  await deps.store.update(item.id, { status: 'failed', lastError: outcome.code });
  return { kind: 'failed', code: outcome.code };
}

async function sendCreateRequest(deps: ProcessOutboxDeps, item: OutboxItem): Promise<ItemOutcome> {
  // As fotos sempre sobem antes da solicitação.
  const { photoKeys, uploadDurationMs } = await uploadMissingPhotos(deps, item);
  const context = await deps.connection({ uploadDurationMs, sentOffline: item.createdOffline });
  const { display: _display, ...payload } = item.payload as CreateRequestPayload;
  let input: CreateRequestInput = { ...payload, photoKeys, connection: context };
  let outcome = await deps.transport.sendCreateRequest(input);

  if (outcome.kind === 'occurrence_unavailable' && input.occurrenceId) {
    // A ocorrência apoiada fechou no meio do caminho: vira um relato novo, uma vez só.
    const { occurrenceId: _occurrenceId, ...withoutOccurrence } = input;
    const { occurrenceId: _stored, ...storedPayload } = item.payload as CreateRequestPayload;
    await deps.store.update(item.id, { payload: storedPayload });
    input = withoutOccurrence;
    outcome = await deps.transport.sendCreateRequest(input);
  }

  if (outcome.kind === 'ok') {
    await deps.store.update(item.id, { status: 'done', lastError: null });
    return { kind: 'sent', result: outcome.result };
  }
  if (outcome.kind === 'occurrence_unavailable') {
    await deps.store.update(item.id, { status: 'failed', lastError: 'occurrence_unavailable' });
    return { kind: 'failed', code: 'occurrence_unavailable' };
  }
  if (REJECTION_CODES.includes(outcome.code)) {
    const rejection: OutboxRejection =
      outcome.municipality === undefined
        ? { code: outcome.code }
        : { code: outcome.code, municipality: outcome.municipality };
    await deps.store.update(item.id, { status: 'rejected', rejection, lastError: outcome.code });
    return { kind: 'rejected', rejection };
  }
  await deps.store.update(item.id, { status: 'failed', lastError: outcome.code });
  return { kind: 'failed', code: outcome.code };
}

/**
 * Envia um item da fila e grava o resultado nele. Falha de rede (ou erro inesperado ainda com
 * paciência) devolve o item para `pending` com espera.
 */
export async function processOutboxItem(
  deps: ProcessOutboxDeps,
  item: OutboxItem,
): Promise<ItemOutcome> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  await store.update(item.id, { status: 'sending' });
  try {
    if (item.kind === 'work_order_action') return await sendWorkOrderAction(deps, item);
    if (item.kind === 'create_request') return await sendCreateRequest(deps, item);
    await store.update(item.id, { status: 'failed', lastError: 'unknown_kind' });
    return { kind: 'failed', code: 'unknown_kind' };
  } catch (error) {
    if (error instanceof NetworkError) {
      const attempts = item.attempts + 1;
      await store.update(item.id, {
        status: 'pending',
        attempts,
        nextAttemptAt: now() + backoffMs(attempts),
        lastError: error.message,
      });
      return { kind: 'retry', error: error.message };
    }
    if (error instanceof UploadRejectedError) {
      await store.update(item.id, { status: 'failed', lastError: error.code });
      return { kind: 'failed', code: error.code };
    }
    if (error instanceof PhotoMissingError) {
      await store.update(item.id, { status: 'failed', lastError: 'photo_missing' });
      return { kind: 'failed', code: 'photo_missing' };
    }
    const attempts = item.attempts + 1;
    const detail = `unexpected_error: ${error instanceof Error ? error.message : String(error)}`;
    if (attempts >= MAX_UNEXPECTED_ATTEMPTS) {
      await store.update(item.id, { status: 'failed', attempts, lastError: detail });
      return { kind: 'failed', code: detail };
    }
    await store.update(item.id, {
      status: 'pending',
      attempts,
      nextAttemptAt: now() + backoffMs(attempts),
      lastError: detail,
    });
    return { kind: 'retry', error: detail };
  }
}

export async function processOutbox(deps: ProcessOutboxDeps): Promise<ProcessOutboxResult> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const result: ProcessOutboxResult = {
    sent: 0,
    conflicts: 0,
    failed: 0,
    stoppedByNetwork: false,
    created: [],
  };

  await store.resetInFlight();
  const owner = deps.ownerId ?? null;
  // Defesa extra: a troca de conta já apaga a fila, mas item de outra pessoa nunca é enviado.
  const items = (await store.listPending()).filter(
    (item) => owner === null || item.userId === '' || item.userId === owner,
  );

  for (const item of items) {
    // Fila estritamente FIFO: um item em espera de backoff trava os mais novos.
    if (item.nextAttemptAt > now()) break;
    const outcome = await processOutboxItem(deps, item);
    if (outcome.kind === 'retry') {
      result.stoppedByNetwork = true;
      break;
    }
    if (outcome.kind === 'sent') {
      result.sent++;
      if (outcome.result)
        result.created.push({ itemId: item.id, requestId: outcome.result.requestId });
    } else if (outcome.kind === 'conflict') result.conflicts++;
    else result.failed++;
  }
  return result;
}

export interface EnqueueDeps {
  randomUuid: () => string;
  /** Copia a foto para a pasta durável do item e devolve o novo caminho. */
  stashPhoto: (id: string, uri: string, index: number) => Promise<string>;
  now?: () => number;
}

async function enqueue(
  store: OutboxStore,
  base: { id: string; kind: OutboxKind; userId: string; payload: unknown; online: boolean },
  photoUris: readonly string[],
  deps: EnqueueDeps,
): Promise<OutboxItem> {
  const now = deps.now ?? Date.now;
  const photoPaths: string[] = [];
  for (let i = 0; i < photoUris.length; i++) {
    photoPaths.push(await deps.stashPhoto(base.id, photoUris[i]!, i));
  }
  const item: OutboxItem = {
    id: base.id,
    kind: base.kind,
    userId: base.userId,
    payload: base.payload,
    photoPaths,
    photoKeys: photoPaths.map(() => null),
    createdOffline: !base.online,
    status: 'pending',
    rejection: null,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: now(),
  };
  await store.add(item);
  return item;
}

/**
 * Enfileira uma ação do agente. Diferença da assinatura do plano: o 3º parâmetro
 * injeta `randomUuid` e `stashPhoto` (nativos); veja `enqueueNative`.
 */
export async function enqueueWorkOrderAction(
  store: OutboxStore,
  input: {
    workOrderId: string;
    action: 'start' | 'complete';
    note?: string;
    photoUris?: string[];
    online: boolean;
    userId: string;
  },
  deps: EnqueueDeps,
): Promise<OutboxItem> {
  const now = deps.now ?? Date.now;
  const payload: WorkOrderActionPayload = {
    workOrderId: input.workOrderId,
    action: input.action,
    occurredAt: new Date(now()).toISOString(),
    note: input.note ?? null,
  };
  return enqueue(
    store,
    {
      id: deps.randomUuid(),
      kind: 'work_order_action',
      userId: input.userId,
      payload,
      online: input.online,
    },
    input.photoUris ?? [],
    deps,
  );
}

/**
 * Enfileira uma nova solicitação. O id do item é o `clientActionId` do payload: o mesmo envio
 * repetido não cria outra solicitação.
 */
export async function enqueueCreateRequest(
  store: OutboxStore,
  input: { userId: string; payload: CreateRequestPayload; photoUris: string[]; online: boolean },
  deps: EnqueueDeps,
): Promise<OutboxItem> {
  return enqueue(
    store,
    {
      id: input.payload.clientActionId,
      kind: 'create_request',
      userId: input.userId,
      payload: input.payload,
      online: input.online,
    },
    input.photoUris,
    deps,
  );
}
