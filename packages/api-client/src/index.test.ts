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
