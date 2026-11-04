import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { TERMS_VERSION, type MeResponse } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { panelAuthHeader } from '../test/panel.js';
import { appAuthHeader, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { users, tenants, memberships } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);

let gated: Awaited<ReturnType<typeof buildApp>>;
let open: Awaited<ReturnType<typeof buildApp>>;

const newPhone = () => `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/** Gestor com vínculo ativo numa prefeitura nova; sem aceite, a menos que `termsVersion` venha. */
async function newManager(termsVersion: string | null = null) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município dos Termos',
      displayName: 'Prefeitura dos Termos',
      city: 'Termos',
      state: 'PR',
      ibgeCode: String(randomInt(1_000_000, 9_999_999)),
      status: 'active',
    })
    .returning();
  const [user] = await owner.db
    .insert(users)
    .values({
      name: 'Gestor dos Termos',
      phone: newPhone(),
      termsVersion,
      termsAcceptedAt: termsVersion ? new Date() : null,
    })
    .returning();
  await owner.db
    .insert(memberships)
    .values({ tenantId: tenant!.id, userId: user!.id, role: 'manager', status: 'active' });
  return { userId: user!.id, tenantId: tenant!.id };
}

beforeAll(async () => {
  gated = await buildApp({ database: appDb.db, auth: { ...testAuthOptions, termsGate: true } });
  open = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await gated.close();
  await open.close();
  await owner.pool.end();
  await appDb.pool.end();
});

describe('terms gate', () => {
  it('blocks an account without terms until it accepts them', async () => {
    const { userId, tenantId } = await newManager();
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);

    const blocked = await gated.inject({ method: 'GET', url: '/panel/context', headers });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ code: 'terms_required' });

    const before = await gated.inject({ method: 'GET', url: '/me', headers });
    expect(before.statusCode).toBe(200);
    expect(before.json<MeResponse>().termsAccepted).toBe(false);

    const accepted = await gated.inject({
      method: 'POST',
      url: '/me/terms',
      headers,
      payload: { acceptedTermsVersion: TERMS_VERSION },
    });
    expect(accepted.statusCode).toBe(204);

    const [row] = await owner.db
      .select({ termsVersion: users.termsVersion, termsAcceptedAt: users.termsAcceptedAt })
      .from(users)
      .where(eq(users.id, userId));
    expect(row!.termsVersion).toBe(TERMS_VERSION);
    expect(row!.termsAcceptedAt).toBeInstanceOf(Date);

    const allowed = await gated.inject({ method: 'GET', url: '/panel/context', headers });
    expect(allowed.statusCode).toBe(200);
    const after = await gated.inject({ method: 'GET', url: '/me', headers });
    expect(after.json<MeResponse>().termsAccepted).toBe(true);
  });

  it('lets an account without terms log out and register its device', async () => {
    const { userId } = await newManager();

    const appHeaders = await appAuthHeader(appDb.db, userId);
    const device = await gated.inject({
      method: 'PUT',
      url: `/me/devices/${randomUUID()}`,
      headers: appHeaders,
      payload: { platform: 'android', appVersion: '1.0.0' },
    });
    expect(device.statusCode).toBe(204);

    const panelHeaders = await panelAuthHeader(appDb.db, userId);
    const logout = await gated.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: panelHeaders,
    });
    expect(logout.statusCode).toBe(204);
  });

  it('lets an account without terms delete itself', async () => {
    const { userId } = await newManager();
    const headers = await appAuthHeader(appDb.db, userId);
    const res = await gated.inject({ method: 'DELETE', url: '/me', headers });
    expect(res.statusCode).toBe(204);
    const [row] = await owner.db
      .select({ accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, userId));
    expect(row!.accountStatus).toBe('frozen');
  });

  it('refuses an old terms version on accept', async () => {
    const { userId } = await newManager();
    const headers = await panelAuthHeader(appDb.db, userId);
    const res = await gated.inject({
      method: 'POST',
      url: '/me/terms',
      headers,
      payload: { acceptedTermsVersion: '2026-10-23' },
    });
    expect(res.statusCode).toBe(400);
    const [row] = await owner.db
      .select({ termsVersion: users.termsVersion })
      .from(users)
      .where(eq(users.id, userId));
    expect(row!.termsVersion).toBeNull();
  });

  it('does not block an account that accepted an older version', async () => {
    const { userId, tenantId } = await newManager('2026-10-23');
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);
    const res = await gated.inject({ method: 'GET', url: '/panel/context', headers });
    expect(res.statusCode).toBe(200);
  });

  it('keeps the answer of a frozen account without terms', async () => {
    const { userId, tenantId } = await newManager();
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, userId));

    for (const url of ['/panel/context', '/me'] as const) {
      const withGate = await gated.inject({ method: 'GET', url, headers });
      const withoutGate = await open.inject({ method: 'GET', url, headers });
      expect(withGate.json()).not.toEqual({ code: 'terms_required' });
      expect(withGate.statusCode).toBe(withoutGate.statusCode);
      expect(withGate.json()).toEqual(withoutGate.json());
    }
  });

  it('blocks nothing when the gate is off', async () => {
    const { userId, tenantId } = await newManager();
    const headers = await panelAuthHeader(appDb.db, userId, tenantId);
    const res = await open.inject({ method: 'GET', url: '/panel/context', headers });
    expect(res.statusCode).toBe(200);
  });

  it('still answers 401 before the gate without a token', async () => {
    const res = await gated.inject({ method: 'GET', url: '/panel/context' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });
});
