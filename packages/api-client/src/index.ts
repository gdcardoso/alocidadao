import {
  auditResponseSchema,
  citizenListResponseSchema,
  cityInterestResponseSchema,
  frozenAccountCodeResponseSchema,
  staffCreateResponseSchema,
  staffListResponseSchema,
  backofficeContextSchema,
  municipalitySearchResponseSchema,
  neighborhoodsSummarySchema,
  tenantCreateResponseSchema,
  tenantDetailSchema,
  tenantListResponseSchema,
  tenantSummarySchema,
  type AuditQuery,
  type AuditResponse,
  type CitizenListQuery,
  type CitizenListResponse,
  type BackofficeContext,
  type CityInterestResponse,
  type CommercialStatus,
  type ContractBody,
  type FrozenAccountCodeBody,
  type FrozenAccountCodeResponse,
  type FrozenAccountRecoverBody,
  type FrozenAccountReleaseBody,
  type StaffCreateBody,
  type StaffCreateResponse,
  type StaffListResponse,
  type StaffUpdateBody,
  type MunicipalitySearchResponse,
  type NeighborhoodsSummary,
  type TenantCreateBody,
  type TenantCreateResponse,
  type TenantDetail,
  type TenantListResponse,
  type TenantStatus,
  type TenantStatusBody,
  agentWorkOrderCardSchema,
  agentRowSchema,
  agentsResponseSchema,
  categoriesResponseSchema,
  categoryRowSchema,
  departmentRowSchema,
  departmentsResponseSchema,
  impedimentDetailSchema,
  inProgressResponseSchema,
  managerRowSchema,
  managersResponseSchema,
  categoryOptionsResponseSchema,
  neighborhoodsResponseSchema,
  tenantProfileSchema,
  requestListResponseSchema,
  reviewDetailSchema,
  teamSummarySchema,
  teamsResponseSchema,
  workOrderResultSchema,
  workQueueResponseSchema,
  assignResponseSchema,
  agentWorkOrderDetailSchema,
  challengeResponseSchema,
  createRequestResponseSchema,
  healthResponseSchema,
  locateResponseSchema,
  meResponseSchema,
  mergeResponseSchema,
  occurrenceDetailSchema,
  occurrenceMapResponseSchema,
  occurrenceSummarySchema,
  panelChallengeResponseSchema,
  panelContextSchema,
  panelCountsSchema,
  panelNotificationsResponseSchema,
  panelRefreshResponseSchema,
  panelSearchResponseSchema,
  panelSessionResponseSchema,
  phoneVerifyResponseSchema,
  refreshResponseSchema,
  requestCardSchema,
  requestDetailSchema,
  sessionResponseSchema,
  splitResponseSchema,
  teamOptionsResponseSchema,
  triageResponseSchema,
  similarOccurrenceSchema,
  uploadResponseSchema,
  type AgentWorkOrderCard,
  type AgentCreateBody,
  type AgentRow,
  type AgentUpdateBody,
  type AgentsResponse,
  type CategoriesResponse,
  type CategoryCreateBody,
  type CategoryRow,
  type CategoryUpdateBody,
  type DepartmentBody,
  type DepartmentRow,
  type DepartmentsResponse,
  type ImpedimentDetail,
  type InProgressQuery,
  type InProgressResponse,
  type ManagerCreateBody,
  type ManagerRow,
  type ManagerUpdateBody,
  type ManagersResponse,
  type PublishBody,
  type ReassignBody,
  type RequestListQuery,
  type CategoryOptionsResponse,
  type NeighborhoodsResponse,
  type TenantProfile,
  type RequestListResponse,
  type RescheduleBody,
  type ReviewDetail,
  type ReworkBody,
  type TeamCreateBody,
  type TeamSummary,
  type TeamUpdateBody,
  type TeamsResponse,
  type WorkOrderResult,
  type WorkQueueResponse,
  type AgentWorkOrderDetail,
  type AssignBody,
  type AssignResponse,
  type ChallengeResponse,
  type CityInterestBody,
  type ContestBody,
  type CreateRequestInput,
  type CreateRequestResponse,
  type DeviceUpdateBody,
  type DismissSuggestionBody,
  type HealthResponse,
  type LocateQuery,
  type LocateResponse,
  type MeResponse,
  type MergeBody,
  type MergeResponse,
  type OccurrenceDetail,
  type OccurrenceMapQuery,
  type OccurrenceSummary,
  type OccurrenceSummaryQuery,
  type OccurrenceMapResponse,
  type PanelChallengeResponse,
  type PanelContext,
  type PanelCounts,
  type PanelNotificationsResponse,
  type PanelRefreshResponse,
  type PanelSearchResponse,
  type PanelSessionResponse,
  type PanelStartInput,
  type PanelVerifyBody,
  type PhoneChangeStartBody,
  type PhoneChangeVerifyBody,
  type PhoneStartBody,
  type PhoneVerifyBody,
  type PhoneVerifyResponse,
  type RecoveryVerifyBody,
  type RefreshResponse,
  type RejectBody,
  type RequestActionBody,
  type RequestCard,
  type RequestDetail,
  type RequestListFilter,
  type SessionResponse,
  type SignupBody,
  type SimilarOccurrence,
  type SimilarQuery,
  type SplitBody,
  type SplitResponse,
  type TeamOptionsResponse,
  type TriageQuery,
  type TriageResponse,
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
  /** Repassado ao `fetch`. O painel web usa `'same-origin'` para o cookie de renovação. */
  credentials?: RequestCredentials;
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

/** Query string do painel: omite o que é indefinido; `days: null` vira `all`. */
function panelQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, value === null ? 'all' : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
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
  credentials,
}: ApiClientOptions) {
  async function request(
    path: string,
    init: RequestInit = {},
    auth: Auth = 'session',
    asText = false,
  ) {
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
        ...(credentials !== undefined && { credentials }),
        headers,
        signal: controller.signal,
      });
      // `response.text()` descarta o BOM do CSV; decodificar à mão o mantém (o Excel precisa dele).
      const text =
        response.status === 204
          ? null
          : asText
            ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer())
            : await response.text();
      const body = text === null ? null : parseBody(text);
      if (!response.ok) throw new ApiError(response.status, body);
      // Resposta em texto (CSV): devolve o corpo cru, sem tentar ler como JSON.
      return asText ? (text ?? '') : body;
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

  /** GET autenticado que devolve o corpo como texto (download de CSV). */
  const sendText = (path: string, options: RequestOptions = {}): Promise<string> =>
    request(
      path,
      { method: 'GET', signal: options.signal ?? null },
      'session',
      true,
    ) as Promise<string>;

  const requestPath = (id: string, action?: string) =>
    `/citizen/requests/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

  const panelPath = (id: string, action?: string) =>
    `/panel/occurrences/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
  const workOrderPath = (id: string, action: string) =>
    `/panel/work-orders/${encodeURIComponent(id)}/${action}`;
  const panelHeaders = { 'x-requested-with': 'alocidadao-panel' };

  const tenantPath = (id: string, action?: string) =>
    `/backoffice/tenants/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
  const tenantStatusResponseSchema = tenantSummarySchema.pick({ status: true });

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

    // Painel da prefeitura

    panelStart: async (body: PanelStartInput): Promise<PanelChallengeResponse> =>
      panelChallengeResponseSchema.parse(await post('/auth/panel/start', body)),

    /** O servidor também grava o cookie de renovação (`credentials` do cliente). */
    panelVerify: async (body: PanelVerifyBody): Promise<PanelSessionResponse> =>
      panelSessionResponseSchema.parse(await post('/auth/panel/verify', body)),

    /** Renova pelo cookie; o cabeçalho é a defesa contra CSRF e não leva `Authorization`. */
    panelRefresh: async (options?: RequestOptions): Promise<PanelRefreshResponse> =>
      panelRefreshResponseSchema.parse(
        await request(
          '/auth/panel/refresh',
          { method: 'POST', headers: panelHeaders, signal: options?.signal ?? null },
          'none',
        ),
      ),

    panelLogout: async (options?: RequestOptions): Promise<void> => {
      await request(
        '/auth/panel/logout',
        { method: 'POST', headers: panelHeaders, signal: options?.signal ?? null },
        'none',
      );
    },

    // Backoffice: token do painel, sem `x-tenant-id` (as rotas não pertencem a uma prefeitura).
    backofficeContext: async (options?: RequestOptions): Promise<BackofficeContext> =>
      backofficeContextSchema.parse(await send('GET', '/backoffice/context', undefined, options)),

    backofficeTenants: async (options?: RequestOptions): Promise<TenantListResponse> =>
      tenantListResponseSchema.parse(await send('GET', '/backoffice/tenants', undefined, options)),

    backofficeTenant: async (id: string, options?: RequestOptions): Promise<TenantDetail> =>
      tenantDetailSchema.parse(await send('GET', tenantPath(id), undefined, options)),

    backofficeTenantTeams: async (id: string, options?: RequestOptions): Promise<TeamsResponse> =>
      teamsResponseSchema.parse(await send('GET', tenantPath(id, 'teams'), undefined, options)),

    backofficeTenantManagers: async (
      id: string,
      options?: RequestOptions,
    ): Promise<ManagersResponse> =>
      managersResponseSchema.parse(
        await send('GET', tenantPath(id, 'managers'), undefined, options),
      ),

    backofficeTenantCategories: async (
      id: string,
      options?: RequestOptions,
    ): Promise<CategoriesResponse> =>
      categoriesResponseSchema.parse(
        await send('GET', tenantPath(id, 'categories'), undefined, options),
      ),

    backofficeSetTenantStatus: async (
      id: string,
      body: TenantStatusBody,
      options?: RequestOptions,
    ): Promise<{ status: TenantStatus }> =>
      tenantStatusResponseSchema.parse(await send('POST', tenantPath(id, 'status'), body, options)),

    backofficeUpdateContract: async (
      id: string,
      body: ContractBody,
      options?: RequestOptions,
    ): Promise<TenantDetail> =>
      tenantDetailSchema.parse(await send('PUT', tenantPath(id, 'contract'), body, options)),

    backofficeNeighborhoods: async (
      id: string,
      options?: RequestOptions,
    ): Promise<NeighborhoodsSummary> =>
      neighborhoodsSummarySchema.parse(
        await send('GET', tenantPath(id, 'neighborhoods'), undefined, options),
      ),

    /** `geojson` é o GeoJSON já lido no navegador; a API valida e responde 422 `invalid_neighborhoods`. */
    backofficePutNeighborhoods: async (
      id: string,
      geojson: unknown,
      options?: RequestOptions,
    ): Promise<NeighborhoodsSummary> =>
      neighborhoodsSummarySchema.parse(
        await send('PUT', tenantPath(id, 'neighborhoods'), geojson, options),
      ),

    backofficeResetNeighborhoods: async (
      id: string,
      options?: RequestOptions,
    ): Promise<NeighborhoodsSummary> =>
      neighborhoodsSummarySchema.parse(
        await send('DELETE', tenantPath(id, 'neighborhoods'), undefined, options),
      ),

    backofficeMunicipalities: async (
      q: string,
      options?: RequestOptions,
    ): Promise<MunicipalitySearchResponse> =>
      municipalitySearchResponseSchema.parse(
        await send('GET', `/backoffice/municipalities${panelQuery({ q })}`, undefined, options),
      ),

    backofficeCreateTenant: async (
      body: TenantCreateBody,
      options?: RequestOptions,
    ): Promise<TenantCreateResponse> =>
      tenantCreateResponseSchema.parse(await send('POST', '/backoffice/tenants', body, options)),

    backofficeEnterSupport: async (id: string, options?: RequestOptions): Promise<void> => {
      await send('POST', tenantPath(id, 'support/enter'), undefined, options);
    },

    backofficeLeaveSupport: async (id: string, options?: RequestOptions): Promise<void> => {
      await send('POST', tenantPath(id, 'support/leave'), undefined, options);
    },

    backofficeCityInterest: async (options?: RequestOptions): Promise<CityInterestResponse> =>
      cityInterestResponseSchema.parse(
        await send('GET', '/backoffice/city-interest', undefined, options),
      ),

    /** Texto do CSV (com BOM); a tela monta o Blob, porque o download precisa do token. */
    backofficeCityInterestCsv: (options?: RequestOptions): Promise<string> =>
      sendText('/backoffice/city-interest.csv', options),

    backofficeSetLeadStatus: async (
      ibgeCode: string,
      status: CommercialStatus,
      options?: RequestOptions,
    ): Promise<void> => {
      await send(
        'PUT',
        `/backoffice/city-interest/${encodeURIComponent(ibgeCode)}/status`,
        { status },
        options,
      );
    },

    backofficeStaff: async (options?: RequestOptions): Promise<StaffListResponse> =>
      staffListResponseSchema.parse(await send('GET', '/backoffice/staff', undefined, options)),

    backofficeAddStaff: async (
      body: StaffCreateBody,
      options?: RequestOptions,
    ): Promise<StaffCreateResponse> =>
      staffCreateResponseSchema.parse(await send('POST', '/backoffice/staff', body, options)),

    backofficeUpdateStaff: async (
      userId: string,
      body: StaffUpdateBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('PATCH', `/backoffice/staff/${encodeURIComponent(userId)}`, body, options);
    },

    backofficeRemoveStaff: async (userId: string, options?: RequestOptions): Promise<void> => {
      await send('DELETE', `/backoffice/staff/${encodeURIComponent(userId)}`, undefined, options);
    },

    backofficeAudit: async (
      params: Partial<AuditQuery> = {},
      options?: RequestOptions,
    ): Promise<AuditResponse> =>
      auditResponseSchema.parse(
        await send('GET', `/backoffice/audit${panelQuery({ ...params })}`, undefined, options),
      ),

    backofficeTenantCitizens: async (
      id: string,
      params: Partial<CitizenListQuery> = {},
      options?: RequestOptions,
    ): Promise<CitizenListResponse> =>
      citizenListResponseSchema.parse(
        await send(
          'GET',
          `${tenantPath(id, 'citizens')}${panelQuery({ ...params })}`,
          undefined,
          options,
        ),
      ),

    backofficeFrozenAccountCode: async (
      body: FrozenAccountCodeBody,
      options?: RequestOptions,
    ): Promise<FrozenAccountCodeResponse> =>
      frozenAccountCodeResponseSchema.parse(
        await send('POST', '/backoffice/frozen-accounts/recovery-code', body, options),
      ),

    backofficeRecoverFrozenAccount: async (
      body: FrozenAccountRecoverBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', '/backoffice/frozen-accounts/recover', body, options);
    },

    backofficeReleaseFrozenCpf: async (
      body: FrozenAccountReleaseBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', '/backoffice/frozen-accounts/release-cpf', body, options);
    },

    panelContext: async (tenantId: string, options?: RequestOptions): Promise<PanelContext> =>
      panelContextSchema.parse(
        await send('GET', '/panel/context', undefined, { ...options, tenantId }),
      ),

    panelCounts: async (tenantId: string, options?: RequestOptions): Promise<PanelCounts> =>
      panelCountsSchema.parse(
        await send('GET', '/panel/counts', undefined, { ...options, tenantId }),
      ),

    panelNotifications: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<PanelNotificationsResponse> =>
      panelNotificationsResponseSchema.parse(
        await send('GET', '/panel/notifications', undefined, { ...options, tenantId }),
      ),

    panelReadNotification: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', `/panel/notifications/${encodeURIComponent(id)}/read`, undefined, {
        ...options,
        tenantId,
      });
    },

    panelReadAllNotifications: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', '/panel/notifications/read-all', undefined, { ...options, tenantId });
    },

    panelOccurrences: async (
      tenantId: string,
      params: OccurrenceMapQuery,
      options?: RequestOptions,
    ): Promise<OccurrenceMapResponse> =>
      occurrenceMapResponseSchema.parse(
        await send('GET', `/panel/occurrences${panelQuery({ ...params })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelOccurrenceSummary: async (
      tenantId: string,
      params: OccurrenceSummaryQuery,
      options?: RequestOptions,
    ): Promise<OccurrenceSummary> =>
      occurrenceSummarySchema.parse(
        await send('GET', `/panel/occurrences/summary${panelQuery({ ...params })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelSearch: async (
      tenantId: string,
      q: string,
      options?: RequestOptions,
    ): Promise<PanelSearchResponse> =>
      panelSearchResponseSchema.parse(
        await send('GET', `/panel/search${panelQuery({ q })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelOccurrence: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<OccurrenceDetail> =>
      occurrenceDetailSchema.parse(
        await send('GET', panelPath(id), undefined, { ...options, tenantId }),
      ),

    panelTeams: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<TeamOptionsResponse> =>
      teamOptionsResponseSchema.parse(
        await send('GET', panelPath(id, 'teams'), undefined, { ...options, tenantId }),
      ),

    panelTriage: async (
      tenantId: string,
      params: TriageQuery,
      options?: RequestOptions,
    ): Promise<TriageResponse> =>
      triageResponseSchema.parse(
        await send('GET', `/panel/triage${panelQuery({ ...params })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelAssign: async (
      tenantId: string,
      id: string,
      body: AssignBody,
      options?: RequestOptions,
    ): Promise<AssignResponse> =>
      assignResponseSchema.parse(
        await send('POST', panelPath(id, 'assign'), body, { ...options, tenantId }),
      ),

    panelReject: async (
      tenantId: string,
      id: string,
      body: RejectBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', panelPath(id, 'reject'), body, { ...options, tenantId });
    },

    panelMerge: async (
      tenantId: string,
      id: string,
      body: MergeBody,
      options?: RequestOptions,
    ): Promise<MergeResponse> =>
      mergeResponseSchema.parse(
        await send('POST', panelPath(id, 'merge'), body, { ...options, tenantId }),
      ),

    panelDismissSuggestion: async (
      tenantId: string,
      id: string,
      body: DismissSuggestionBody,
      options?: RequestOptions,
    ): Promise<void> => {
      await send('POST', panelPath(id, 'dismiss-suggestion'), body, { ...options, tenantId });
    },

    panelSplit: async (
      tenantId: string,
      id: string,
      body: SplitBody,
      options?: RequestOptions,
    ): Promise<SplitResponse> =>
      splitResponseSchema.parse(
        await send('POST', panelPath(id, 'split'), body, { ...options, tenantId }),
      ),

    // Painel da prefeitura, parte B

    panelReviews: async (tenantId: string, options?: RequestOptions): Promise<WorkQueueResponse> =>
      workQueueResponseSchema.parse(
        await send('GET', '/panel/reviews', undefined, { ...options, tenantId }),
      ),

    panelReview: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<ReviewDetail> =>
      reviewDetailSchema.parse(
        await send('GET', `/panel/reviews/${encodeURIComponent(id)}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelPublish: async (
      tenantId: string,
      id: string,
      body: PublishBody,
      options?: RequestOptions,
    ): Promise<WorkOrderResult> =>
      workOrderResultSchema.parse(
        await send('POST', workOrderPath(id, 'publish'), body, { ...options, tenantId }),
      ),

    panelRework: async (
      tenantId: string,
      id: string,
      body: ReworkBody,
      options?: RequestOptions,
    ): Promise<WorkOrderResult> =>
      workOrderResultSchema.parse(
        await send('POST', workOrderPath(id, 'rework'), body, { ...options, tenantId }),
      ),

    panelImpediments: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<WorkQueueResponse> =>
      workQueueResponseSchema.parse(
        await send('GET', '/panel/impediments', undefined, { ...options, tenantId }),
      ),

    panelImpediment: async (
      tenantId: string,
      id: string,
      options?: RequestOptions,
    ): Promise<ImpedimentDetail> =>
      impedimentDetailSchema.parse(
        await send('GET', `/panel/impediments/${encodeURIComponent(id)}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelReassign: async (
      tenantId: string,
      id: string,
      body: ReassignBody,
      options?: RequestOptions,
    ): Promise<WorkOrderResult> =>
      workOrderResultSchema.parse(
        await send('POST', workOrderPath(id, 'reassign'), body, { ...options, tenantId }),
      ),

    panelReschedule: async (
      tenantId: string,
      id: string,
      body: RescheduleBody,
      options?: RequestOptions,
    ): Promise<WorkOrderResult> =>
      workOrderResultSchema.parse(
        await send('POST', workOrderPath(id, 'reschedule'), body, { ...options, tenantId }),
      ),

    panelInProgress: async (
      tenantId: string,
      params: InProgressQuery,
      options?: RequestOptions,
    ): Promise<InProgressResponse> =>
      inProgressResponseSchema.parse(
        await send('GET', `/panel/in-progress${panelQuery({ ...params })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelCategoryOptions: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<CategoryOptionsResponse> =>
      categoryOptionsResponseSchema.parse(
        await send('GET', '/panel/category-options', undefined, { ...options, tenantId }),
      ),

    panelNeighborhoods: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<NeighborhoodsResponse> =>
      neighborhoodsResponseSchema.parse(
        await send('GET', '/panel/neighborhoods', undefined, { ...options, tenantId }),
      ),

    panelTenantProfile: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<TenantProfile> =>
      tenantProfileSchema.parse(
        await send('GET', '/panel/tenant-profile', undefined, { ...options, tenantId }),
      ),

    panelRequests: async (
      tenantId: string,
      params: RequestListQuery,
      options?: RequestOptions,
    ): Promise<RequestListResponse> =>
      requestListResponseSchema.parse(
        await send('GET', `/panel/requests${panelQuery({ ...params })}`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelTeamsList: async (tenantId: string, options?: RequestOptions): Promise<TeamsResponse> =>
      teamsResponseSchema.parse(
        await send('GET', '/panel/teams', undefined, { ...options, tenantId }),
      ),

    panelCreateTeam: async (
      tenantId: string,
      body: TeamCreateBody,
      options?: RequestOptions,
    ): Promise<TeamSummary> =>
      teamSummarySchema.parse(await send('POST', '/panel/teams', body, { ...options, tenantId })),

    panelUpdateTeam: async (
      tenantId: string,
      id: string,
      body: TeamUpdateBody,
      options?: RequestOptions,
    ): Promise<TeamSummary> =>
      teamSummarySchema.parse(
        await send('PATCH', `/panel/teams/${encodeURIComponent(id)}`, body, {
          ...options,
          tenantId,
        }),
      ),

    panelAgents: async (
      tenantId: string,
      teamId: string,
      options?: RequestOptions,
    ): Promise<AgentsResponse> =>
      agentsResponseSchema.parse(
        await send('GET', `/panel/teams/${encodeURIComponent(teamId)}/agents`, undefined, {
          ...options,
          tenantId,
        }),
      ),

    panelAddAgent: async (
      tenantId: string,
      teamId: string,
      body: AgentCreateBody,
      options?: RequestOptions,
    ): Promise<AgentRow> =>
      agentRowSchema.parse(
        await send('POST', `/panel/teams/${encodeURIComponent(teamId)}/agents`, body, {
          ...options,
          tenantId,
        }),
      ),

    panelUpdateAgent: async (
      tenantId: string,
      userId: string,
      body: AgentUpdateBody,
      options?: RequestOptions,
    ): Promise<AgentRow> =>
      agentRowSchema.parse(
        await send('PATCH', `/panel/agents/${encodeURIComponent(userId)}`, body, {
          ...options,
          tenantId,
        }),
      ),

    panelDepartments: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<DepartmentsResponse> =>
      departmentsResponseSchema.parse(
        await send('GET', '/panel/departments', undefined, { ...options, tenantId }),
      ),

    panelCreateDepartment: async (
      tenantId: string,
      body: DepartmentBody,
      options?: RequestOptions,
    ): Promise<DepartmentRow> =>
      departmentRowSchema.parse(
        await send('POST', '/panel/departments', body, { ...options, tenantId }),
      ),

    panelUpdateDepartment: async (
      tenantId: string,
      id: string,
      body: DepartmentBody,
      options?: RequestOptions,
    ): Promise<DepartmentRow> =>
      departmentRowSchema.parse(
        await send('PATCH', `/panel/departments/${encodeURIComponent(id)}`, body, {
          ...options,
          tenantId,
        }),
      ),

    panelManagers: async (tenantId: string, options?: RequestOptions): Promise<ManagersResponse> =>
      managersResponseSchema.parse(
        await send('GET', '/panel/managers', undefined, { ...options, tenantId }),
      ),

    panelCreateManager: async (
      tenantId: string,
      body: ManagerCreateBody,
      options?: RequestOptions,
    ): Promise<ManagerRow> =>
      managerRowSchema.parse(await send('POST', '/panel/managers', body, { ...options, tenantId })),

    panelUpdateManager: async (
      tenantId: string,
      userId: string,
      body: ManagerUpdateBody,
      options?: RequestOptions,
    ): Promise<ManagerRow> =>
      managerRowSchema.parse(
        await send('PATCH', `/panel/managers/${encodeURIComponent(userId)}`, body, {
          ...options,
          tenantId,
        }),
      ),

    panelCategories: async (
      tenantId: string,
      options?: RequestOptions,
    ): Promise<CategoriesResponse> =>
      categoriesResponseSchema.parse(
        await send('GET', '/panel/categories', undefined, { ...options, tenantId }),
      ),

    panelCreateCategory: async (
      tenantId: string,
      body: CategoryCreateBody,
      options?: RequestOptions,
    ): Promise<CategoryRow> =>
      categoryRowSchema.parse(
        await send('POST', '/panel/categories', body, { ...options, tenantId }),
      ),

    panelUpdateCategory: async (
      tenantId: string,
      id: string,
      body: CategoryUpdateBody,
      options?: RequestOptions,
    ): Promise<CategoryRow> =>
      categoryRowSchema.parse(
        await send('PATCH', `/panel/categories/${encodeURIComponent(id)}`, body, {
          ...options,
          tenantId,
        }),
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
