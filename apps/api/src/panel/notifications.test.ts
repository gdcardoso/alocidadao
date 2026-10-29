import { createDatabase, schema, withContext } from '@alocidadao/db';
import type { GeoPoint, PanelNotificationsResponse } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { panelNotifications } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

const CENTER: GeoPoint = { lat: -23.1, lng: -47.1 };

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

/** Prefeitura com uma ocorrência, o gestor que lê o sino e outro gestor. */
async function seed() {
  const base = await fx.seedPanelTenant();
  const occurrenceId = await fx.addOccurrence(base.tenantId, {
    categoryId: base.potholeId,
    at: CENTER,
  });
  const managerId = await fx.newManager(base.tenantId, [base.worksId], 'Gestor Um');
  const otherId = await fx.newManager(base.tenantId, [base.worksId], 'Gestor Dois');
  return { ...base, occurrenceId, managerId, otherId };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function addNotification(
  s: Seed,
  userId: string,
  input: {
    kind?: string;
    protocol?: string;
    details?: unknown;
    createdAt?: Date;
    readAt?: Date | null;
  } = {},
) {
  const [row] = await withContext(owner.db, { tenantId: s.tenantId }, (tx) =>
    tx
      .insert(panelNotifications)
      .values({
        tenantId: s.tenantId,
        userId,
        kind: input.kind ?? 'occurrence_new',
        protocol: input.protocol ?? '2026-000001',
        occurrenceId: s.occurrenceId,
        details: input.details,
        createdAt: input.createdAt,
        readAt: input.readAt,
      })
      .returning(),
  );
  return row!.id;
}

async function call(method: 'GET' | 'POST', url: string, userId: string, tenantId: string) {
  return app.inject({ method, url, headers: await panelAuthHeader(appDb.db, userId, tenantId) });
}

const readAt = async (id: string) =>
  (await owner.db.select().from(panelNotifications).where(eq(panelNotifications.id, id)))[0]!
    .readAt;

describe('panel notifications', () => {
  it('lists the 30 latest with text and unread count', async () => {
    const s = await seed();
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 32; i++) {
      await addNotification(s, s.managerId, {
        protocol: `2026-${String(i).padStart(6, '0')}`,
        createdAt: new Date(base + i * 1000),
        readAt: i === 31 ? new Date() : null,
      });
    }
    const completed = await addNotification(s, s.managerId, {
      kind: 'work_order_completed',
      protocol: '2026-000099',
      details: { withPhotos: true },
      createdAt: new Date(base + 40_000),
    });
    await addNotification(s, s.otherId);

    const res = await call('GET', '/panel/notifications', s.managerId, s.tenantId);
    expect(res.statusCode).toBe(200);
    const body = res.json<PanelNotificationsResponse>();
    expect(body.items).toHaveLength(30);
    expect(body.unreadCount).toBe(32);
    expect(body.items[0]).toMatchObject({
      id: completed,
      kind: 'work_order_completed',
      text: 'Solicitação 2026-000099: concluída com fotos',
      occurrenceId: s.occurrenceId,
      workOrderId: null,
      readAt: null,
    });
    expect(body.items[1]).toMatchObject({
      protocol: '2026-000031',
      text: 'Solicitação 2026-000031: nova, aguardando análise',
    });
    expect(body.items[1]!.readAt).not.toBeNull();
  });

  it('marks one and all as read', async () => {
    const s = await seed();
    const first = await addNotification(s, s.managerId);
    const second = await addNotification(s, s.managerId);
    const third = await addNotification(s, s.managerId);
    const others = await addNotification(s, s.otherId);

    const one = await call('POST', `/panel/notifications/${first}/read`, s.managerId, s.tenantId);
    expect(one.statusCode).toBe(204);
    const stamp = await readAt(first);
    expect(stamp).not.toBeNull();
    expect(await readAt(second)).toBeNull();
    // Repetir não muda a hora nem recusa.
    const again = await call('POST', `/panel/notifications/${first}/read`, s.managerId, s.tenantId);
    expect(again.statusCode).toBe(204);
    expect(await readAt(first)).toEqual(stamp);

    const all = await call('POST', '/panel/notifications/read-all', s.managerId, s.tenantId);
    expect(all.statusCode).toBe(204);
    expect(await readAt(second)).not.toBeNull();
    expect(await readAt(third)).not.toBeNull();
    expect(await readAt(first)).toEqual(stamp);
    expect(await readAt(others)).toBeNull();

    const list = await call('GET', '/panel/notifications', s.managerId, s.tenantId);
    expect(list.json<PanelNotificationsResponse>().unreadCount).toBe(0);
  });

  it('another manager cannot mark my notification', async () => {
    const s = await seed();
    const mine = await addNotification(s, s.managerId);
    const res = await call('POST', `/panel/notifications/${mine}/read`, s.otherId, s.tenantId);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'notification_not_found' });
    expect(await readAt(mine)).toBeNull();
  });

  it('support mode gets an empty list and no-op reads', async () => {
    const s = await seed();
    const mine = await addNotification(s, s.managerId);
    const staffId = await fx.newStaff('support');

    const list = await call('GET', '/panel/notifications', staffId, s.tenantId);
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [], unreadCount: 0 });
    const one = await call('POST', `/panel/notifications/${mine}/read`, staffId, s.tenantId);
    expect(one.statusCode).toBe(204);
    const all = await call('POST', '/panel/notifications/read-all', staffId, s.tenantId);
    expect(all.statusCode).toBe(204);
    expect(await readAt(mine)).toBeNull();
  });

  it('app (agent) token is refused', async () => {
    const s = await seed();
    const headers = await appAuthHeader(appDb.db, s.managerId);
    const res = await app.inject({
      method: 'GET',
      url: '/panel/notifications',
      headers: { ...headers, 'x-tenant-id': s.tenantId },
    });
    // Como nas outras rotas do painel: token do app não vale (401), nunca lê o sino.
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });
});
