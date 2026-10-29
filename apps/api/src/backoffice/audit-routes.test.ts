import { randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { auditResponseSchema } from '@alocidadao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

async function getAudit(userId: string, query: string) {
  return app.inject({
    method: 'GET',
    url: `/backoffice/audit?${query}`,
    headers: await staffAuthHeader(appDb.db, userId),
  });
}

describe('auditoria do backoffice', () => {
  it('audit paginates 50 per page and filters by tenant', async () => {
    const adminId = await fx.newStaff('admin', 'Admin Auditor');
    const tenantId = await fx.createTenant();
    const otherTenant = await fx.createTenant();
    const now = Date.now();
    await owner.db.insert(staffAuditEvents).values([
      ...Array.from({ length: 55 }, (_, i) => ({
        tenantId,
        staffUserId: adminId,
        action: 'support.enter',
        targetType: 'tenant',
        targetId: tenantId,
        createdAt: new Date(now - i * 1000),
      })),
      {
        tenantId: otherTenant,
        staffUserId: adminId,
        action: 'support.enter',
        targetType: 'tenant',
        targetId: otherTenant,
      },
    ]);

    const page1 = await getAudit(adminId, `tenantId=${tenantId}`);
    expect(page1.statusCode).toBe(200);
    const first = auditResponseSchema.parse(page1.json());
    expect(first).toMatchObject({ total: 55, page: 1, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({
      staffName: 'Admin Auditor',
      tenantId,
      tenantName: 'Prefeitura do Painel',
      action: 'support.enter',
      targetType: 'tenant',
      targetLabel: 'Prefeitura do Painel',
    });

    const page2 = auditResponseSchema.parse(
      (await getAudit(adminId, `tenantId=${tenantId}&page=2`)).json(),
    );
    expect(page2).toMatchObject({ total: 55, page: 2, pageSize: 50 });
    expect(page2.items).toHaveLength(5);

    // Página além do fim: sem itens, mas com o total real.
    const beyond = auditResponseSchema.parse(
      (await getAudit(adminId, `tenantId=${tenantId}&page=9`)).json(),
    );
    expect(beyond).toMatchObject({ items: [], total: 55, page: 9 });

    const none = auditResponseSchema.parse(
      (await getAudit(adminId, `tenantId=${randomUUID()}`)).json(),
    );
    expect(none).toMatchObject({ items: [], total: 0, page: 1 });
  });
});
