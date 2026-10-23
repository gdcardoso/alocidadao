import { randomInt } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import type { TENANT_ROLES } from '@alocidadao/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { appAuthHeader, TEST_AUTH_SECRET } from '../test/session.js';
import { requireAuth, registerAuth } from './plugin.js';
import { requireTenantMember } from './tenant-context.js';

const { users, tenants, memberships } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let app: FastifyInstance;

const newPhone = () => `+5531${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;

async function createUser() {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Agente de teste', phone: newPhone() })
    .returning();
  return user!.id;
}

async function createTenant(status: (typeof tenants.$inferInsert)['status'] = 'active') {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município Vínculo',
      displayName: 'Vínculo',
      city: 'Vínculo',
      state: 'MG',
      ibgeCode: String(randomInt(1_000_000, 9_999_999)),
      status,
    })
    .returning();
  return tenant!.id;
}

async function link(
  tenantId: string,
  userId: string,
  role: (typeof TENANT_ROLES)[number] = 'field_agent',
) {
  await owner.db.insert(memberships).values({ tenantId, userId, role, status: 'active' });
}

const call = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/probe', headers });

beforeAll(async () => {
  app = Fastify();
  registerAuth(app, TEST_AUTH_SECRET);
  app.get('/probe', { preHandler: requireAuth(['app']) }, async (request, reply) => {
    const member = await requireTenantMember(appDb.db, request, reply, ['field_agent']);
    if (!member) return reply;
    return member;
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

describe('requireTenantMember', () => {
  it('active agent passes', async () => {
    const userId = await createUser();
    const tenantId = await createTenant();
    await link(tenantId, userId);
    const res = await call({
      ...(await appAuthHeader(appDb.db, userId)),
      'x-tenant-id': tenantId,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId, tenantId });
  });

  it('missing header is 400', async () => {
    const userId = await createUser();
    const res = await call(await appAuthHeader(appDb.db, userId));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('header that is not a uuid is 400', async () => {
    const userId = await createUser();
    const res = await call({ ...(await appAuthHeader(appDb.db, userId)), 'x-tenant-id': 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'tenant_required' });
  });

  it('missing token is 401', async () => {
    const res = await call({ 'x-tenant-id': await createTenant() });
    expect(res.statusCode).toBe(401);
  });

  it('agent of another tenant is 403', async () => {
    const userId = await createUser();
    const own = await createTenant();
    const other = await createTenant();
    await link(own, userId);
    const res = await call({ ...(await appAuthHeader(appDb.db, userId)), 'x-tenant-id': other });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_a_member' });
  });

  it('member with a role outside the allowed ones is 403', async () => {
    const userId = await createUser();
    const tenantId = await createTenant();
    await link(tenantId, userId, 'citizen');
    const res = await call({
      ...(await appAuthHeader(appDb.db, userId)),
      'x-tenant-id': tenantId,
    });
    expect(res.statusCode).toBe(403);
  });

  it('inactive membership is refused on the next call', async () => {
    const userId = await createUser();
    const tenantId = await createTenant();
    await link(tenantId, userId);
    const headers = { ...(await appAuthHeader(appDb.db, userId)), 'x-tenant-id': tenantId };
    expect((await call(headers)).statusCode).toBe(200);

    await owner.db
      .update(memberships)
      .set({ status: 'inactive' })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    const res = await call(headers);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'not_a_member' });
  });

  it('suspended tenant is 403', async () => {
    const userId = await createUser();
    const tenantId = await createTenant('suspended');
    await link(tenantId, userId);
    const res = await call({
      ...(await appAuthHeader(appDb.db, userId)),
      'x-tenant-id': tenantId,
    });
    expect(res.statusCode).toBe(403);
  });
});
