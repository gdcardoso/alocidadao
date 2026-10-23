import { File } from 'expo-file-system';
import type { CreateRequestInput, WorkOrderActionInput } from '@alocidadao/shared';
import { mapActionResponse, mapCreateRequestResponse, parsePresignResponse } from './http-mapping';
import {
  NetworkError,
  PhotoMissingError,
  type OutboxKind,
  type SendActionResult,
  type SendCreateRequestResult,
  type Transport,
} from './outbox';

const TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  baseUrl: string;
  /** Token de acesso da sessão; `null` sem sessão. Falha de rede rejeita com `NetworkError`. */
  getAccessToken: () => Promise<string | null>;
  /** Prefeitura em que o agente atua (`x-tenant-id` das rotas /dev); `null` para o cidadão. */
  tenantId: string | null;
  timeoutMs?: number;
}

/** Resposta já lida por inteiro dentro do tempo limite. */
interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
}

export class HttpTransport implements Transport {
  constructor(private readonly options: HttpTransportOptions) {}

  /** Toda chamada (inclusive a leitura do corpo) tem o tempo limite de 30 s. */
  private async request(url: string, init: RequestInit): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
      return { status: response.status, ok: response.ok, text: await response.text() };
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'network_error');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Cabeçalhos da sessão. As rotas /dev do agente levam a prefeitura; as do cidadão, não.
   * Sem sessão o item continua na fila (`NetworkError`) até um novo login.
   */
  private async authHeaders(withTenant: boolean): Promise<Record<string, string>> {
    const token = await this.options.getAccessToken();
    if (!token) throw new NetworkError('signed_out');
    if (!withTenant) return { authorization: `Bearer ${token}` };
    const { tenantId } = this.options;
    if (!tenantId) throw new NetworkError('signed_out');
    return { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId };
  }

  async uploadPhoto(path: string, kind: OutboxKind): Promise<{ key: string; durationMs: number }> {
    const file = new File(path);
    if (!file.exists) throw new PhotoMissingError(path);

    const agent = kind === 'work_order_action';
    const presign = await this.request(
      `${this.options.baseUrl}${agent ? '/dev/uploads' : '/citizen/uploads'}`,
      { method: 'POST', headers: await this.authHeaders(agent) },
    );
    const { key, url, headers } = parsePresignResponse(presign.status, presign.text);

    const start = Date.now();
    const put = await this.request(url, { method: 'PUT', headers, body: file });
    if (!put.ok) throw new NetworkError(`put_${put.status}`);
    return { key, durationMs: Date.now() - start };
  }

  /** Lista as atividades do agente (GET /dev/work-orders). */
  async listWorkOrders(): Promise<unknown> {
    const response = await this.request(`${this.options.baseUrl}/dev/work-orders`, {
      headers: await this.authHeaders(true),
    });
    if (response.status !== 200) throw new NetworkError(`work_orders_${response.status}`);
    try {
      return JSON.parse(response.text);
    } catch {
      throw new NetworkError('invalid_work_orders_response');
    }
  }

  async sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendActionResult> {
    const response = await this.request(
      `${this.options.baseUrl}/dev/work-orders/${workOrderId}/actions`,
      {
        method: 'POST',
        headers: { ...(await this.authHeaders(true)), 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return mapActionResponse(response.status, response.text);
  }

  async sendCreateRequest(input: CreateRequestInput): Promise<SendCreateRequestResult> {
    const response = await this.request(`${this.options.baseUrl}/citizen/requests`, {
      method: 'POST',
      headers: { ...(await this.authHeaders(false)), 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return mapCreateRequestResponse(response.status, response.text);
  }
}
