import { createDatabase, geoPoint, schema, withContext } from '@alocidadao/db';
import { seedDev } from '@alocidadao/db/seed';
import {
  agentWorkOrderCardSchema,
  agentWorkOrderDetailSchema,
  type ReworkDetails,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createStorage, newPhotoKey, newRequestPhotoKey } from '../storage/s3.js';
import { testStorageConfig } from '../storage/test-fixtures.js';
import { appAuthHeader, TEST_AUTH_SECRET, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const {
  tenants,
  users,
  memberships,
  departments,
  teams,
  teamMembers,
  categories,
  occurrences,
  requests,
  photos,
  statusEvents,
  workOrders,
} = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const storage = createStorage(testStorageConfig);

const HOUR_MS = 60 * 60 * 1000;

let app: Awaited<ReturnType<typeof buildApp>>;
let tenantId: string;
let teamId: string;
let agentId: string;
let managerId: string;
let categoryId: string;
let citizenIds: string[];
let otherTeamId: string;
let outsiderId: string;
let otherTenantId: string;
let otherTenantAgentId: string;

/** Cidadãos criados aqui: nada deles pode aparecer nas respostas ao agente. */
const CITIZENS = [
  { name: 'Joana Relatora', phone: '+5511980001001', email: 'joana.relatora@teste.dev' },
  { name: 'Pedro Vizinho', phone: '+5511980001002', email: 'pedro.vizinho@teste.dev' },
  { name: 'Ana Desistente', phone: '+5511980001003', email: 'ana.desistente@teste.dev' },
];

interface ReportInput {
  description: string;
  status?: 'in_progress' | 'cancelled';
  citizen?: number;
  /** Minutos depois do primeiro relato. */
  minutesAfter?: number;
}

interface WorkOrderInput {
  team?: string;
  status?: WorkOrderStatus;
  reports?: ReportInput[];
  managerInstructions?: string | null;
  agentNote?: string | null;
  dueAt?: Date | null;
  address?: string;
}

/**
 * Cria ocorrência, os relatos e a atividade (dono: ignora o RLS). Os relatos começam 2 h
 * atrás; a atividade é criada 1 h atrás. Devolve ids e protocolos dos relatos.
 */
async function newWorkOrder({
  team = teamId,
  status = 'assigned',
  reports = [{ description: 'Buraco na via, teste do agente' }],
  managerInstructions = null,
  agentNote = null,
  dueAt = null,
  address = 'Rua do Teste, 10',
}: WorkOrderInput = {}) {
  const base = Date.now() - 2 * HOUR_MS;
  // O protocolo sai de next_request_protocol(), que lê a prefeitura do contexto.
  return withContext(owner.db, { tenantId }, async (tx) => {
    const location = geoPoint({ lat: -23.551, lng: -46.634 });
    const [occurrence] = await tx
      .insert(occurrences)
      .values({ tenantId, categoryId, location, status: 'in_progress' })
      .returning();
    const created: Array<{ id: string; protocol: string }> = [];
    for (const [index, report] of reports.entries()) {
      const [row] = await tx
        .insert(requests)
        .values({
          tenantId,
          citizenId: citizenIds[report.citizen ?? index % citizenIds.length]!,
          categoryId,
          occurrenceId: occurrence!.id,
          status: report.status ?? 'in_progress',
          description: report.description,
          address: index === 0 ? address : `Outro endereço ${index}`,
          location,
          gpsLocation: location,
          createdAt: new Date(base + (report.minutesAfter ?? index) * 60_000),
        })
        .returning({ id: requests.id, protocol: requests.protocol });
      created.push(row!);
    }
    const [order] = await tx
      .insert(workOrders)
      .values({
        tenantId,
        occurrenceId: occurrence!.id,
        teamId: team,
        status,
        managerInstructions,
        agentNote,
        dueAt,
        createdAt: new Date(Date.now() - HOUR_MS),
      })
      .returning();
    return { id: order!.id, occurrenceId: occurrence!.id, createdAt: order!.createdAt, created };
  });
}

async function addEvent(
  order: { id: string; occurrenceId: string },
  values: {
    toStatus: string;
    fromStatus?: string;
    actorUserId?: string | null;
    comment?: string | null;
    details?: ReworkDetails | null;
    at: Date;
  },
) {
  await owner.db.insert(statusEvents).values({
    tenantId,
    occurrenceId: order.occurrenceId,
    workOrderId: order.id,
    fromStatus: values.fromStatus ?? null,
    toStatus: values.toStatus,
    actorUserId: values.actorUserId ?? null,
    comment: values.comment ?? null,
    details: values.details ?? null,
    createdAt: values.at,
  });
}

const authHeaders = new Map<string, Record<string, string>>();

async function headers(as: { tenantId: string; userId: string } = { tenantId, userId: agentId }) {
  const key = `${as.tenantId}:${as.userId}`;
  let found = authHeaders.get(key);
  if (!found) {
    found = { ...(await appAuthHeader(appDb.db, as.userId)), 'x-tenant-id': as.tenantId };
    authHeaders.set(key, found);
  }
  return found;
}

async function get(url: string, as?: { tenantId: string; userId: string }) {
  return app.inject({ method: 'GET', url, headers: await headers(as) });
}

async function list(as?: { tenantId: string; userId: string }) {
  const res = await get('/agent/work-orders', as);
  expect(res.statusCode).toBe(200);
  return agentWorkOrderCardSchema.array().parse(res.json());
}

async function detail(id: string) {
  const res = await get(`/agent/work-orders/${id}`);
  expect(res.statusCode).toBe(200);
  return { parsed: agentWorkOrderDetailSchema.parse(res.json()), raw: res.json() as unknown };
}

/** Todas as chaves de objeto, em qualquer nível do JSON. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)]);
  }
  return [];
}

beforeAll(async () => {
  const seeded = await seedDev(owner.db);
  ({ tenantId, teamId, agentId, managerId } = seeded);
  // O "Buraco na via" da demo: ícone construction, grupo infrastructure.
  const [category] = await owner.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.name, 'Buraco na via')));
  categoryId = category!.id;

  citizenIds = [];
  for (const citizen of CITIZENS) {
    const [row] = await owner.db.insert(users).values(citizen).returning();
    await owner.db.insert(memberships).values({ tenantId, userId: row!.id, role: 'citizen' });
    citizenIds.push(row!.id);
  }

  // Outra equipe da mesma prefeitura, com outro agente.
  const [otherDept] = await owner.db
    .insert(departments)
    .values({ tenantId, name: 'Iluminação Pública' })
    .returning();
  const [otherTeam] = await owner.db
    .insert(teams)
    .values({ tenantId, departmentId: otherDept!.id, name: 'Equipe Luz' })
    .returning();
  otherTeamId = otherTeam!.id;
  const [otherAgent] = await owner.db
    .insert(users)
    .values({ name: 'Agente da Luz', phone: '+5511980001004' })
    .returning();
  await owner.db
    .insert(memberships)
    .values({ tenantId, userId: otherAgent!.id, role: 'field_agent' });
  await owner.db
    .insert(teamMembers)
    .values({ tenantId, teamId: otherTeamId, userId: otherAgent!.id });

  // Agente da prefeitura sem equipe.
  const [stranger] = await owner.db
    .insert(users)
    .values({ name: 'Sem equipe', phone: '+5511980001005' })
    .returning();
  outsiderId = stranger!.id;
  await owner.db.insert(memberships).values({ tenantId, userId: outsiderId, role: 'field_agent' });

  // Outra prefeitura, com o próprio agente.
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município Agente',
      displayName: 'Prefeitura Agente',
      city: 'Agente',
      state: 'SP',
      ibgeCode: '0000098',
      status: 'active',
    })
    .returning();
  otherTenantId = tenant!.id;
  const [foreignAgent] = await owner.db
    .insert(users)
    .values({ name: 'Agente de fora', phone: '+5511980001006' })
    .returning();
  otherTenantAgentId = foreignAgent!.id;
  await owner.db
    .insert(memberships)
    .values({ tenantId: otherTenantId, userId: otherTenantAgentId, role: 'field_agent' });

  app = await buildApp({ storage, database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app?.close();
  await appDb.pool.end();
  await owner.pool.end();
});

describe('GET /agent/work-orders', () => {
  it("list shows only my teams' work orders", async () => {
    const mine = await newWorkOrder();
    const theirs = await newWorkOrder({ team: otherTeamId });
    const cards = await list();
    const ids = cards.map((card) => card.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(cards.every((card) => card.tenantId === tenantId)).toBe(true);
  });

  it('list hides completed and cancelled work orders', async () => {
    const visible: Record<string, string> = {};
    for (const status of [
      'assigned',
      'in_execution',
      'rework_requested',
      'awaiting_review',
      'impeded',
    ] as const) {
      visible[status] = (await newWorkOrder({ status })).id;
    }
    const completed = await newWorkOrder({ status: 'completed' });
    const cancelled = await newWorkOrder({ status: 'cancelled' });
    const cards = await list();
    for (const [status, id] of Object.entries(visible)) {
      expect(cards.find((card) => card.id === id)?.status).toBe(status);
    }
    const ids = cards.map((card) => card.id);
    expect(ids).not.toContain(completed.id);
    expect(ids).not.toContain(cancelled.id);
  });

  it('list card has category icon, report count and assignedAt', async () => {
    const dueAt = new Date(Date.now() + 2 * 24 * HOUR_MS);
    const order = await newWorkOrder({
      status: 'in_execution',
      dueAt,
      address: 'Rua do Primeiro Relato, 1',
      reports: [
        { description: 'Primeiro relato' },
        { description: 'Segundo relato' },
        { description: 'Relato cancelado', status: 'cancelled' },
      ],
    });
    const earlierAssign = new Date(Date.now() - 50 * 60_000);
    const laterAssign = new Date(Date.now() - 40 * 60_000);
    const started = new Date(Date.now() - 30 * 60_000);
    await addEvent(order, { toStatus: 'assigned', actorUserId: managerId, at: earlierAssign });
    // Reagendada: a atribuição mais recente é a que vale.
    await addEvent(order, { toStatus: 'assigned', actorUserId: managerId, at: laterAssign });
    await addEvent(order, {
      fromStatus: 'assigned',
      toStatus: 'in_execution',
      actorUserId: agentId,
      at: started,
    });

    const card = (await list()).find((item) => item.id === order.id);
    expect(card).toEqual({
      id: order.id,
      tenantId,
      status: 'in_execution',
      protocol: order.created[0]!.protocol,
      categoryName: 'Buraco na via',
      categoryIcon: 'construction',
      categoryGroup: 'infrastructure',
      address: 'Rua do Primeiro Relato, 1',
      location: { lat: -23.551, lng: -46.634 },
      teamName: 'Equipe Obras – Centro',
      reportCount: 2,
      dueAt: dueAt.toISOString(),
      assignedAt: laterAssign.toISOString(),
      statusChangedAt: started.toISOString(),
    });
  });

  it('list card falls back to created_at without events', async () => {
    const order = await newWorkOrder();
    const card = (await list()).find((item) => item.id === order.id);
    expect(card).toMatchObject({
      assignedAt: order.createdAt.toISOString(),
      statusChangedAt: order.createdAt.toISOString(),
      dueAt: null,
      reportCount: 1,
    });
  });

  it('takes protocol and address from the earliest request of the occurrence', async () => {
    const order = await newWorkOrder({
      reports: [
        { description: 'Relato posterior', minutesAfter: 30 },
        { description: 'Relato mais antigo', minutesAfter: 0 },
      ],
    });
    const matches = (await list()).filter((item) => item.id === order.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      protocol: order.created[1]!.protocol,
      address: 'Outro endereço 1',
      reportCount: 2,
    });
  });

  it('lists nothing for an agent without teams', async () => {
    expect(await list({ tenantId, userId: outsiderId })).toEqual([]);
  });

  it('agent of another tenant gets 403 not_a_member', async () => {
    const as = { tenantId, userId: otherTenantAgentId };
    const order = await newWorkOrder();
    for (const res of [
      await get('/agent/work-orders', as),
      await get(`/agent/work-orders/${order.id}`, as),
      await app.inject({ method: 'POST', url: '/agent/uploads', headers: await headers(as) }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'not_a_member' });
    }
  });

  it('missing token is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/agent/work-orders' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });

  it('missing tenant header is 400 tenant_required', async () => {
    const { authorization } = await headers();
    const res = await app.inject({
      method: 'GET',
      url: '/agent/work-orders',
      headers: { authorization: authorization! },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('answers 503 database_not_configured without a database', async () => {
    const bare = await buildApp({ storage, auth: testAuthOptions });
    const res = await bare.inject({
      method: 'GET',
      url: '/agent/work-orders',
      headers: await headers(),
    });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'database_not_configured' });
  });
});

describe('GET /agent/work-orders/:id', () => {
  it("detail of another team's work order is 404", async () => {
    const theirs = await newWorkOrder({ team: otherTeamId });
    for (const id of [theirs.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await get(`/agent/work-orders/${id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'work_order_not_found' });
    }
  });

  it('detail of a completed or cancelled work order is 404', async () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const order = await newWorkOrder({ status });
      const res = await get(`/agent/work-orders/${order.id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'work_order_not_found' });
    }
  });

  it('detail exposes reports and photos without citizen identity', async () => {
    const order = await newWorkOrder({
      status: 'in_execution',
      reports: [
        { description: 'Buraco enorme na frente da escola', citizen: 0, minutesAfter: 0 },
        { description: '', citizen: 1, minutesAfter: 10 },
        { description: 'Desisti do relato', citizen: 2, minutesAfter: 20, status: 'cancelled' },
      ],
    });
    const [first, second, cancelled] = order.created;
    // Chaves como o app do cidadão as recebe de /citizen/uploads.
    const reportKey = newRequestPhotoKey(TEST_AUTH_SECRET, citizenIds[0]!);
    const contestKey = newRequestPhotoKey(TEST_AUTH_SECRET, citizenIds[1]!);
    const cancelledKey = newRequestPhotoKey(TEST_AUTH_SECRET, citizenIds[2]!);
    const completionKey = newPhotoKey(tenantId);
    const base = Date.now() - 30 * 60_000;
    await owner.db.insert(photos).values([
      {
        tenantId,
        requestId: first!.id,
        storageKey: reportKey,
        uploadedBy: citizenIds[0]!,
        purpose: 'report',
        createdAt: new Date(base),
      },
      {
        tenantId,
        requestId: second!.id,
        storageKey: contestKey,
        uploadedBy: citizenIds[1]!,
        purpose: 'contest',
        createdAt: new Date(base + 60_000),
      },
      {
        tenantId,
        requestId: cancelled!.id,
        storageKey: cancelledKey,
        uploadedBy: citizenIds[2]!,
        purpose: 'report',
      },
      {
        tenantId,
        workOrderId: order.id,
        storageKey: completionKey,
        uploadedBy: agentId,
        purpose: 'completion',
        review: 'pending',
      },
    ]);

    const { parsed, raw } = await detail(order.id);
    expect(parsed.reports.map((report) => report.description)).toEqual([
      'Buraco enorme na frente da escola',
      '',
    ]);
    expect(parsed.reportCount).toBe(2);
    expect(parsed.citizenCount).toBe(2);
    expect(parsed.photos).toHaveLength(2);
    expect(parsed.photos[0]!.url).toContain(reportKey);
    expect(parsed.photos[0]!.takenAt).toBe(new Date(base).toISOString());
    expect(parsed.photos[1]!.url).toContain(contestKey);
    const body = JSON.stringify(raw);
    expect(body).not.toContain(cancelledKey);
    expect(body).not.toContain(completionKey);

    // Sem atribuição registrada, nenhum objeto da resposta tem nome, telefone ou e-mail.
    const keys = allKeys(raw);
    for (const forbidden of ['name', 'phone', 'email', 'citizenId']) {
      expect(keys).not.toContain(forbidden);
    }
    for (const citizen of CITIZENS) {
      expect(body).not.toContain(citizen.name);
      expect(body).not.toContain(citizen.phone);
      expect(body).not.toContain(citizen.email);
    }
    // Nem o id do cidadão, nem mesmo dentro das URLs assinadas das fotos.
    for (const citizenId of citizenIds) expect(body).not.toContain(citizenId);
  });

  it('detail shows rework with reasons, message and author', async () => {
    const order = await newWorkOrder({
      status: 'rework_requested',
      managerInstructions: 'Levar massa asfáltica',
      agentNote: 'Buraco tapado e compactado.',
    });
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await addEvent(order, { toStatus: 'assigned', actorUserId: managerId, at: at(55) });
    await addEvent(order, {
      fromStatus: 'awaiting_review',
      toStatus: 'rework_requested',
      actorUserId: managerId,
      comment: 'Mensagem antiga',
      details: { reasons: ['new_note'], discardedPhotoIds: [] },
      at: at(40),
    });
    const lastAt = at(10);
    await addEvent(order, {
      fromStatus: 'awaiting_review',
      toStatus: 'rework_requested',
      actorUserId: managerId,
      comment: 'As fotos ficaram escuras. Volte ao local e tire novas.',
      details: { reasons: ['new_photos', 'return_to_site'], discardedPhotoIds: [] },
      at: lastAt,
    });

    const { parsed } = await detail(order.id);
    expect(parsed.rework).toEqual({
      reasons: ['new_photos', 'return_to_site'],
      message: 'As fotos ficaram escuras. Volte ao local e tire novas.',
      byName: 'Carlos Demo',
      departmentName: 'Obras',
      at: lastAt.toISOString(),
    });
    expect(parsed.previousNote).toBe('Buraco tapado e compactado.');
    expect(parsed.managerInstructions).toBe('Levar massa asfáltica');
    expect(parsed.assignedBy).toEqual({ name: 'Carlos Demo', departmentName: 'Obras' });
    expect(parsed.statusChangedAt).toBe(lastAt.toISOString());
  });

  it('detail has no rework outside rework_requested', async () => {
    const order = await newWorkOrder({ status: 'in_execution' });
    await addEvent(order, {
      toStatus: 'rework_requested',
      actorUserId: managerId,
      comment: 'Antigo',
      details: { reasons: ['new_note'], discardedPhotoIds: [] },
      at: new Date(Date.now() - 20 * 60_000),
    });
    const { parsed } = await detail(order.id);
    expect(parsed.rework).toBeNull();
  });

  it('detail without instructions has null assignedBy when nobody assigned', async () => {
    const order = await newWorkOrder();
    const { parsed } = await detail(order.id);
    expect(parsed.managerInstructions).toBeNull();
    expect(parsed.assignedBy).toBeNull();
    expect(parsed.rework).toBeNull();
    expect(parsed.previousNote).toBeNull();

    // Atribuição sem autor (o sistema) também não tem quem mostrar.
    await addEvent(order, { toStatus: 'assigned', at: new Date(Date.now() - 5 * 60_000) });
    expect((await detail(order.id)).parsed.assignedBy).toBeNull();
  });
});

describe('POST /agent/uploads', () => {
  it('upload returns a key under the tenant prefix', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agent/uploads',
      headers: await headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.key.startsWith(`${tenantId}/uploads/`)).toBe(true);
    expect(body.url).toContain(body.key);
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('responds 401 without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/uploads' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });

  it('responds 400 without the tenant header', async () => {
    const { authorization } = await headers();
    const res = await app.inject({
      method: 'POST',
      url: '/agent/uploads',
      headers: { authorization: authorization! },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('responds 403 for a tenant without membership', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agent/uploads',
      headers: { ...(await headers()), 'x-tenant-id': '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_a_member' });
  });

  it('responds 503 when storage is not configured', async () => {
    const bare = await buildApp({ database: appDb.db, auth: testAuthOptions });
    const res = await bare.inject({
      method: 'POST',
      url: '/agent/uploads',
      headers: await headers(),
    });
    await bare.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'storage_not_configured' });
  });

  it('does not register /agent routes without auth', async () => {
    const bare = await buildApp({ storage, database: appDb.db });
    const res = await bare.inject({
      method: 'POST',
      url: '/agent/uploads',
      headers: await headers(),
    });
    await bare.close();
    expect(res.statusCode).toBe(404);
  });
});
