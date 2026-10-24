import {
  agentWorkOrderCardSchema,
  agentWorkOrderDetailSchema,
  challengeResponseSchema,
  createRequestResponseSchema,
  healthResponseSchema,
  locateResponseSchema,
  meResponseSchema,
  phoneVerifyResponseSchema,
  refreshResponseSchema,
  requestCardSchema,
  requestDetailSchema,
  sessionResponseSchema,
  similarOccurrenceSchema,
  uploadResponseSchema,
  type AgentWorkOrderCard,
  type AgentWorkOrderDetail,
  type ChallengeResponse,
  type CityInterestBody,
  type ContestBody,
  type CreateRequestInput,
  type CreateRequestResponse,
  type DeviceUpdateBody,
  type HealthResponse,
  type LocateQuery,
  type LocateResponse,
  type MeResponse,
  type PhoneChangeStartBody,
  type PhoneChangeVerifyBody,
  type PhoneStartBody,
  type PhoneVerifyBody,
  type PhoneVerifyResponse,
  type RecoveryVerifyBody,
  type RefreshResponse,
  type RequestActionBody,
  type RequestCard,
  type RequestDetail,
  type RequestListFilter,
  type SessionResponse,
  type SignupBody,
  type SimilarOccurrence,
  type SimilarQuery,
  type UpdateMeBody,
  type UploadResponse,
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

/**
 * Opções de quem chama: o `signal` cancela a requisição (tela fechada, busca trocada) e o
 * `tenantId` vai no cabeçalho `x-tenant-id` (rotas da prefeitura, como as do agente).
 */
export interface RequestOptions {
  signal?: AbortSignal | null;
  tenantId?: string;
}

const requestCardsSchema = requestCardSchema.array();
const agentWorkOrderCardsSchema = agentWorkOrderCardSchema.array();
const similarOccurrencesSchema = similarOccurrenceSchema.array();

/** Monta a query string à mão: o URLSearchParams do React Native é incompleto. */
function query(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/** Erro de cancelamento quando o sinal de quem chama não traz motivo. */
function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('API request aborted');
  error.name = 'AbortError';
  return error;
}

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
    const callerSignal = init.signal ?? null;
    if (callerSignal?.aborted) throw abortError(callerSignal);

    const token = auth === 'none' ? null : auth === 'session' ? await getToken?.() : auth.token;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // Um só sinal para o fetch: aborta no prazo ou quando quem chama cancela. O
    // AbortSignal.any não existe no Hermes, então o cancelamento é repassado à mão.
    // O prazo vale para a resposta inteira (cabeçalhos e corpo).
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', forwardAbort);
    try {
      if (callerSignal?.aborted) throw abortError(callerSignal);
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = response.status === 204 ? null : parseBody(await response.text());
      if (!response.ok) throw new ApiError(response.status, body);
      return body;
    } catch (error) {
      if (timedOut && !(error instanceof ApiError)) throw new ApiTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  const post = (path: string, body: unknown, auth: Auth = 'none') =>
    request(path, { method: 'POST', body: JSON.stringify(body) }, auth);

  /** Requisição autenticada pela sessão, com corpo JSON opcional e o sinal de quem chama. */
  const send = (method: string, path: string, body?: unknown, options: RequestOptions = {}) =>
    request(path, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(options.tenantId && { headers: { 'x-tenant-id': options.tenantId } }),
      signal: options.signal ?? null,
    });

  const requestPath = (id: string, action?: string) =>
    `/citizen/requests/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

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

    me: async (options?: RequestOptions): Promise<MeResponse> =>
      meResponseSchema.parse(await send('GET', '/me', undefined, options)),

    // Cidadão

    /** Qual prefeitura atende o ponto e as categorias dela. */
    locate: async (point: LocateQuery, options?: RequestOptions): Promise<LocateResponse> =>
      locateResponseSchema.parse(
        await send('GET', `/citizen/locate?${query(point)}`, undefined, options),
      ),

    /** Ocorrências próximas da mesma categoria, que o cidadão pode apoiar. */
    similar: async (params: SimilarQuery, options?: RequestOptions): Promise<SimilarOccurrence[]> =>
      similarOccurrencesSchema.parse(
        await send('GET', `/citizen/similar?${query(params)}`, undefined, options),
      ),

    /** Endereço assinado para enviar uma foto; o envio do arquivo fica com quem chama. */
    createUpload: async (options?: RequestOptions): Promise<UploadResponse> =>
      uploadResponseSchema.parse(await send('POST', '/citizen/uploads', undefined, options)),

    createRequest: async (
      body: CreateRequestInput,
      options?: RequestOptions,
    ): Promise<CreateRequestResponse> =>
      createRequestResponseSchema.parse(await send('POST', '/citizen/requests', body, options)),

    listRequests: async (
      filter: RequestListFilter = 'all',
      options?: RequestOptions,
    ): Promise<RequestCard[]> =>
      requestCardsSchema.parse(
        await send('GET', `/citizen/requests?${query({ filter })}`, undefined, options),
      ),

    getRequest: async (id: string, options?: RequestOptions): Promise<RequestDetail> =>
      requestDetailSchema.parse(await send('GET', requestPath(id), undefined, options)),

    cancelRequest: async (
      id: string,
      body: RequestActionBody,
      options?: RequestOptions,
    ): Promise<RequestCard> =>
      requestCardSchema.parse(await send('POST', requestPath(id, 'cancel'), body, options)),

    confirmRequest: async (
      id: string,
      body: RequestActionBody,
      options?: RequestOptions,
    ): Promise<RequestCard> =>
      requestCardSchema.parse(await send('POST', requestPath(id, 'confirm'), body, options)),

    contestRequest: async (
      id: string,
      body: ContestBody,
      options?: RequestOptions,
    ): Promise<RequestCard> =>
      requestCardSchema.parse(await send('POST', requestPath(id, 'contest'), body, options)),

    /** Registra que o morador quer o Alô Cidadão na cidade dele. */
    cityInterest: async (body: CityInterestBody, options?: RequestOptions): Promise<void> => {
      await send('POST', '/citizen/city-interest', body, options);
    },

    // Agente (sempre na prefeitura informada)

    /** Atividades do agente nas equipes dele nesta prefeitura. */
    agentWorkOrders: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<AgentWorkOrderCard[]> =>
      agentWorkOrderCardsSchema.parse(
        await send('GET', '/agent/work-orders', undefined, { ...options, tenantId }),
      ),

    agentWorkOrder: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<AgentWorkOrderDetail> =>
      agentWorkOrderDetailSchema.parse(
        await send('GET', `/agent/work-orders/${encodeURIComponent(id)}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    /** Endereço assinado para enviar uma foto do agente; o envio do arquivo fica com quem chama. */
    agentUpload: async (tenantId: string, options?: RequestOptions): Promise<UploadResponse> =>
      uploadResponseSchema.parse(
        await send('POST', '/agent/uploads', undefined, { ...options, tenantId }),
      ),

    // Perfil

    updateMe: async (body: UpdateMeBody, options?: RequestOptions): Promise<MeResponse> =>
      meResponseSchema.parse(await send('PATCH', '/me', body, options)),

    phoneChangeStart: async (
      body: PhoneChangeStartBody,
      options?: RequestOptions,
    ): Promise<ChallengeResponse> =>
      challengeResponseSchema.parse(await send('POST', '/me/phone/start', body, options)),

    phoneChangeVerify: async (
      body: PhoneChangeVerifyBody,
      options?: RequestOptions,
    ): Promise<MeResponse> =>
      meResponseSchema.parse(await send('POST', '/me/phone/verify', body, options)),

    deleteMe: async (options?: RequestOptions): Promise<void> => {
      await send('DELETE', '/me', undefined, options);
    },

    /** Grava ou atualiza o aparelho (e o token de push) da conta. */
    registerDevice: async (
      installationId: string,
      body: DeviceUpdateBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('PUT', `/me/devices/${encodeURIComponent(installationId)}`, body, options);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
