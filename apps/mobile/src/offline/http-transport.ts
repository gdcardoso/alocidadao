import { File } from 'expo-file-system';
import type { WorkOrderActionInput } from '@alocidadao/shared';
import { mapActionResponse, parsePresignResponse } from './http-mapping';
import { NetworkError, PhotoMissingError, type SendActionResult, type Transport } from './outbox';

const TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  baseUrl: string;
  devUserId: string;
  devTenantId: string;
  timeoutMs?: number;
}

/** Lê as variáveis EXPO_PUBLIC_* (identidade de dev, até existir login). */
export function createHttpTransportFromEnv(baseUrl: string): HttpTransport {
  return new HttpTransport({
    baseUrl,
    devUserId: process.env.EXPO_PUBLIC_DEV_USER_ID ?? '',
    devTenantId: process.env.EXPO_PUBLIC_DEV_TENANT_ID ?? '',
  });
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

  private devHeaders(): Record<string, string> {
    return {
      'x-dev-user-id': this.options.devUserId,
      'x-dev-tenant-id': this.options.devTenantId,
    };
  }

  async uploadPhoto(path: string): Promise<{ key: string; durationMs: number }> {
    const file = new File(path);
    if (!file.exists) throw new PhotoMissingError(path);

    const presign = await this.request(`${this.options.baseUrl}/dev/uploads`, {
      method: 'POST',
      headers: this.devHeaders(),
    });
    const { key, url, headers } = parsePresignResponse(presign.status, await presign.text());

    const start = Date.now();
    const put = await this.request(url, { method: 'PUT', headers, body: file });
    if (!put.ok) throw new NetworkError(`put_${put.status}`);
    return { key, durationMs: Date.now() - start };
  }

  async sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<SendActionResult> {
    const response = await this.request(
      `${this.options.baseUrl}/dev/work-orders/${workOrderId}/actions`,
      {
        method: 'POST',
        headers: { ...this.devHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return mapActionResponse(response.status, await response.text());
  }
}
