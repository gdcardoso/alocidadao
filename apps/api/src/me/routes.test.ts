import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import {
  TERMS_VERSION,
  type ChallengeResponse,
  type MeResponse,
  type PhoneVerifyResponse,
  type SessionTokens,
} from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { EmailSender } from '../messaging/email.js';
import type { PhoneCodeSender } from '../messaging/phone-code.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { users, memberships, tenants, devices } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const fx = panelFixtures(owner.db);
const appDb = createDatabase(API_TEST_APP_URL);
const secret = 'segredo-de-teste-da-api-com-mais-de-32-caracteres';

const codesSent: { phone: string; code: string }[] = [];
const phoneCode: PhoneCodeSender = {
  send: async (phone, code) => {
    codesSent.push({ phone, code });
  },
};
const email: EmailSender = { send: async () => {} };

let app: Awaited<ReturnType<typeof buildApp>>;

const newPhone = () => `+55219${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function createUser(values: Partial<typeof users.$inferInsert> = {}) {
  const phone = values.phone ?? newPhone();
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Conta de perfil', ...values, phone })
    .returning();
  return { id: user!.id, phone };
}

async function createTenant(name: string, status: (typeof tenants.$inferInsert)['status']) {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: `Município ${name}`,
      displayName: name,
      city: name,
      state: 'BA',
      ibgeCode: String(randomInt(1_000_000, 9_999_999)),
      status,
    })
    .returning();
  return tenant!.id;
}

/** Entra pelo app (celular e código fixo) e devolve os tokens. */
async function signIn(phone: string, installationId = randomUUID()): Promise<SessionTokens> {
  const start = await app.inject({ method: 'POST', url: '/auth/phone/start', payload: { phone } });
  expect(start.statusCode).toBe(200);
  const { challengeId } = start.json<ChallengeResponse>();
  const verify = await app.inject({
    method: 'POST',
    url: '/auth/phone/verify',
    payload: {
      challengeId,
      code: '123456',
      device: { installationId, platform: 'android', appVersion: '1.0.0' },
    },
  });
  const body = verify.json<PhoneVerifyResponse>();
  if (body.status !== 'signed_in') throw new Error(`status ${body.status}`);
  return body.session;
}

const bearer = (session: SessionTokens) => ({ authorization: `Bearer ${session.accessToken}` });

async function getMe(session: SessionTokens) {
  return app.inject({ method: 'GET', url: '/me', headers: bearer(session) });
}

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: {
      secret,
      devFixedCode: '123456',
      phoneCode,
      email,
      rateLimit: { max: 1000, timeWindowMs: 60_000 },
    },
  });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

describe('me routes', () => {
  it('me lists agent and panel tenants', async () => {
    const user = await createUser({ name: 'Ana Vínculos', email: 'ana@exemplo.com' });
    const activeTenant = await createTenant('Prefeitura Ativa', 'active');
    const onboardingTenant = await createTenant('Prefeitura Nova', 'onboarding');
    const inactiveTenant = await createTenant('Prefeitura Antiga', 'active');
    const panelTenant = await createTenant('Prefeitura Gestão', 'active');
    await owner.db.insert(memberships).values([
      { tenantId: activeTenant, userId: user.id, role: 'field_agent', status: 'active' },
      { tenantId: onboardingTenant, userId: user.id, role: 'field_agent', status: 'active' },
      { tenantId: inactiveTenant, userId: user.id, role: 'field_agent', status: 'inactive' },
      { tenantId: inactiveTenant, userId: user.id, role: 'manager', status: 'inactive' },
      { tenantId: panelTenant, userId: user.id, role: 'tenant_admin', status: 'active' },
      { tenantId: activeTenant, userId: user.id, role: 'citizen', status: 'active' },
    ]);

    const session = await signIn(user.phone);
    const res = await getMe(session);
    expect(res.statusCode).toBe(200);
    expect(res.json<MeResponse>()).toEqual({
      id: user.id,
      name: 'Ana Vínculos',
      phone: user.phone,
      email: 'ana@exemplo.com',
      platformRole: null,
      termsAccepted: false,
      agentTenants: [{ tenantId: activeTenant, tenantName: 'Prefeitura Ativa' }],
      panelTenants: [
        {
          tenantId: panelTenant,
          tenantName: 'Prefeitura Gestão',
          role: 'tenant_admin',
          status: 'active',
        },
      ],
    });

    const anonymous = await app.inject({ method: 'GET', url: '/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: 'unauthorized' });
  });

  it('me hides suspended tenants from panelTenants', async () => {
    const user = await createUser({ name: 'Gestora Suspensa', email: 'suspensa@exemplo.com' });
    const onboarding = await createTenant('Prefeitura Implantando', 'onboarding');
    const suspended = await createTenant('Prefeitura Suspensa', 'suspended');
    await owner.db.insert(memberships).values([
      { tenantId: onboarding, userId: user.id, role: 'manager', status: 'active' },
      { tenantId: suspended, userId: user.id, role: 'tenant_admin', status: 'active' },
    ]);

    const res = await getMe(await signIn(user.phone));
    expect(res.statusCode).toBe(200);
    expect(res.json<MeResponse>().panelTenants).toEqual([
      {
        tenantId: onboarding,
        tenantName: 'Prefeitura Implantando',
        role: 'manager',
        status: 'onboarding',
      },
    ]);
  });

  it('PATCH me updates name and clears email', async () => {
    const user = await createUser({ email: 'antes@exemplo.com' });
    const session = await signIn(user.phone);

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(session),
      payload: { name: 'Nome Novo', email: 'Depois@Exemplo.com' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<MeResponse>()).toMatchObject({
      name: 'Nome Novo',
      email: 'depois@exemplo.com',
    });

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(session),
      payload: { email: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<MeResponse>()).toMatchObject({ name: 'Nome Novo', email: null });

    const empty = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(session),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    // E-mail de outra conta.
    await createUser({ email: 'ocupado@exemplo.com' });
    const taken = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(session),
      payload: { email: 'Ocupado@exemplo.com' },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ code: 'email_in_use' });
  });

  it('panel user cannot change e-mail via PATCH me', async () => {
    const manager = await createUser({ email: 'gestor.fixo@exemplo.com' });
    const tenantId = await createTenant('Prefeitura do Gestor', 'active');
    await owner.db
      .insert(memberships)
      .values({ tenantId, userId: manager.id, role: 'manager', status: 'active' });
    const staff = await createUser({ email: 'equipe.fixa@exemplo.com', platformRole: 'admin' });

    for (const user of [manager, staff]) {
      const session = await signIn(user.phone);
      for (const newEmail of ['novo.endereco@exemplo.com', null]) {
        const res = await app.inject({
          method: 'PATCH',
          url: '/me',
          headers: bearer(session),
          payload: { name: 'Nome Trocado', email: newEmail },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ code: 'email_managed_by_admin' });
      }
      // A requisição inteira é recusada: nem o nome muda.
      const [row] = await owner.db.select().from(users).where(eq(users.id, user.id));
      expect(row).toMatchObject({ name: 'Conta de perfil' });
      expect(row!.email).toMatch(/\.fixo@|\.fixa@/);

      // Só o nome continua permitido.
      const renamed = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: bearer(session),
        payload: { name: 'Nome Trocado' },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json<MeResponse>().name).toBe('Nome Trocado');
    }
  });

  it('device update upserts the device', async () => {
    const user = await createUser();
    const installationId = randomUUID();
    const session = await signIn(user.phone, installationId);

    const known = await app.inject({
      method: 'PUT',
      url: `/me/devices/${installationId}`,
      headers: bearer(session),
      payload: { platform: 'android', appVersion: '1.2.0', pushToken: 'push-token-1' },
    });
    expect(known.statusCode).toBe(204);

    const other = randomUUID();
    const created = await app.inject({
      method: 'PUT',
      url: `/me/devices/${other}`,
      headers: bearer(session),
      payload: { platform: 'ios', appVersion: '2.0.0' },
    });
    expect(created.statusCode).toBe(204);

    const saved = await owner.db.select().from(devices).where(eq(devices.userId, user.id));
    expect(saved).toHaveLength(2);
    expect(saved.find((d) => d.installationId === installationId)).toMatchObject({
      platform: 'android',
      appVersion: '1.2.0',
      pushToken: 'push-token-1',
    });
    expect(saved.find((d) => d.installationId === other)).toMatchObject({
      platform: 'ios',
      appVersion: '2.0.0',
      pushToken: null,
    });
  });

  it('registering a push token removes it from another account', async () => {
    const previous = await createUser();
    const previousDevice = randomUUID();
    const previousSession = await signIn(previous.phone, previousDevice);
    const token = `push-${randomUUID()}`;
    const first = await app.inject({
      method: 'PUT',
      url: `/me/devices/${previousDevice}`,
      headers: bearer(previousSession),
      payload: { platform: 'android', appVersion: '1.0.0', pushToken: token },
    });
    expect(first.statusCode).toBe(204);

    // Outra conta entra no mesmo celular (mesmo token de push).
    const next = await createUser();
    const nextDevice = randomUUID();
    const nextSession = await signIn(next.phone, nextDevice);
    const register = async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/me/devices/${nextDevice}`,
        headers: bearer(nextSession),
        payload: { platform: 'android', appVersion: '1.0.0', pushToken: token },
      });
      expect(res.statusCode).toBe(204);
    };
    await register();

    const holders = () =>
      owner.db
        .select({ userId: devices.userId, installationId: devices.installationId })
        .from(devices)
        .where(eq(devices.pushToken, token));
    expect(await holders()).toEqual([{ userId: next.id, installationId: nextDevice }]);

    // Registrar de novo o mesmo token mantém o aparelho atual com ele.
    await register();
    expect(await holders()).toEqual([{ userId: next.id, installationId: nextDevice }]);
  });

  it('phone change needs the code sent to the new number', async () => {
    const user = await createUser();
    const session = await signIn(user.phone);
    const next = newPhone();

    const start = await app.inject({
      method: 'POST',
      url: '/me/phone/start',
      headers: bearer(session),
      payload: { phone: next },
    });
    expect(start.statusCode).toBe(200);
    const { challengeId } = start.json<ChallengeResponse>();
    expect(codesSent).toContainEqual({ phone: next, code: '123456' });

    const wrong = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(session),
      payload: { challengeId, code: '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ code: 'code_invalid' });

    const right = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(session),
      payload: { challengeId, code: '123456' },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json<MeResponse>().phone).toBe(next);

    const me = await getMe(session);
    expect(me.json<MeResponse>().phone).toBe(next);
  });

  it('phone change accepts the app fixed code', async () => {
    const fixedApp = await buildApp({
      database: appDb.db,
      auth: { secret, appFixedCode: '246810', phoneCode, email },
    });
    try {
      const user = await createUser();
      const session = await signIn(user.phone);
      const next = newPhone();
      const start = await fixedApp.inject({
        method: 'POST',
        url: '/me/phone/start',
        headers: bearer(session),
        payload: { phone: next },
      });
      expect(start.statusCode).toBe(200);
      const right = await fixedApp.inject({
        method: 'POST',
        url: '/me/phone/verify',
        headers: bearer(session),
        payload: { challengeId: start.json<ChallengeResponse>().challengeId, code: '246810' },
      });
      expect(right.statusCode).toBe(200);
      expect(right.json<MeResponse>().phone).toBe(next);
    } finally {
      await fixedApp.close();
    }
  });

  it('phone change code only works for the account that asked for it', async () => {
    const asker = await createUser();
    const other = await createUser();
    const askerSession = await signIn(asker.phone);
    const otherSession = await signIn(other.phone);

    const start = await app.inject({
      method: 'POST',
      url: '/me/phone/start',
      headers: bearer(askerSession),
      payload: { phone: newPhone() },
    });
    const { challengeId } = start.json<ChallengeResponse>();
    const res = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(otherSession),
      payload: { challengeId, code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'code_invalid' });

    // O código de login do app também não serve para trocar o número.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/phone/start',
      payload: { phone: newPhone() },
    });
    const loginCode = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(askerSession),
      payload: { challengeId: login.json<ChallengeResponse>().challengeId, code: '123456' },
    });
    expect(loginCode.statusCode).toBe(400);
    expect(loginCode.json()).toEqual({ code: 'code_invalid' });
  });

  it('phone change start is limited per account', async () => {
    const user = await createUser();
    const other = await createUser();
    const session = await signIn(user.phone);
    const otherSession = await signIn(other.phone);
    const start = (s: SessionTokens) =>
      app.inject({
        method: 'POST',
        url: '/me/phone/start',
        headers: bearer(s),
        payload: { phone: newPhone() },
      });

    // Padrão: 5 por hora por conta, mesmo para números diferentes.
    for (let i = 0; i < 5; i++) expect((await start(session)).statusCode).toBe(200);
    const sixth = await start(session);
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json<{ code: string; retryAfterSeconds: number }>();
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);

    // O limite é da conta: outra conta no mesmo IP continua podendo pedir.
    expect((await start(otherSession)).statusCode).toBe(200);

    // Sem token, 401 antes de contar.
    const anonymous = await app.inject({
      method: 'POST',
      url: '/me/phone/start',
      payload: { phone: newPhone() },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('phone change start limit is configurable', async () => {
    const limited = await buildApp({
      database: appDb.db,
      auth: {
        secret,
        devFixedCode: '123456',
        phoneCode,
        email,
        rateLimit: { max: 1000, timeWindowMs: 60_000 },
        phoneChangeRateLimit: { max: 1, timeWindowMs: 60_000 },
      },
    });
    try {
      const user = await createUser();
      const session = await signIn(user.phone);
      const start = () =>
        limited.inject({
          method: 'POST',
          url: '/me/phone/start',
          headers: bearer(session),
          payload: { phone: newPhone() },
        });
      expect((await start()).statusCode).toBe(200);
      const second = await start();
      expect(second.statusCode).toBe(429);
      expect(second.json()).toMatchObject({ code: 'rate_limited' });
    } finally {
      await limited.close();
    }
  });

  it('phone change provider failure answers 503 phone_code_not_sent', async () => {
    const failing = await buildApp({
      database: appDb.db,
      auth: {
        secret,
        devFixedCode: '123456',
        phoneCode: {
          send: async () => {
            throw new Error('provedor fora do ar');
          },
        },
        email,
        rateLimit: { max: 1000, timeWindowMs: 60_000 },
      },
    });
    try {
      const user = await createUser();
      const session = await signIn(user.phone);
      const res = await failing.inject({
        method: 'POST',
        url: '/me/phone/start',
        headers: bearer(session),
        payload: { phone: newPhone() },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'phone_code_not_sent' });
    } finally {
      await failing.close();
    }
  });

  it('phone change to a number in use is 409', async () => {
    const user = await createUser();
    const taken = await createUser();
    const session = await signIn(user.phone);

    const start = await app.inject({
      method: 'POST',
      url: '/me/phone/start',
      headers: bearer(session),
      payload: { phone: taken.phone },
    });
    expect(start.statusCode).toBe(200);
    const res = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(session),
      payload: { challengeId: start.json<ChallengeResponse>().challengeId, code: '123456' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'phone_in_use' });
    expect((await getMe(session)).json<MeResponse>().phone).toBe(user.phone);
  });

  it('phone change takes a number from a stale account', async () => {
    const user = await createUser();
    const stale = await createUser();
    const session = await signIn(user.phone);
    const staleSession = await signIn(stale.phone);
    // Parada há mais de 90 dias, pelo relógio do banco.
    await owner.db
      .update(users)
      .set({
        lastActiveAt: sql`now() - interval '100 days'`,
        createdAt: sql`now() - interval '200 days'`,
      })
      .where(eq(users.id, stale.id));

    const start = await app.inject({
      method: 'POST',
      url: '/me/phone/start',
      headers: bearer(session),
      payload: { phone: stale.phone },
    });
    expect(start.statusCode).toBe(200);
    const res = await app.inject({
      method: 'POST',
      url: '/me/phone/verify',
      headers: bearer(session),
      payload: { challengeId: start.json<ChallengeResponse>().challengeId, code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<MeResponse>().phone).toBe(stale.phone);

    const [old] = await owner.db.select().from(users).where(eq(users.id, stale.id));
    expect(old).toMatchObject({ accountStatus: 'frozen', phone: stale.phone });
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: staleSession.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('refresh and me fail after account deletion', async () => {
    const user = await createUser({ email: 'excluir@exemplo.com' });
    const session = await signIn(user.phone);

    const deleted = await app.inject({ method: 'DELETE', url: '/me', headers: bearer(session) });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    const me = await getMe(session);
    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({ code: 'unauthorized' });

    const [row] = await owner.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ accountStatus: 'frozen', phone: null, email: null });
    expect(row!.deletedAt).not.toBeNull();
  });

  it('last admin cannot delete the account', async () => {
    // Todo admin ativo do banco de teste vira suporte, para sobrar só este.
    await owner.db
      .update(users)
      .set({ platformRole: 'support' })
      .where(eq(users.platformRole, 'admin'));
    const user = await createUser();
    await owner.db.update(users).set({ platformRole: 'admin' }).where(eq(users.id, user.id));
    const session = await signIn(user.phone);

    const refused = await app.inject({ method: 'DELETE', url: '/me', headers: bearer(session) });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ code: 'last_platform_admin' });
    const [row] = await owner.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ platformRole: 'admin', accountStatus: 'active' });

    // Com outro admin, a exclusão passa.
    await fx.newStaff('admin');
    const allowed = await app.inject({ method: 'DELETE', url: '/me', headers: bearer(session) });
    expect(allowed.statusCode).toBe(204);
  });

  it('frozen account is refused by me routes', async () => {
    const user = await createUser();
    const session = await signIn(user.phone);
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, user.id));

    const me = await getMe(session);
    expect(me.statusCode).toBe(401);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(session),
      payload: { name: 'Congelada' },
    });
    expect(patch.statusCode).toBe(401);
    const terms = await app.inject({
      method: 'POST',
      url: '/me/terms',
      headers: bearer(session),
      payload: { acceptedTermsVersion: TERMS_VERSION },
    });
    expect(terms.statusCode).toBe(401);
  });

  it('accepting the terms records the current version', async () => {
    const user = await createUser();
    const session = await signIn(user.phone);
    expect((await getMe(session)).json<MeResponse>().termsAccepted).toBe(false);

    const res = await app.inject({
      method: 'POST',
      url: '/me/terms',
      headers: bearer(session),
      payload: { acceptedTermsVersion: TERMS_VERSION },
    });
    expect(res.statusCode).toBe(204);
    const [row] = await owner.db
      .select({ termsVersion: users.termsVersion, termsAcceptedAt: users.termsAcceptedAt })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row!.termsVersion).toBe(TERMS_VERSION);
    expect(row!.termsAcceptedAt).toBeInstanceOf(Date);
    expect((await getMe(session)).json<MeResponse>().termsAccepted).toBe(true);

    const old = await app.inject({
      method: 'POST',
      url: '/me/terms',
      headers: bearer(session),
      payload: { acceptedTermsVersion: '2026-10-23' },
    });
    expect(old.statusCode).toBe(400);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/me/terms',
      payload: { acceptedTermsVersion: TERMS_VERSION },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
