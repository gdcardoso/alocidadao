import type { ConnectionContext, WorkOrderActionInput } from '@alocidadao/shared';
import type { OutboxItem, OutboxStore, Transport } from './outbox';

/** Store em memória só para testes; não importa nada nativo. */
export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();

  async add(item: OutboxItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }
  async listDue(now: number): Promise<OutboxItem[]> {
    return [...this.items.values()]
      .filter((i) => i.status === 'pending' && i.nextAttemptAt <= now)
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
  sent: { workOrderId: string; input: WorkOrderActionInput }[] = [];
  uploadDurationMs = 100;
  private sendQueue: (SendResult | Error)[] = [];
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

  async uploadPhoto(path: string): Promise<{ key: string; durationMs: number }> {
    const error = this.uploadErrors.get(path);
    if (error) throw error;
    this.uploads.push(path);
    return { key: `k${this.uploads.length}`, durationMs: this.uploadDurationMs };
  }
  async sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendResult> {
    const next = this.sendQueue.shift();
    if (next instanceof Error) throw next;
    this.sent.push({ workOrderId, input });
    return next ?? { kind: 'ok' };
  }
}

export function makeItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workOrderId: '22222222-2222-4222-8222-222222222222',
    action: 'complete',
    occurredAt: '2026-10-22T10:00:00.000Z',
    note: 'Serviço feito',
    photoPaths: ['/outbox/a/1.jpg'],
    photoKeys: [null],
    createdOffline: false,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: 1,
    ...overrides,
  };
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
