import { File } from 'expo-file-system';
import type { WorkOrderActionInput } from '@alocidadao/shared';
import { mapActionResponse, parsePresignResponse } from './http-mapping';
import { NetworkError, PhotoMissingError, type SendActionResult, type Transport } from './outbox';

const TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  baseUrl: string;
  /** Token de acesso da sessão; `null` sem sessão. Falha de rede rejeita com `NetworkError`. */
  getAccessToken: () => Promise<string | null>;
  /** Prefeitura em que o agente atua (`x-tenant-id`); `null` antes do login. */
  tenantId: string | null;
  timeoutMs?: number;
}

export class HttpTransport implements Transport {
  constructor(private readonly options: HttpTransportOptions) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'network_error');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sem sessão o item continua na fila (`NetworkError`) até um novo login. */
  private async authHeaders(): Promise<Record<string, string>> {
    const { tenantId } = this.options;
    const token = await this.options.getAccessToken();
    if (!token || !tenantId) throw new NetworkError('signed_out');
    return { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId };
  }

  async uploadPhoto(path: string): Promise<{ key: string; durationMs: number }> {
    const file = new File(path);
    if (!file.exists) throw new PhotoMissingError(path);

    const presign = await this.request(`${this.options.baseUrl}/dev/uploads`, {
      method: 'POST',
      headers: await this.authHeaders(),
    });
    const { key, url, headers } = parsePresignResponse(presign.status, await presign.text());

    const start = Date.now();
    const put = await this.request(url, { method: 'PUT', headers, body: file });
    if (!put.ok) throw new NetworkError(`put_${put.status}`);
    return { key, durationMs: Date.now() - start };
  }

  /** Lista as atividades do agente (GET /dev/work-orders). */
  async listWorkOrders(): Promise<unknown> {
    const response = await this.request(`${this.options.baseUrl}/dev/work-orders`, {
      headers: await this.authHeaders(),
    });
    if (response.status !== 200) throw new NetworkError(`work_orders_${response.status}`);
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new NetworkError('invalid_work_orders_response');
    }
  }

  async sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendActionResult> {
    const response = await this.request(
      `${this.options.baseUrl}/dev/work-orders/${workOrderId}/actions`,
      {
        method: 'POST',
        headers: { ...(await this.authHeaders()), 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return mapActionResponse(response.status, await response.text());
  }
}
