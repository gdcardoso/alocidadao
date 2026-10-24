import type {
  ConnectionContext,
  CreateRequestInput,
  WorkOrderActionInput,
} from '@alocidadao/shared';
import type {
  CreateRequestPayload,
  OutboxItem,
  OutboxKind,
  OutboxStore,
  SendCreateRequestResult,
  Transport,
  WorkOrderActionPayload,
} from './outbox';

/** Store em memória só para testes; não importa nada nativo. */
export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();

  async add(item: OutboxItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }
  async listPending(): Promise<OutboxItem[]> {
    return [...this.items.values()]
      .filter((i) => i.status === 'pending')
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({ ...i }));
  }
  async update(id: string, patch: Partial<OutboxItem>): Promise<void> {
    const current = this.items.get(id);
    if (!current) throw new Error(`item ${id} não existe`);
    this.items.set(id, { ...current, ...patch });
  }
  async resetInFlight(): Promise<void> {
    for (const [id, item] of this.items) {
      if (item.status === 'sending') this.items.set(id, { ...item, status: 'pending' });
    }
  }
  async list(): Promise<OutboxItem[]> {
    return [...this.items.values()]
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({ ...i }));
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async get(id: string): Promise<OutboxItem> {
    const item = this.items.get(id);
    if (!item) throw new Error(`item ${id} não existe`);
    return { ...item };
  }
}

type SendResult = Awaited<ReturnType<Transport['sendAction']>>;

/** Transport falso: registra chamadas e permite programar falhas. */
export class FakeTransport implements Transport {
  uploads: string[] = [];
  uploadKinds: OutboxKind[] = [];
  uploadTenants: (string | null)[] = [];
  sent: { tenantId: string; workOrderId: string; input: WorkOrderActionInput }[] = [];
  created: CreateRequestInput[] = [];
  uploadDurationMs = 100;
  private sendQueue: (SendResult | Error)[] = [];
  private createQueue: (SendCreateRequestResult | Error)[] = [];
  private uploadErrors = new Map<string, Error>();

  failNextSendWith(error: Error): void {
    this.sendQueue.push(error);
  }
  resultNext(result: SendResult): void {
    this.sendQueue.push(result);
  }
  failUploadWith(path: string, error: Error): void {
    this.uploadErrors.set(path, error);
  }
  /** Próxima resposta do envio de solicitação (sem programação: sucesso). */
  createResultNext(result: SendCreateRequestResult | Error): void {
    this.createQueue.push(result);
  }

  async uploadPhoto(
    path: string,
    kind: OutboxKind,
    tenantId: string | null = null,
  ): Promise<{ key: string; durationMs: number }> {
    const error = this.uploadErrors.get(path);
    if (error) throw error;
    this.uploads.push(path);
    this.uploadKinds.push(kind);
    this.uploadTenants.push(tenantId);
    return { key: `k${this.uploads.length}`, durationMs: this.uploadDurationMs };
  }
  async sendAction(
    tenantId: string,
    workOrderId: string,
    input: WorkOrderActionInput,
  ): Promise<SendResult> {
    const next = this.sendQueue.shift();
    if (next instanceof Error) throw next;
    this.sent.push({ tenantId, workOrderId, input });
    return next ?? { kind: 'ok' };
  }
  async sendCreateRequest(input: CreateRequestInput): Promise<SendCreateRequestResult> {
    const next = this.createQueue.shift();
    if (next instanceof Error) throw next;
    this.created.push(input);
    return (
      next ?? {
        kind: 'ok',
        result: {
          requestId: '33333333-3333-4333-8333-333333333333',
          protocol: '2026-000200',
          status: 'open',
          duplicate: false,
        },
      }
    );
  }
}

export const TENANT_ID = '66666666-6666-4666-8666-666666666666';

type WorkOrderOverrides = Partial<OutboxItem> & Partial<WorkOrderActionPayload>;

/** Item `work_order_action`; os campos da ação podem vir soltos e vão para o `payload`. */
export function makeItem(overrides: WorkOrderOverrides = {}): OutboxItem {
  const { tenantId, workOrderId, action, occurredAt, note, impedimentReason, location, ...rest } =
    overrides;
  const payload: WorkOrderActionPayload = {
    tenantId: tenantId ?? TENANT_ID,
    workOrderId: workOrderId ?? '22222222-2222-4222-8222-222222222222',
    action: action ?? 'complete',
    occurredAt: occurredAt ?? '2026-10-22T10:00:00.000Z',
    note: note === undefined ? 'Serviço feito' : note,
    impedimentReason: impedimentReason ?? null,
    location: location ?? null,
  };
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'work_order_action',
    userId: 'user-1',
    payload,
    photoPaths: ['/outbox/a/1.jpg'],
    photoKeys: [null],
    createdOffline: false,
    status: 'pending',
    rejection: null,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: 1,
    ...rest,
  };
}

/** Ação do item `work_order_action` (o payload é `unknown` no tipo do item). */
export const actionOf = (item: OutboxItem) => item.payload as WorkOrderActionPayload;

export const requestPayload = (
  overrides: Partial<CreateRequestPayload> = {},
): CreateRequestPayload => ({
  clientActionId: '44444444-4444-4444-8444-444444444444',
  categoryId: '55555555-5555-4555-8555-555555555555',
  occurredAt: '2026-10-23T10:00:00.000Z',
  gpsLocation: { lat: -23.5505, lng: -46.6333 },
  location: { lat: -23.5505, lng: -46.6333 },
  address: 'Rua das Flores, 120',
  display: { categoryName: 'Buraco na via', icon: 'construction', iconGroup: 'infrastructure' },
  ...overrides,
});

/** Item `create_request` com duas fotos ainda não enviadas. */
export function makeRequestItem(
  overrides: Partial<OutboxItem> = {},
  payload: Partial<CreateRequestPayload> = {},
): OutboxItem {
  // O id do item é o `clientActionId` da solicitação.
  const id = overrides.id ?? '44444444-4444-4444-8444-444444444444';
  return makeItem({
    id,
    kind: 'create_request',
    payload: requestPayload({ clientActionId: id, ...payload }),
    photoPaths: ['/outbox/r/0.jpg', '/outbox/r/1.jpg'],
    photoKeys: [null, null],
    ...overrides,
  });
}

export const fakeConnection = (
  calls: { uploadDurationMs: number | null; sentOffline: boolean }[] = [],
) => {
  return async (m: { uploadDurationMs: number | null; sentOffline: boolean }) => {
    calls.push(m);
    return {
      networkType: 'wifi',
      cellularGeneration: null,
      apiLatencyMs: 50,
      uploadDurationMs: m.uploadDurationMs,
      sentOffline: m.sentOffline,
    } satisfies ConnectionContext;
  };
};
