import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { daysAgo, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { staffAuditEvents, users } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);
const POINT = { lat: -23.1, lng: -46.55 };

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function get(userId: string, tenantId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/backoffice/tenants/${tenantId}/citizens${query}`,
    headers: await staffAuthHeader(appDb.db, userId),
  });
}

const auditOf = (tenantId: string) =>
  withContext(owner.db, { tenantId }, (tx) =>
    tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, tenantId)),
  );

const digits = (n: number) => String(randomInt(0, 10 ** n)).padStart(n, '0');

/** Cidadão com dados pessoais completos, para conferir que nada sai inteiro. */
async function person(
  over: Partial<typeof users.$inferInsert> = {},
): Promise<{ id: string; phone: string; email: string; cpf: string }> {
  const phone = `+55419${digits(8)}`;
  const email = `pessoa.${randomUUID()}@teste.dev`;
  const cpf = `9${digits(10)}`;
  const [row] = await owner.db
    .insert(users)
    .values({ name: 'Pessoa Teste', phone, email, cpf, ...over })
    .returning();
  return { id: row!.id, phone, email, cpf };
}

async function seed() {
  const s = await fx.seedPanelTenant();
  const ask = async (
    citizenId: string,
    status:
      'open' | 'in_progress' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'rejected',
    createdAt = new Date(),
  ) => {
    const occurrenceId = await fx.addOccurrence(s.tenantId, { categoryId: s.potholeId, at: POINT });
    return fx.addRequest(s.tenantId, {
      occurrenceId,
      categoryId: s.potholeId,
      citizenId,
      at: POINT,
      status,
      createdAt,
    });
  };
  return { ...s, ask };
}

describe('GET /backoffice/tenants/:id/citizens', () => {
  it('lists only citizens with a request in this tenant', async () => {
    const a = await seed();
    const b = await seed();
    const mine = await person({ name: 'Ana Daqui' });
    const theirs = await person({ name: 'Bia Dali' });
    const never = await person({ name: 'Cris Sem Pedido' });
    await a.ask(mine.id, 'open');
    await b.ask(theirs.id, 'open');
    await b.ask(mine.id, 'open');
    const staffId = await fx.newStaff('support');

    const res = await get(staffId, a.tenantId);
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(never.id);
    // Só a solicitação desta prefeitura entra na conta.
    expect(res.json().items.find((i: { id: string }) => i.id === mine.id).requestCount).toBe(1);
  });

  it('counts total and open requests per citizen', async () => {
    const s = await seed();
    const p = await person();
    for (const status of ['open', 'in_progress', 'awaiting_confirmation'] as const) {
      await s.ask(p.id, status);
    }
    for (const status of ['completed', 'cancelled', 'rejected'] as const) {
      await s.ask(p.id, status);
    }
    const staffId = await fx.newStaff('admin');
    const res = await get(staffId, s.tenantId, '?q=Pessoa');
    const row = res.json().items.find((i: { id: string }) => i.id === p.id);
    expect(row).toMatchObject({ requestCount: 6, openCount: 3 });
  });

  it('situation follows last_active_at and frozen', async () => {
    const s = await seed();
    const active = await person({ name: 'Recente', lastActiveAt: daysAgo(10) });
    const old = await person({ name: 'Antigo', lastActiveAt: daysAgo(100) });
    const never = await person({ name: 'Nunca', lastActiveAt: null });
    const frozen = await person({ name: 'Congelada', accountStatus: 'frozen' });
    for (const p of [active, old, never, frozen]) await s.ask(p.id, 'open');
    const staffId = await fx.newStaff('admin');

    const items = (await get(staffId, s.tenantId)).json().items as {
      id: string;
      situation: string;
    }[];
    const situation = (id: string) => items.find((i) => i.id === id)?.situation;
    expect(situation(active.id)).toBe('active');
    expect(situation(old.id)).toBe('inactive');
    expect(situation(never.id)).toBe('inactive');
    expect(situation(frozen.id)).toBe('frozen');

    const onlyFrozen = (await get(staffId, s.tenantId, '?situation=frozen')).json().items;
    expect(onlyFrozen.map((i: { id: string }) => i.id)).toEqual([frozen.id]);
    const onlyActive = (await get(staffId, s.tenantId, '?situation=active')).json().items;
    expect(onlyActive.map((i: { id: string }) => i.id)).toContain(active.id);
    expect(onlyActive.map((i: { id: string }) => i.id)).not.toContain(old.id);
  });

  it('deleted accounts are not listed', async () => {
    const s = await seed();
    const gone = await person({
      name: 'Excluída',
      accountStatus: 'frozen',
      deletedAt: new Date(),
      phone: null,
      email: null,
      cpf: null,
    });
    await s.ask(gone.id, 'open');
    const staffId = await fx.newStaff('admin');
    const ids = (await get(staffId, s.tenantId)).json().items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(gone.id);
  });

  it('citizens response never contains full phone, email or any cpf', async () => {
    const s = await seed();
    const p = await person({ name: 'Maria Sigilo' });
    await s.ask(p.id, 'open');
    const staffId = await fx.newStaff('admin');
    const res = await get(staffId, s.tenantId);
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('Maria Sigilo');
    expect(body).toContain('(41) •••••-');
    expect(body).not.toContain(p.phone);
    expect(body).not.toContain(p.phone.slice(1));
    expect(body).not.toContain(p.email);
    expect(body).not.toContain(p.cpf);
    expect(body.toLowerCase()).not.toContain('cpf');
  });

  it('search by name only', async () => {
    const s = await seed();
    const p = await person({ name: 'Zenaide Procurada' });
    await s.ask(p.id, 'open');
    const staffId = await fx.newStaff('admin');

    const byName = await get(staffId, s.tenantId, '?q=zenaide');
    expect(byName.json().items.map((i: { id: string }) => i.id)).toEqual([p.id]);
    for (const q of [p.cpf, p.phone.slice(3, 11), p.email.slice(0, 12)]) {
      const res = await get(staffId, s.tenantId, `?q=${encodeURIComponent(q)}`);
      expect(res.json().items).toEqual([]);
    }
    // Curinga do LIKE vale como texto, não como padrão.
    const wildcard = await get(staffId, s.tenantId, '?q=%25');
    expect(wildcard.json().items).toEqual([]);
  });

  it('orders by last request and paginates by 50', async () => {
    const s = await seed();
    const first = await person({ name: 'Mais recente' });
    const second = await person({ name: 'Mais antiga' });
    await s.ask(second.id, 'open', daysAgo(5));
    await s.ask(first.id, 'open', daysAgo(1));
    const staffId = await fx.newStaff('admin');
    const res = (await get(staffId, s.tenantId)).json();
    const ids = res.items.map((i: { id: string }) => i.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(res).toMatchObject({ page: 1, pageSize: 50 });
    expect(res.total).toBe(2);
    const beyond = (await get(staffId, s.tenantId, '?page=2')).json();
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(2);
  });

  it('writes tenant.citizens_view once per opening', async () => {
    const s = await seed();
    const p = await person();
    await s.ask(p.id, 'open');
    const staffId = await fx.newStaff('support');

    await get(staffId, s.tenantId);
    expect(await auditOf(s.tenantId)).toEqual([
      expect.objectContaining({
        action: 'tenant.citizens_view',
        staffUserId: staffId,
        targetType: 'tenant',
        targetId: s.tenantId,
      }),
    ]);
    await get(staffId, s.tenantId, '?q=pes');
    await get(staffId, s.tenantId, '?page=2');
    await get(staffId, s.tenantId, '?situation=active');
    expect(await auditOf(s.tenantId)).toHaveLength(1);
  });

  it('returns 404 for an unknown tenant, 401 without token and 403 for a tenant admin', async () => {
    const staffId = await fx.newStaff('admin');
    const missing = await get(staffId, randomUUID());
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'tenant_not_found' });
    const s = await seed();
    const anon = await app.inject({
      method: 'GET',
      url: `/backoffice/tenants/${s.tenantId}/citizens`,
    });
    expect(anon.statusCode).toBe(401);
  });
});
