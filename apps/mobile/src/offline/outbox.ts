import {
  MAX_PHOTOS_PER_COMPLETION,
  MAX_PHOTOS_PER_IMPEDIMENT,
  type ConnectionContext,
  type CreateRequestInput,
  type CreateRequestResponse,
  type DeviceLocation,
  type IconGroup,
  type ImpedimentReason,
  type WorkOrderActionInput,
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

export type WorkOrderAction = WorkOrderActionInput['action'];

/**
 * O que o aviso de envio não aplicado mostra (`{Categoria} · {endereço}`) quando a atividade
 * já saiu do cache. Não vai para a API.
 */
export interface WorkOrderActionDisplay {
  categoryName: string;
  address: string | null;
}

export interface WorkOrderActionPayload {
  /** Prefeitura da atividade (`x-tenant-id` do envio). */
  tenantId: string;
  workOrderId: string;
  action: WorkOrderAction;
  occurredAt: string;
  /** Observação da conclusão ou detalhes do impedimento. */
  note: string | null;
  impedimentReason: ImpedimentReason | null;
  /** Posição do aparelho no momento da ação; `null` quando não foi possível ler. */
  location: DeviceLocation | null;
  /** Ausente nos itens gravados antes da versão 3 do banco. */
  display?: WorkOrderActionDisplay | null;
}

/** Máximo de fotos de cada ação do agente. */
export const MAX_PHOTOS_BY_ACTION: Record<WorkOrderAction, number> = {
  start: 0,
  complete: MAX_PHOTOS_PER_COMPLETION,
  report_impediment: MAX_PHOTOS_PER_IMPEDIMENT,
};

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
  /**
   * Envia a foto pela rota do tipo do item (agente ou cidadão). A do agente vai na
   * prefeitura `tenantId`.
   */
  uploadPhoto(
    path: string,
    kind: OutboxKind,
    tenantId?: string | null,
  ): Promise<{ key: string; durationMs: number }>;
  sendAction(
    tenantId: string,
    workOrderId: string,
    input: WorkOrderActionInput,
  ): Promise<SendActionResult>;
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

/**
 * Recusas da ação do agente que ficam na fila como "recusada", sem nova tentativa: a atividade
 * saiu da equipe (ou foi concluída/cancelada), o vínculo acabou, a foto já foi usada ou o item
 * não tem prefeitura. A tela mostra o aviso com "Remover envio".
 */
export const ACTION_REJECTION_CODES: readonly string[] = [
  'work_order_not_found',
  'not_a_member',
  'photo_already_used',
  'missing_tenant',
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
  tenantId: string | null = null,
): Promise<{ photoKeys: string[]; uploadDurationMs: number | null }> {
  const photoKeys = [...item.photoKeys];
  let uploadedMs = 0;
  let uploads = 0;
  for (let i = 0; i < item.photoPaths.length; i++) {
    if (photoKeys[i]) continue;
    const uploaded = await deps.transport.uploadPhoto(item.photoPaths[i]!, item.kind, tenantId);
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

/** Recusa definitiva: o item fica na fila como "recusada", com o motivo. */
async function rejectItem(store: OutboxStore, id: string, code: string): Promise<ItemOutcome> {
  const rejection: OutboxRejection = { code };
  await store.update(id, { status: 'rejected', rejection, lastError: code });
  return { kind: 'rejected', rejection };
}

async function sendWorkOrderAction(
  deps: ProcessOutboxDeps,
  item: OutboxItem,
): Promise<ItemOutcome> {
  const payload = item.payload as Partial<WorkOrderActionPayload> &
    Pick<WorkOrderActionPayload, 'workOrderId' | 'action' | 'occurredAt'>;
  const { tenantId } = payload;
  // Item sem prefeitura (fila antiga): não há para onde enviar.
  if (!tenantId) return rejectItem(deps.store, item.id, 'missing_tenant');
  const { photoKeys, uploadDurationMs } = await uploadMissingPhotos(deps, item, tenantId);
  const context = await deps.connection({ uploadDurationMs, sentOffline: item.createdOffline });
  const input: WorkOrderActionInput = {
    clientActionId: item.id,
    action: payload.action,
    occurredAt: payload.occurredAt,
    ...(payload.note ? { note: payload.note } : {}),
    ...(payload.impedimentReason ? { impedimentReason: payload.impedimentReason } : {}),
    location: payload.location ?? null,
    photoKeys,
    connection: context,
  };
  const outcome = await deps.transport.sendAction(tenantId, payload.workOrderId, input);
  if (outcome.kind === 'ok') {
    await deps.store.update(item.id, { status: 'done', lastError: null });
    return { kind: 'sent' };
  }
  if (outcome.kind === 'conflict') {
    await deps.store.update(item.id, { status: 'conflict', lastError: outcome.status });
    return { kind: 'conflict' };
  }
  if (ACTION_REJECTION_CODES.includes(outcome.code)) {
    return rejectItem(deps.store, item.id, outcome.code);
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
      if (item.kind === 'work_order_action' && ACTION_REJECTION_CODES.includes(error.code)) {
        return await rejectItem(store, item.id, error.code);
      }
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
  base: {
    id: string;
    kind: OutboxKind;
    userId: string;
    payload: unknown;
    online: boolean;
    createdAt: number;
  },
  photoUris: readonly string[],
  deps: EnqueueDeps,
): Promise<OutboxItem> {
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
    createdAt: base.createdAt,
  };
  await store.add(item);
  return item;
}

export interface EnqueueWorkOrderActionInput {
  tenantId: string;
  workOrderId: string;
  action: WorkOrderAction;
  note?: string;
  impedimentReason?: ImpedimentReason;
  location?: DeviceLocation | null;
  photoUris?: string[];
  /** Categoria e endereço da atividade, para o aviso se o envio não for aplicado. */
  display?: WorkOrderActionDisplay | null;
  online: boolean;
  userId: string;
}

/**
 * Enfileira uma ação do agente na prefeitura da atividade. Recusa (`too_many_photos`) mais
 * fotos que o limite da ação, antes de copiar qualquer uma. O 3º parâmetro injeta
 * `randomUuid` e `stashPhoto` (nativos); veja `enqueueNative`.
 */
export async function enqueueWorkOrderAction(
  store: OutboxStore,
  input: EnqueueWorkOrderActionInput,
  deps: EnqueueDeps,
): Promise<OutboxItem> {
  const photoUris = input.photoUris ?? [];
  if (photoUris.length > MAX_PHOTOS_BY_ACTION[input.action]) throw new Error('too_many_photos');
  // Um só relógio: a hora da ação é a hora em que ela entrou na fila.
  const createdAt = (deps.now ?? Date.now)();
  const payload: WorkOrderActionPayload = {
    tenantId: input.tenantId,
    workOrderId: input.workOrderId,
    action: input.action,
    occurredAt: new Date(createdAt).toISOString(),
    note: input.note ?? null,
    impedimentReason: input.impedimentReason ?? null,
    location: input.location ?? null,
    display: input.display ?? null,
  };
  return enqueue(
    store,
    {
      id: deps.randomUuid(),
      kind: 'work_order_action',
      userId: input.userId,
      payload,
      online: input.online,
      createdAt,
    },
    photoUris,
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
      createdAt: (deps.now ?? Date.now)(),
    },
    input.photoUris,
    deps,
  );
}
