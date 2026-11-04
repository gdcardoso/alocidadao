import { createDatabase, schema } from '@alocidadao/db';
import { DEFAULT_SITE_CONTACT } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { siteContact, staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const PANEL_ORIGIN = 'https://portal.alocidadao.com.br';
const SITE_ORIGIN = 'https://alocidadao.com.br';

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions, corsOrigin: PANEL_ORIGIN });
});

afterEach(async () => {
  await owner.db
    .update(siteContact)
    .set({ ...DEFAULT_SITE_CONTACT, updatedBy: null })
    .where(eq(siteContact.id, 1));
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

const newContact = {
  whatsapp: '+5562999990000',
  email: 'contato@alocidadao.com.br',
  responseNote: 'Resposta em até 1 dia útil',
};

describe('site contact', () => {
  it('public route answers without login and with CORS open to any origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/public/site-contact',
      headers: { origin: SITE_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DEFAULT_SITE_CONTACT);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('public route is cacheable for 60 seconds', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/site-contact' });
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('public route is rate limited per IP with the standard 429 body', async () => {
    const limited = await buildApp({
      database: appDb.db,
      auth: testAuthOptions,
      corsOrigin: PANEL_ORIGIN,
      siteContactRateLimit: { max: 2, timeWindowMs: 60_000 },
    });
    try {
      const get = () =>
        limited.inject({
          method: 'GET',
          url: '/public/site-contact',
          headers: { origin: SITE_ORIGIN },
        });
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
      const blocked = await get();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({
        code: 'rate_limited',
        retryAfterSeconds: expect.any(Number),
      });
      expect(blocked.headers['access-control-allow-origin']).toBe('*');
      const health = await limited.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: SITE_ORIGIN },
      });
      expect(health.statusCode).toBe(200);
      expect(health.headers['access-control-allow-origin']).toBe(PANEL_ORIGIN);
    } finally {
      await limited.close();
    }
  });

  it('other routes keep the restricted CORS origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: SITE_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-origin']).toBe(PANEL_ORIGIN);
  });

  it('admin reads and updates the contact, with an audit event without tenant', async () => {
    const adminId = await fx.newStaff('admin');
    const headers = await staffAuthHeader(appDb.db, adminId);

    const read = await app.inject({ method: 'GET', url: '/backoffice/site-contact', headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(DEFAULT_SITE_CONTACT);

    const updated = await app.inject({
      method: 'PUT',
      url: '/backoffice/site-contact',
      headers,
      payload: { ...newContact, email: 'Contato@AloCidadao.com.br' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual(newContact);

    const [row] = await owner.db.select().from(siteContact);
    expect(row).toMatchObject({ ...newContact, updatedBy: adminId });

    const events = await owner.db
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.staffUserId, adminId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'site.contact_update', tenantId: null });

    const publicRead = await app.inject({ method: 'GET', url: '/public/site-contact' });
    expect(publicRead.json()).toEqual(newContact);
  });

  it('support gets 403 admin_only and nothing changes', async () => {
    const supportId = await fx.newStaff('support');
    const headers = await staffAuthHeader(appDb.db, supportId);

    const read = await app.inject({ method: 'GET', url: '/backoffice/site-contact', headers });
    expect(read.statusCode).toBe(403);
    expect(read.json()).toEqual({ code: 'admin_only' });

    const updated = await app.inject({
      method: 'PUT',
      url: '/backoffice/site-contact',
      headers,
      payload: newContact,
    });
    expect(updated.statusCode).toBe(403);
    expect(updated.json()).toEqual({ code: 'admin_only' });

    const [row] = await owner.db.select().from(siteContact);
    expect(row).toMatchObject(DEFAULT_SITE_CONTACT);
    const events = await owner.db
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.staffUserId, supportId));
    expect(events).toHaveLength(0);
  });

  it('rejects an invalid body with 400', async () => {
    const adminId = await fx.newStaff('admin');
    const headers = await staffAuthHeader(appDb.db, adminId);
    for (const payload of [
      { ...newContact, whatsapp: '+556232221234' },
      { ...newContact, email: 'not-an-email' },
      { ...newContact, responseNote: '' },
      { ...newContact, responseNote: 'a'.repeat(61) },
      { whatsapp: newContact.whatsapp },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/backoffice/site-contact',
        headers,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const [row] = await owner.db.select().from(siteContact);
    expect(row).toMatchObject(DEFAULT_SITE_CONTACT);
  });

  it('backoffice routes require a session', async () => {
    const read = await app.inject({ method: 'GET', url: '/backoffice/site-contact' });
    expect(read.statusCode).toBe(401);
    const updated = await app.inject({
      method: 'PUT',
      url: '/backoffice/site-contact',
      payload: newContact,
    });
    expect(updated.statusCode).toBe(401);
  });
});
