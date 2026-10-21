import { healthResponseSchema, type HealthResponse } from '@alocidadao/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export function createApiClient({ baseUrl, getToken, fetch: fetchImpl = fetch }: ApiClientOptions) {
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await getToken?.();
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    const body: unknown = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new ApiError(response.status, body);
    return body;
  }

  return {
    health: async (): Promise<HealthResponse> => healthResponseSchema.parse(await request('/health')),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
