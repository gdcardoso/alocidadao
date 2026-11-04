import { TERMS_VERSION } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, ApiTimeoutError, createApiClient } from './index.js';

/** fetch que nunca responde, mas respeita o AbortSignal. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('api client', () => {
  it('request times out', async () => {
    const api = createApiClient({ baseUrl: 'http://api', fetch: hangingFetch, timeoutMs: 20 });
    await expect(api.refresh('token')).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  it('logout sends the explicit token', async () => {
    let auth: string | null = null;
    const fakeFetch: typeof fetch = async (_input, init) => {
      auth = new Headers(init?.headers).get('Authorization');
      return new Response(null, { status: 204 });
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.logout('access-1');
    expect(auth).toBe('Bearer access-1');
  });

  it('createRequest parses the response', async () => {
    let sent: { url: string; method?: string; body: unknown } | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      sent = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
      return Response.json(
        { requestId: REQUEST_ID, protocol: '2026-000123', status: 'open', duplicate: false },
        { status: 201 },
      );
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.createRequest(createBody);
    expect(result).toEqual({
      requestId: REQUEST_ID,
      protocol: '2026-000123',
      status: 'open',
      duplicate: false,
    });
    expect(sent).toEqual({ url: 'http://api/citizen/requests', method: 'POST', body: createBody });
  });

  it('createRequest rejects a response outside the schema', async () => {
    const fakeFetch: typeof fetch = async () => Response.json({ requestId: 'x' }, { status: 201 });
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await expect(api.createRequest(createBody)).rejects.toThrow();
  });

  it('caller signal aborts the request', async () => {
    const api = createApiClient({ baseUrl: 'http://api', fetch: hangingFetch, timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = api.listRequests('all', { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiTimeoutError);
    expect(controller.signal.aborted).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });

  it('already aborted caller signal does not call fetch', async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return Response.json([]);
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await expect(api.listRequests('all', { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('timeout still applies when the caller passes a signal', async () => {
    const api = createApiClient({ baseUrl: 'http://api', fetch: hangingFetch, timeoutMs: 20 });
    const controller = new AbortController();
    await expect(api.listRequests('all', { signal: controller.signal })).rejects.toBeInstanceOf(
      ApiTimeoutError,
    );
  });

  it('listRequests sends the filter and parses the cards', async () => {
    let url = '';
    const fakeFetch: typeof fetch = async (input) => {
      url = String(input);
      return Response.json([
        {
          id: REQUEST_ID,
          protocol: '2026-000123',
          status: 'awaiting_confirmation',
          categoryName: 'Buraco na via',
          icon: 'construction',
          iconGroup: 'infrastructure',
          address: 'Rua das Flores, 120',
          createdAt: '2026-10-20T11:12:00.000Z',
          statusChangedAt: '2026-10-21T18:40:00.000Z',
        },
      ]);
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const cards = await api.listRequests('active');
    expect(url).toBe('http://api/citizen/requests?filter=active');
    expect(cards[0]?.categoryName).toBe('Buraco na via');
  });

  it('locate encodes the coordinates', async () => {
    let url = '';
    const fakeFetch: typeof fetch = async (input) => {
      url = String(input);
      return Response.json({ status: 'not_served', municipality: null });
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.locate({ lat: -23.5, lng: -46.6 });
    expect(url).toBe('http://api/citizen/locate?lat=-23.5&lng=-46.6');
    expect(result.status).toBe('not_served');
  });

  it('registerDevice puts to the installation path and accepts 204', async () => {
    let sent: { url: string; method?: string } | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      sent = { url: String(input), method: init?.method };
      return new Response(null, { status: 204 });
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.registerDevice(REQUEST_ID, { platform: 'android', appVersion: '1.0.0' });
    expect(sent).toEqual({ url: `http://api/me/devices/${REQUEST_ID}`, method: 'PUT' });
  });

  it('acceptTerms posts the current version and accepts 204', async () => {
    let sent: { url: string; method?: string; body: unknown } | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      sent = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
      return new Response(null, { status: 204 });
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.acceptTerms();
    expect(sent).toEqual({
      url: 'http://api/me/terms',
      method: 'POST',
      body: { acceptedTermsVersion: TERMS_VERSION },
    });
  });

  it('agent requests send the tenant header', async () => {
    const sent: { url: string; method?: string; tenant: string | null }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      sent.push({
        url,
        method: init?.method,
        tenant: new Headers(init?.headers).get('x-tenant-id'),
      });
      if (url.endsWith('/agent/uploads')) {
        return Response.json({ key: 'k', url: 'http://s3/put', headers: {} });
      }
      if (url.endsWith('/agent/work-orders')) return Response.json([agentCard]);
      return Response.json(agentDetail);
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const cards = await api.agentWorkOrders(TENANT_ID);
    const detail = await api.agentWorkOrder(TENANT_ID, WORK_ORDER_ID);
    const upload = await api.agentUpload(TENANT_ID);
    expect(cards[0]?.protocol).toBe('2026-000123');
    expect(detail.citizenCount).toBe(2);
    expect(upload.key).toBe('k');
    expect(sent).toEqual([
      { url: 'http://api/agent/work-orders', method: 'GET', tenant: TENANT_ID },
      { url: `http://api/agent/work-orders/${WORK_ORDER_ID}`, method: 'GET', tenant: TENANT_ID },
      { url: 'http://api/agent/uploads', method: 'POST', tenant: TENANT_ID },
    ]);
  });

  it('agent work order list rejects an invalid response', async () => {
    const fakeFetch: typeof fetch = async () =>
      Response.json([{ ...agentCard, tenantId: undefined }]);
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await expect(api.agentWorkOrders(TENANT_ID)).rejects.toThrow();
  });

  it('requests without a tenant do not send the header', async () => {
    let tenant: string | null = 'unset';
    const fakeFetch: typeof fetch = async (_input, init) => {
      tenant = new Headers(init?.headers).get('x-tenant-id');
      return Response.json([]);
    };
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.listRequests('all');
    expect(tenant).toBeNull();
  });

  it('action errors keep the API code', async () => {
    const fakeFetch: typeof fetch = async () =>
      Response.json({ code: 'invalid_status' }, { status: 409 });
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const error = await api
      .cancelRequest(REQUEST_ID, { clientActionId: REQUEST_ID })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toEqual({ code: 'invalid_status' });
  });
});

const REQUEST_ID = '0b9a4a52-5d0c-4a0e-9c7e-3f1f6a2b8c01';

const createBody = {
  clientActionId: REQUEST_ID,
  categoryId: REQUEST_ID,
  occurredAt: '2026-10-20T11:12:00.000Z',
  gpsLocation: { lat: -23.5, lng: -46.6 },
  location: { lat: -23.5, lng: -46.6 },
  photoKeys: ['requests/u/1.jpg'],
  connection: {
    networkType: 'wifi' as const,
    cellularGeneration: null,
    apiLatencyMs: null,
    uploadDurationMs: null,
    sentOffline: false,
  },
};

const TENANT_ID = '7c1d2e3f-4a5b-4c6d-8e7f-901234567890';
const WORK_ORDER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const agentCard = {
  id: WORK_ORDER_ID,
  tenantId: TENANT_ID,
  status: 'assigned',
  protocol: '2026-000123',
  categoryName: 'Buraco na via',
  categoryIcon: 'construction',
  categoryGroup: 'infrastructure',
  address: 'Rua das Flores, 120',
  location: { lat: -23.5, lng: -46.6 },
  teamName: 'Equipe Centro',
  reportCount: 2,
  dueAt: null,
  assignedAt: '2026-10-20T11:12:00.000Z',
  statusChangedAt: '2026-10-20T11:12:00.000Z',
};

const agentDetail = {
  ...agentCard,
  managerInstructions: null,
  assignedBy: null,
  reports: [],
  photos: [],
  citizenCount: 2,
  rework: null,
  previousNote: null,
};

describe('panel calls', () => {
  const recorder = (response: () => Response) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return response();
    };
    return { calls, fakeFetch };
  };

  it('panelRefresh sends the csrf header and no authorization', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ accessToken: 'a', accessExpiresInSeconds: 900 }),
    );
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: fakeFetch,
      getToken: () => 'session-token',
      credentials: 'same-origin',
    });
    await api.panelRefresh();
    const headers = new Headers(calls[0]?.init?.headers);
    expect(calls[0]?.url).toBe('http://api/auth/panel/refresh');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect(headers.get('x-requested-with')).toBe('alocidadao-panel');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('panelLogout sends the csrf header and accepts 204', async () => {
    const { calls, fakeFetch } = recorder(() => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch, getToken: () => 't' });
    await api.panelLogout();
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('x-requested-with')).toBe('alocidadao-panel');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('panel calls send the tenant header', async () => {
    const { calls, fakeFetch } = recorder(() => Response.json({ total: 0, items: [] }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch, getToken: () => 't' });
    await api.panelTriage(TENANT_ID, { onlySuggestions: true });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('x-tenant-id')).toBe(TENANT_ID);
    expect(headers.get('Authorization')).toBe('Bearer t');
    expect(calls[0]?.url).toBe('http://api/panel/triage?onlySuggestions=true');
  });

  it('panelOccurrences serializes days null as all', async () => {
    const { calls, fakeFetch } = recorder(() => Response.json({ total: 0, items: [] }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.panelOccurrences(TENANT_ID, { status: 'open', days: null });
    expect(calls[0]?.url).toBe('http://api/panel/occurrences?status=open&days=all');
    await api.panelOccurrences(TENANT_ID, { status: 'open', days: 7, categoryId: REQUEST_ID });
    expect(calls[1]?.url).toBe(
      `http://api/panel/occurrences?status=open&days=7&categoryId=${REQUEST_ID}`,
    );
  });

  it('panelReject surfaces 409 as ApiError with the code', async () => {
    const { fakeFetch } = recorder(() =>
      Response.json({ code: 'invalid_status' }, { status: 409 }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const error = await api
      .panelReject(TENANT_ID, REQUEST_ID, { reason: 'Fora da competência' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).body).toEqual({ code: 'invalid_status' });
  });

  it('panelReject resolves on 204', async () => {
    const { calls, fakeFetch } = recorder(() => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await expect(
      api.panelReject(TENANT_ID, REQUEST_ID, { reason: 'Fora da competência' }),
    ).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe(`http://api/panel/occurrences/${REQUEST_ID}/reject`);
  });

  it('panelNotifications parses the bell list', async () => {
    const { calls, fakeFetch } = recorder(() => Response.json({ items: [], unreadCount: 0 }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    expect(await api.panelNotifications(TENANT_ID)).toEqual({ items: [], unreadCount: 0 });
    expect(calls[0]?.url).toBe('http://api/panel/notifications');
    expect(new Headers(calls[0]?.init?.headers).get('x-tenant-id')).toBe(TENANT_ID);
  });

  it('panelReadNotification and panelReadAllNotifications post and resolve on 204', async () => {
    const { calls, fakeFetch } = recorder(() => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await expect(api.panelReadNotification(TENANT_ID, REQUEST_ID)).resolves.toBeUndefined();
    await expect(api.panelReadAllNotifications(TENANT_ID)).resolves.toBeUndefined();
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['POST', `http://api/panel/notifications/${REQUEST_ID}/read`],
      ['POST', 'http://api/panel/notifications/read-all'],
    ]);
  });

  it('panelCategoryOptions gets the scoped options', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ items: [{ id: REQUEST_ID, name: 'Buraco' }] }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.panelCategoryOptions(TENANT_ID);
    expect(calls[0]?.url).toBe('http://api/panel/category-options');
    expect(result.items[0]?.name).toBe('Buraco');
  });

  it('panelOccurrenceSummary serializes the filters and parses the counts', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ triage: 3, inProgress: 5, dueSoon: 1, overdue: 2 }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.panelOccurrenceSummary(TENANT_ID, {
      days: null,
      neighborhood: 'Centro',
    });
    expect(calls[0]?.url).toBe('http://api/panel/occurrences/summary?days=all&neighborhood=Centro');
    expect(result).toEqual({ triage: 3, inProgress: 5, dueSoon: 1, overdue: 2 });
  });

  it('panelNeighborhoods gets the effective neighborhoods', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ items: ['Centro'], source: 'tenant' }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.panelNeighborhoods(TENANT_ID);
    expect(calls[0]?.url).toBe('http://api/panel/neighborhoods');
    expect(result).toEqual({ items: ['Centro'], source: 'tenant' });
  });

  it('panelTenantProfile gets the tenant profile', async () => {
    const profile = {
      displayName: 'Prefeitura de Teste',
      city: 'Teste',
      state: 'PR',
      ibgeCode: '4100000',
      centralPhone: null,
      status: 'active',
      contract: { plan: 'essential', startsOn: '2026-01-01', endsOn: null, includedPanelUsers: 5 },
      panelUserCount: 3,
      neighborhoods: { count: 2, source: 'ibge' },
    };
    const { calls, fakeFetch } = recorder(() => Response.json(profile));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const result = await api.panelTenantProfile(TENANT_ID);
    expect(calls[0]?.url).toBe('http://api/panel/tenant-profile');
    expect(new Headers(calls[0]?.init?.headers).get('x-tenant-id')).toBe(TENANT_ID);
    expect(result).toEqual(profile);
  });

  it('panelRequests serializes days null as all and page as text', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ total: 0, page: 2, pageSize: 50, items: [] }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.panelRequests(TENANT_ID, { days: null, q: '', page: 2 });
    expect(calls[0]?.url).toBe('http://api/panel/requests?days=all&q=&page=2');
    expect(new Headers(calls[0]?.init?.headers).get('x-tenant-id')).toBe(TENANT_ID);
  });

  it('panelPublish posts the body to the work order', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ workOrderId: REQUEST_ID, status: 'completed' }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const body = { publicNote: 'Buraco tapado com asfalto', publishedPhotoIds: [] };
    await api.panelPublish(TENANT_ID, REQUEST_ID, body);
    expect(calls[0]?.url).toBe(`http://api/panel/work-orders/${REQUEST_ID}/publish`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body);
  });

  it('panelAddAgent surfaces 409 with teamName in the error body', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({ code: 'agent_in_other_team', teamName: 'Equipe Norte' }, { status: 409 }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    const error = await api
      .panelAddAgent(TENANT_ID, REQUEST_ID, {
        name: 'Maria Souza',
        phone: '+5511999990000',
        email: 'maria@exemplo.com',
      })
      .catch((e: unknown) => e);
    expect(calls[0]?.url).toBe(`http://api/panel/teams/${REQUEST_ID}/agents`);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toEqual({
      code: 'agent_in_other_team',
      teamName: 'Equipe Norte',
    });
  });

  it('panel invite resend posts to the manager and agent routes with the tenant', async () => {
    const { calls, fakeFetch } = recorder(() => Response.json({ maskedEmail: 'm•••@exemplo.com' }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    expect(await api.panelResendManagerInvite(TENANT_ID, REQUEST_ID)).toEqual({
      maskedEmail: 'm•••@exemplo.com',
    });
    await api.panelResendAgentInvite(TENANT_ID, REQUEST_ID);
    expect(calls.map((c) => c.url)).toEqual([
      `http://api/panel/managers/${REQUEST_ID}/invite`,
      `http://api/panel/agents/${REQUEST_ID}/invite`,
    ]);
    for (const call of calls) {
      expect(call.init?.method).toBe('POST');
      expect(new Headers(call.init?.headers).get('x-tenant-id')).toBe(TENANT_ID);
    }
  });

  it('panelUpdateCategory sends PATCH', async () => {
    const { calls, fakeFetch } = recorder(() =>
      Response.json({
        id: REQUEST_ID,
        name: 'Iluminação',
        icon: null,
        iconGroup: 'infrastructure',
        departmentId: REQUEST_ID,
        departmentName: 'Obras',
        defaultDeadlineDays: 5,
        clusterRadiusM: 50,
        active: true,
      }),
    );
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch });
    await api.panelUpdateCategory(TENANT_ID, REQUEST_ID, { defaultDeadlineDays: 5 });
    expect(calls[0]?.url).toBe(`http://api/panel/categories/${REQUEST_ID}`);
    expect(calls[0]?.init?.method).toBe('PATCH');
  });
});

describe('backoffice calls', () => {
  const NEW_TENANT_ID = '7c1d2e3f-4a5b-4c6d-8e7f-901234567890';
  const body = {
    ibgeCode: '3550308',
    displayName: 'Prefeitura de Exemplo',
    centralPhone: null,
    admin: { name: 'Maria Souza', cpf: '52998224725', email: 'maria@exemplo.com' },
    contract: {
      plan: 'essential' as const,
      includedPanelUsers: 5,
      startsOn: '2026-11-01',
      endsOn: null,
    },
    copyDefaultCatalog: true,
  };

  const recorder = (response: () => Response) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return response();
    };
    return { calls, fakeFetch };
  };

  it('backofficeCreateTenant posts the body and surfaces email_mismatch with maskedEmail', async () => {
    const created = recorder(() => Response.json({ id: NEW_TENANT_ID }, { status: 201 }));
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: created.fakeFetch,
      getToken: () => 't',
    });
    await expect(api.backofficeCreateTenant(body)).resolves.toEqual({ id: NEW_TENANT_ID });
    expect(created.calls[0]?.url).toBe('http://api/backoffice/tenants');
    expect(created.calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(created.calls[0]?.init?.body))).toEqual(body);

    const mismatch = recorder(() =>
      Response.json({ code: 'email_mismatch', maskedEmail: 'm•••@exemplo.com' }, { status: 409 }),
    );
    const failing = createApiClient({ baseUrl: 'http://api', fetch: mismatch.fakeFetch });
    const error = await failing.backofficeCreateTenant(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).body).toEqual({
      code: 'email_mismatch',
      maskedEmail: 'm•••@exemplo.com',
    });
  });

  it('backoffice contract and neighborhoods methods use the expected routes', async () => {
    const detail = {
      id: NEW_TENANT_ID,
      displayName: 'Prefeitura X',
      state: 'SP',
      ibgeCode: '3550308',
      status: 'active',
      centralPhone: null,
      contract: null,
      stats: {
        citizenCount: 0,
        openCount: 0,
        staleTriageCount: 0,
        awaitingReviewCount: 0,
        lateReviewCount: 0,
        avgResolutionDays: null,
        teamCount: 0,
        activeAgentCount: 0,
        invitedAgentCount: 0,
        managerCount: 0,
        adminCount: 0,
        activeCategoryCount: 0,
        panelUserCount: 0,
      },
      recentStaffActions: [],
    };
    const contract = {
      displayName: 'Prefeitura X',
      centralPhone: null,
      plan: 'complete' as const,
      startsOn: '2026-01-01',
      endsOn: null,
      includedPanelUsers: 10,
    };
    const put = recorder(() => Response.json(detail));
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: put.fakeFetch,
      getToken: () => 't',
    });
    await expect(api.backofficeUpdateContract(NEW_TENANT_ID, contract)).resolves.toMatchObject({
      id: NEW_TENANT_ID,
    });
    expect(put.calls[0]?.url).toBe(`http://api/backoffice/tenants/${NEW_TENANT_ID}/contract`);
    expect(put.calls[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(put.calls[0]?.init?.body))).toEqual(contract);

    const summary = recorder(() => Response.json({ count: 3, source: 'tenant' }));
    const hoods = createApiClient({
      baseUrl: 'http://api',
      fetch: summary.fakeFetch,
      getToken: () => 't',
    });
    const geojson = { type: 'FeatureCollection', features: [] };
    await expect(hoods.backofficeNeighborhoods(NEW_TENANT_ID)).resolves.toEqual({
      count: 3,
      source: 'tenant',
    });
    await hoods.backofficePutNeighborhoods(NEW_TENANT_ID, geojson);
    await hoods.backofficeResetNeighborhoods(NEW_TENANT_ID);
    const url = `http://api/backoffice/tenants/${NEW_TENANT_ID}/neighborhoods`;
    expect(summary.calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['GET', url],
      ['PUT', url],
      ['DELETE', url],
    ]);
    expect(JSON.parse(String(summary.calls[1]?.init?.body))).toEqual(geojson);
    for (const call of summary.calls) {
      expect(new Headers(call.init?.headers).get('x-tenant-id')).toBeNull();
    }

    const invalid = recorder(() =>
      Response.json({ code: 'invalid_neighborhoods' }, { status: 422 }),
    );
    const failing = createApiClient({ baseUrl: 'http://api', fetch: invalid.fakeFetch });
    const error = await failing
      .backofficePutNeighborhoods(NEW_TENANT_ID, {})
      .catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).body).toEqual({ code: 'invalid_neighborhoods' });
  });

  it('backoffice calls send no tenant header', async () => {
    const { calls, fakeFetch } = recorder(() => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch, getToken: () => 't' });
    await api.backofficeEnterSupport(NEW_TENANT_ID);
    await api.backofficeLeaveSupport(NEW_TENANT_ID);
    expect(calls.map((c) => c.url)).toEqual([
      `http://api/backoffice/tenants/${NEW_TENANT_ID}/support/enter`,
      `http://api/backoffice/tenants/${NEW_TENANT_ID}/support/leave`,
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(call.init?.method).toBe('POST');
      expect(headers.get('x-tenant-id')).toBeNull();
      expect(headers.get('Authorization')).toBe('Bearer t');
    }
  });

  it('backofficeSetTenantStatus and backofficeMunicipalities use the expected routes', async () => {
    const status = recorder(() => Response.json({ status: 'suspended' }));
    const api = createApiClient({ baseUrl: 'http://api', fetch: status.fakeFetch });
    await expect(
      api.backofficeSetTenantStatus(NEW_TENANT_ID, { action: 'suspend' }),
    ).resolves.toEqual({
      status: 'suspended',
    });
    expect(status.calls[0]?.url).toBe(`http://api/backoffice/tenants/${NEW_TENANT_ID}/status`);
    expect(JSON.parse(String(status.calls[0]?.init?.body))).toEqual({ action: 'suspend' });

    const search = recorder(() => Response.json({ items: [] }));
    const searchApi = createApiClient({ baseUrl: 'http://api', fetch: search.fakeFetch });
    await searchApi.backofficeMunicipalities('São Paulo');
    expect(search.calls[0]?.url).toBe('http://api/backoffice/municipalities?q=S%C3%A3o+Paulo');
  });

  it('6b backoffice methods call the right paths without x-tenant-id', async () => {
    const U = '7c1d2e3f-4a5b-4c6d-8e7f-901234567891';
    const row = {
      id: U,
      at: '2026-10-28T10:00:00.000Z',
      staffName: 'Ana',
      tenantId: null,
      tenantName: null,
      action: 'staff.create',
      targetType: 'staff',
      targetLabel: 'Bia',
    };
    const member = {
      userId: U,
      name: 'Ana',
      maskedCpf: '***.456.789-**',
      email: 'ana@exemplo.com',
      platformRole: 'admin',
      lastActiveAt: null,
    };
    const csv = '\uFEFFPosição;Município\r\n1;Exemplo\r\n';
    const cases: {
      name: string;
      call: (api: ReturnType<typeof createApiClient>) => Promise<unknown>;
      method: string;
      path: string;
      body?: unknown;
      response: () => Response;
      result?: unknown;
    }[] = [
      {
        name: 'city interest',
        call: (a) => a.backofficeCityInterest(),
        method: 'GET',
        path: '/backoffice/city-interest',
        response: () => Response.json({ items: [] }),
        result: { items: [] },
      },
      {
        name: 'csv',
        call: (a) => a.backofficeCityInterestCsv(),
        method: 'GET',
        path: '/backoffice/city-interest.csv',
        response: () => new Response(csv, { headers: { 'content-type': 'text/csv' } }),
        result: csv,
      },
      {
        name: 'lead status',
        call: (a) => a.backofficeSetLeadStatus('3550308', 'won'),
        method: 'PUT',
        path: '/backoffice/city-interest/3550308/status',
        body: { status: 'won' },
        response: () => new Response(null, { status: 204 }),
      },
      {
        name: 'tenant teams',
        call: (a) => a.backofficeTenantTeams(U),
        method: 'GET',
        path: `/backoffice/tenants/${U}/teams`,
        response: () => Response.json({ items: [] }),
        result: { items: [] },
      },
      {
        name: 'tenant citizens',
        call: (a) => a.backofficeTenantCitizens(U, { q: 'ana', situation: 'frozen', page: 2 }),
        method: 'GET',
        path: `/backoffice/tenants/${U}/citizens?q=ana&situation=frozen&page=2`,
        response: () => Response.json({ items: [], total: 0, page: 2, pageSize: 50 }),
        result: { items: [], total: 0, page: 2, pageSize: 50 },
      },
      {
        name: 'tenant managers',
        call: (a) => a.backofficeTenantManagers(U),
        method: 'GET',
        path: `/backoffice/tenants/${U}/managers`,
        response: () => Response.json({ items: [] }),
        result: { items: [] },
      },
      {
        name: 'tenant manager invite',
        call: (a) => a.backofficeResendTenantManagerInvite(U, U),
        method: 'POST',
        path: `/backoffice/tenants/${U}/managers/${U}/invite`,
        response: () => Response.json({ maskedEmail: 'a•••@exemplo.com' }),
        result: { maskedEmail: 'a•••@exemplo.com' },
      },
      {
        name: 'staff invite',
        call: (a) => a.backofficeResendStaffInvite(U),
        method: 'POST',
        path: `/backoffice/staff/${U}/invite`,
        response: () => Response.json({ maskedEmail: 'b•••@exemplo.com' }),
        result: { maskedEmail: 'b•••@exemplo.com' },
      },
      {
        name: 'tenant categories',
        call: (a) => a.backofficeTenantCategories(U),
        method: 'GET',
        path: `/backoffice/tenants/${U}/categories`,
        response: () => Response.json({ items: [] }),
        result: { items: [] },
      },
      {
        name: 'staff list',
        call: (a) => a.backofficeStaff(),
        method: 'GET',
        path: '/backoffice/staff',
        response: () => Response.json({ items: [member] }),
        result: { items: [member] },
      },
      {
        name: 'staff add',
        call: (a) =>
          a.backofficeAddStaff({
            name: 'Bia',
            cpf: '52998224725',
            email: 'bia@exemplo.com',
            platformRole: 'support',
          }),
        method: 'POST',
        path: '/backoffice/staff',
        body: {
          name: 'Bia',
          cpf: '52998224725',
          email: 'bia@exemplo.com',
          platformRole: 'support',
        },
        response: () => Response.json({ id: U }, { status: 201 }),
        result: { id: U },
      },
      {
        name: 'staff update',
        call: (a) => a.backofficeUpdateStaff(U, { platformRole: 'admin' }),
        method: 'PATCH',
        path: `/backoffice/staff/${U}`,
        body: { platformRole: 'admin' },
        response: () => new Response(null, { status: 204 }),
      },
      {
        name: 'staff remove',
        call: (a) => a.backofficeRemoveStaff(U),
        method: 'DELETE',
        path: `/backoffice/staff/${U}`,
        response: () => new Response(null, { status: 204 }),
      },
      {
        name: 'audit',
        call: (a) => a.backofficeAudit({ tenantId: U, from: '2026-10-01', page: 2 }),
        method: 'GET',
        path: `/backoffice/audit?tenantId=${U}&from=2026-10-01&page=2`,
        response: () => Response.json({ items: [row], total: 1, page: 2, pageSize: 50 }),
        result: { items: [row], total: 1, page: 2, pageSize: 50 },
      },
      {
        name: 'frozen code',
        call: (a) => a.backofficeFrozenAccountCode({ cpf: '52998224725', tenantId: null }),
        method: 'POST',
        path: '/backoffice/frozen-accounts/recovery-code',
        body: { cpf: '52998224725', tenantId: null },
        response: () =>
          Response.json({ challengeId: U, maskedEmail: 'a***@exemplo.com', retryAfterSeconds: 60 }),
        result: { challengeId: U, maskedEmail: 'a***@exemplo.com', retryAfterSeconds: 60 },
      },
      {
        name: 'frozen recover',
        call: (a) =>
          a.backofficeRecoverFrozenAccount({
            challengeId: U,
            code: '123456',
            email: 'novo@exemplo.com',
            tenantId: U,
          }),
        method: 'POST',
        path: '/backoffice/frozen-accounts/recover',
        body: { challengeId: U, code: '123456', email: 'novo@exemplo.com', tenantId: U },
        response: () => new Response(null, { status: 204 }),
      },
      {
        name: 'frozen release',
        call: (a) => a.backofficeReleaseFrozenCpf({ cpf: '52998224725', tenantId: null }),
        method: 'POST',
        path: '/backoffice/frozen-accounts/release-cpf',
        body: { cpf: '52998224725', tenantId: null },
        response: () => new Response(null, { status: 204 }),
      },
    ];
    for (const c of cases) {
      const { calls, fakeFetch } = recorder(c.response);
      const api = createApiClient({ baseUrl: 'http://api', fetch: fakeFetch, getToken: () => 't' });
      const result = await c.call(api);
      const call = calls[0];
      expect(call?.url, c.name).toBe(`http://api${c.path}`);
      expect(call?.init?.method, c.name).toBe(c.method);
      const headers = new Headers(call?.init?.headers);
      expect(headers.get('x-tenant-id'), c.name).toBeNull();
      expect(headers.get('Authorization'), c.name).toBe('Bearer t');
      if (c.body !== undefined)
        expect(JSON.parse(String(call?.init?.body)), c.name).toEqual(c.body);
      if (c.result !== undefined) expect(result, c.name).toEqual(c.result);
    }
  });
});
