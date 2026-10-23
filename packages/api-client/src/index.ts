import {
  challengeResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  phoneVerifyResponseSchema,
  refreshResponseSchema,
  sessionResponseSchema,
  type ChallengeResponse,
  type HealthResponse,
  type MeResponse,
  type PhoneStartBody,
  type PhoneVerifyBody,
  type PhoneVerifyResponse,
  type RecoveryVerifyBody,
  type RefreshResponse,
  type SessionResponse,
  type SignupBody,
} from '@alocidadao/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

/** A API não respondeu dentro de `timeoutMs`: trate como falha de rede. */
export class ApiTimeoutError extends Error {
  constructor() {
    super('API request timed out');
    this.name = 'ApiTimeoutError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
  /** Tempo máximo de cada requisição (padrão: 30 s). Conexão ruim pode deixar o fetch parado. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Como a requisição se autentica: `session` usa `getToken`, `none` vai sem token (rotas de
 * login e renovação, que não podem depender da sessão) e `{ token }` usa um token explícito.
 */
type Auth = 'session' | 'none' | { token: string };

function parseBody(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    // Proxy ou portal cativo devolvendo HTML: o corpo vai como texto no ApiError.
    return text;
  }
}

export function createApiClient({
  baseUrl,
  getToken,
  fetch: fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions) {
  async function request(path: string, init: RequestInit = {}, auth: Auth = 'session') {
    const token = auth === 'none' ? null : auth === 'session' ? await getToken?.() : auth.token;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // O prazo vale para a resposta inteira (cabeçalhos e corpo).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = response.status === 204 ? null : parseBody(await response.text());
      if (!response.ok) throw new ApiError(response.status, body);
      return body;
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof ApiError)) throw new ApiTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const post = (path: string, body: unknown, auth: Auth = 'none') =>
    request(path, { method: 'POST', body: JSON.stringify(body) }, auth);

  return {
    health: async (): Promise<HealthResponse> =>
      healthResponseSchema.parse(await request('/health')),

    phoneStart: async (body: PhoneStartBody): Promise<ChallengeResponse> =>
      challengeResponseSchema.parse(await post('/auth/phone/start', body)),

    phoneVerify: async (body: PhoneVerifyBody): Promise<PhoneVerifyResponse> =>
      phoneVerifyResponseSchema.parse(await post('/auth/phone/verify', body)),

    signup: async (body: SignupBody): Promise<SessionResponse> =>
      sessionResponseSchema.parse(await post('/auth/signup', body)),

    recoveryVerify: async (body: RecoveryVerifyBody): Promise<SessionResponse> =>
      sessionResponseSchema.parse(await post('/auth/recovery/verify', body)),

    refresh: async (refreshToken: string): Promise<RefreshResponse> =>
      refreshResponseSchema.parse(await post('/auth/refresh', { refreshToken })),

    /** Encerra a sessão no servidor. Sem `accessToken`, usa o da sessão (`getToken`). */
    logout: async (accessToken?: string): Promise<void> => {
      await request(
        '/auth/logout',
        { method: 'POST' },
        accessToken ? { token: accessToken } : 'session',
      );
    },

    me: async (): Promise<MeResponse> => meResponseSchema.parse(await request('/me')),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
