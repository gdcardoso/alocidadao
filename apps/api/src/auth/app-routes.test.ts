import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import {
  TERMS_VERSION,
  maskEmail,
  type ChallengeResponse,
  type DeviceInfo,
  type PhoneVerifyResponse,
  type SessionResponse,
} from '@alocidadao/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../app.js';
import type { EmailSender } from '../messaging/email.js';
import type { SmsSender } from '../messaging/sms.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { verifyAccessToken } from './tokens.js';

const { users, devices, memberships, tenants, sessions, verificationCodes } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const secret = 'segredo-de-teste-da-api-com-mais-de-32-caracteres';

const smsSent: { phone: string; text: string }[] = [];
const emailsSent: { to: string; subject: string; text: string }[] = [];
const sms: SmsSender = {
  send: async (phone, text) => {
    smsSent.push({ phone, text });
  },
};
const email: EmailSender = {
  send: async (msg) => {
    emailsSent.push(msg);
  },
};

async function build(rateLimit = { max: 1000, timeWindowMs: 60_000 }) {
  const options: AppOptions = {
    database: appDb.db,
    auth: { secret, devFixedCode: '123456', sms, email, rateLimit },
  };
  return buildApp(options);
}

let app: Awaited<ReturnType<typeof build>>;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Telefone exclusivo do teste, para não esbarrar no limite de envio de outro caso. */
const newPhone = () => `+55219${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

const newDevice = (): DeviceInfo => ({
  installationId: randomUUID(),
  platform: 'android',
  appVersion: '1.0.0',
});

async function createUser(values: Partial<typeof users.$inferInsert> & { phone: string }) {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Conta de teste', ...values })
    .returning();
  return user!.id;
}

async function startPhone(phone: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/phone/start', payload: { phone } });
  expect(res.statusCode).toBe(200);
  return res.json<ChallengeResponse>();
}

async function verifyPhone(challengeId: string, device: DeviceInfo, code = '123456') {
  return app.inject({
    method: 'POST',
    url: '/auth/phone/verify',
    payload: { challengeId, code, device },
  });
}

async function signInByPhone(phone: string, device: DeviceInfo) {
  const { challengeId } = await startPhone(phone);
  const res = await verifyPhone(challengeId, device);
  expect(res.statusCode).toBe(200);
  return res.json<PhoneVerifyResponse>();
}

async function signup(signupToken: string, name = 'Maria Nova', mail?: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { signupToken, name, email: mail, acceptedTermsVersion: TERMS_VERSION },
  });
}

async function userIdOf(accessToken: string) {
  return (await verifyAccessToken(secret, accessToken))!.userId;
}

async function accountStatusOf(userId: string) {
  const [user] = await owner.db
    .select({ status: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId));
  return user!.status;
}

beforeAll(async () => {
  app = await build();
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

describe('app auth routes', () => {
  it('phone start answers the same for known and unknown numbers', async () => {
    const known = newPhone();
    await createUser({ phone: known });
    const unknown = newPhone();

    const a = await startPhone(known);
    const b = await startPhone(unknown);
    expect(Object.keys(a).toSorted()).toEqual(Object.keys(b).toSorted());
    expect(a.expiresInSeconds).toBe(b.expiresInSeconds);
    expect(a.resendInSeconds).toBe(b.resendInSeconds);
    expect(a.challengeId).not.toBe(b.challengeId);

    // O SMS sai nos dois casos, com o texto combinado.
    expect(smsSent).toContainEqual({
      phone: known,
      text: 'Alô Cidadão: seu código é 123456. Não compartilhe com ninguém.',
    });
    expect(smsSent.some((m) => m.phone === unknown)).toBe(true);
  });

  it('phone start refuses a number outside E.164', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/start',
      payload: { phone: '11999998888' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('phone start refuses non-Brazilian numbers and landlines', async () => {
    for (const phone of ['+14155550123', '+551133334444']) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/phone/start',
        payload: { phone },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('phone start rate limit', async () => {
    const phone = newPhone();
    await startPhone(phone);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/start',
      payload: { phone },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ code: string; retryAfterSeconds: number }>();
    expect(body.code).toBe('code_rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('new number goes to profile then signs in', async () => {
    const phone = newPhone();
    const device = newDevice();
    const verified = await signInByPhone(phone, device);
    expect(verified.status).toBe('needs_profile');
    if (verified.status !== 'needs_profile') return;

    const res = await signup(verified.signupToken, 'Maria Nova', 'maria.nova@exemplo.com');
    expect(res.statusCode).toBe(201);
    const { session } = res.json<SessionResponse>();

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ name: 'Maria Nova', phone });

    const userId = await userIdOf(session.accessToken);
    const [user] = await owner.db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({
      phone,
      email: 'maria.nova@exemplo.com',
      termsVersion: TERMS_VERSION,
      accountStatus: 'active',
    });
    expect(user!.termsAcceptedAt).not.toBeNull();
    expect(user!.lastActiveAt).not.toBeNull();

    const saved = await owner.db.select().from(devices).where(eq(devices.userId, userId));
    expect(saved).toEqual([
      expect.objectContaining({
        installationId: device.installationId,
        platform: 'android',
        appVersion: '1.0.0',
      }),
    ]);

    // Sem token, ou com o token de cadastro, a rota autenticada recusa.
    const anonymous = await app.inject({ method: 'GET', url: '/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: 'unauthorized' });
    const withSignupToken = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${verified.signupToken}` },
    });
    expect(withSignupToken.statusCode).toBe(401);
  });

  it('existing active account signs in', async () => {
    const phone = newPhone();
    const userId = await createUser({ phone });
    const verified = await signInByPhone(phone, newDevice());
    expect(verified.status).toBe('signed_in');
    if (verified.status !== 'signed_in') return;
    expect(await userIdOf(verified.session.accessToken)).toBe(userId);
    expect(verified.session.accessExpiresInSeconds).toBe(900);
  });

  it('stale account on unknown device never signs in', async () => {
    const phone = newPhone();
    const oldId = await createUser({
      phone,
      email: 'Antiga.Conta@Exemplo.com',
      lastActiveAt: daysAgo(100),
    });
    const verified = await signInByPhone(phone, newDevice());
    expect(verified.status).toBe('email_check');
    expect(verified).not.toHaveProperty('session');
    if (verified.status !== 'email_check') return;
    expect(verified.maskedEmail).toBe(maskEmail('Antiga.Conta@Exemplo.com'));

    // O código foi para o e-mail da conta antiga, em minúsculas.
    expect(emailsSent).toContainEqual({
      to: 'antiga.conta@exemplo.com',
      subject: 'Seu código do Alô Cidadão',
      text: 'Seu código é 123456. Ele vale por 10 minutos. Se você não pediu este código, ignore este e-mail.',
    });

    // O código do e-mail não serve no lugar do código do celular.
    const wrongRoute = await verifyPhone(verified.recoveryChallengeId, newDevice());
    expect(wrongRoute.statusCode).toBe(400);
    expect(wrongRoute.json()).toEqual({ code: 'code_invalid' });

    // Nenhuma sessão foi criada para a conta antiga, que continua ativa.
    const oldSessions = await owner.db.select().from(sessions).where(eq(sessions.userId, oldId));
    expect(oldSessions).toEqual([]);
    expect(await accountStatusOf(oldId)).toBe('active');
  });

  it('stale account recovers by e-mail or freezes on signup', async () => {
    const phone = newPhone();
    const oldId = await createUser({
      phone,
      email: 'parada@exemplo.com',
      lastActiveAt: daysAgo(100),
    });
    const verified = await signInByPhone(phone, newDevice());
    if (verified.status !== 'email_check') throw new Error(`status ${verified.status}`);

    const recovered = await app.inject({
      method: 'POST',
      url: '/auth/recovery/verify',
      payload: {
        challengeId: verified.recoveryChallengeId,
        code: '123456',
        signupToken: verified.signupToken,
      },
    });
    expect(recovered.statusCode).toBe(200);
    const oldSession = recovered.json<SessionResponse>().session;
    expect(await userIdOf(oldSession.accessToken)).toBe(oldId);

    // A pessoa poderia, em vez disso, criar conta nova com o mesmo token de cadastro.
    // Volta a conta para "parada" para simular essa escolha.
    await owner.db
      .update(users)
      .set({ lastActiveAt: daysAgo(100) })
      .where(eq(users.id, oldId));
    const created = await signup(verified.signupToken, 'Dono Novo');
    expect(created.statusCode).toBe(201);
    const newId = await userIdOf(created.json<SessionResponse>().session.accessToken);
    expect(newId).not.toBe(oldId);
    expect(await accountStatusOf(oldId)).toBe('frozen');

    // As sessões da conta congelada deixam de renovar.
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldSession.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // De novo com o mesmo token: o telefone já é da conta nova.
    const again = await signup(verified.signupToken, 'Outra Pessoa');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'phone_in_use' });
  });

  it('stale account goes to profile when the recovery e-mail is rate limited', async () => {
    const phone = newPhone();
    const mail = `limite.${randomInt(0, 1_000_000)}@exemplo.com`;
    const oldId = await createUser({ phone, email: mail, lastActiveAt: daysAgo(100) });
    // Um código de recuperação acabou de ir para esse e-mail: o próximo esbarra nos 60 s.
    await owner.db.insert(verificationCodes).values({
      id: randomUUID(),
      purpose: 'account_recovery',
      target: mail,
      userId: oldId,
      codeHash: 'anterior',
      expiresAt: sql`now() + interval '10 minutes'`,
    });

    // O código do celular já foi gasto: a pessoa segue para o cadastro, sem 429.
    const verified = await signInByPhone(phone, newDevice());
    expect(verified.status).toBe('needs_profile');
    if (verified.status !== 'needs_profile') return;
    expect(emailsSent.some((m) => m.to === mail)).toBe(false);

    const created = await signup(verified.signupToken, 'Pessoa Nova');
    expect(created.statusCode).toBe(201);
    expect(await accountStatusOf(oldId)).toBe('frozen');
  });

  it('signup stores the e-mail in lower case', async () => {
    const verified = await signInByPhone(newPhone(), newDevice());
    if (verified.status !== 'needs_profile') throw new Error(`status ${verified.status}`);
    const res = await signup(verified.signupToken, 'Caixa Alta', 'Caixa.Alta@Exemplo.COM');
    expect(res.statusCode).toBe(201);
    const userId = await userIdOf(res.json<SessionResponse>().session.accessToken);
    const [user] = await owner.db.select().from(users).where(eq(users.id, userId));
    expect(user!.email).toBe('caixa.alta@exemplo.com');
  });

  it('recovery code only works for the account in the signup token', async () => {
    const phoneA = newPhone();
    const phoneB = newPhone();
    await createUser({ phone: phoneA, email: 'a.parada@exemplo.com', lastActiveAt: daysAgo(100) });
    await createUser({ phone: phoneB, email: 'b.parada@exemplo.com', lastActiveAt: daysAgo(100) });
    const a = await signInByPhone(phoneA, newDevice());
    const b = await signInByPhone(phoneB, newDevice());
    if (a.status !== 'email_check' || b.status !== 'email_check') throw new Error('status');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/recovery/verify',
      payload: { challengeId: a.recoveryChallengeId, code: '123456', signupToken: b.signupToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'code_invalid' });

    const badToken = await app.inject({
      method: 'POST',
      url: '/auth/recovery/verify',
      payload: { challengeId: b.recoveryChallengeId, code: '123456', signupToken: 'nao-e-token' },
    });
    expect(badToken.statusCode).toBe(401);
    expect(badToken.json()).toEqual({ code: 'signup_token_invalid' });
  });

  it('stale account without email goes straight to profile and freezes on signup', async () => {
    const phone = newPhone();
    const oldId = await createUser({ phone, lastActiveAt: daysAgo(100) });
    const verified = await signInByPhone(phone, newDevice());
    expect(verified.status).toBe('needs_profile');
    if (verified.status !== 'needs_profile') return;
    expect(await accountStatusOf(oldId)).toBe('active');

    const created = await signup(verified.signupToken, 'Pessoa Nova');
    expect(created.statusCode).toBe(201);
    const newId = await userIdOf(created.json<SessionResponse>().session.accessToken);
    expect(newId).not.toBe(oldId);
    expect(await accountStatusOf(oldId)).toBe('frozen');
  });

  it('signup is refused when the old account is no longer stale', async () => {
    const phone = newPhone();
    const oldId = await createUser({ phone, lastActiveAt: daysAgo(100) });
    const verified = await signInByPhone(phone, newDevice());
    if (verified.status !== 'needs_profile') throw new Error(`status ${verified.status}`);

    // A dona da conta voltou a usar o app antes do cadastro.
    await owner.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, oldId));
    const res = await signup(verified.signupToken);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'phone_in_use' });
    expect(await accountStatusOf(oldId)).toBe('active');

    const invalid = await signup('token-qualquer');
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ code: 'signup_token_invalid' });
  });

  it('stale account on known device signs in', async () => {
    const phone = newPhone();
    const device = newDevice();
    const oldId = await createUser({
      phone,
      email: 'conhecido@exemplo.com',
      lastActiveAt: daysAgo(100),
    });
    await owner.db.insert(devices).values({
      userId: oldId,
      installationId: device.installationId,
      platform: 'android',
      appVersion: '0.9.0',
    });

    const verified = await signInByPhone(phone, device);
    expect(verified.status).toBe('signed_in');
    if (verified.status !== 'signed_in') return;
    expect(await userIdOf(verified.session.accessToken)).toBe(oldId);
  });

  it('locked code rejects the right code', async () => {
    const { challengeId } = await startPhone(newPhone());
    const device = newDevice();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await verifyPhone(challengeId, device, '000000');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: attempt < 5 ? 'code_invalid' : 'code_locked' });
    }
    const right = await verifyPhone(challengeId, device, '123456');
    expect(right.statusCode).toBe(400);
    expect(right.json()).toEqual({ code: 'code_locked' });
  });

  it('invited agent becomes active on first sign in', async () => {
    const phone = newPhone();
    const agentId = await createUser({ phone, name: 'Agente Convidado' });
    const [tenant] = await owner.db
      .insert(tenants)
      .values({
        name: 'Município Convite',
        displayName: 'Prefeitura Convite',
        city: 'Convite',
        state: 'SP',
        ibgeCode: String(randomInt(1_000_000, 9_999_999)),
        status: 'active',
      })
      .returning();
    await owner.db
      .insert(memberships)
      .values({ tenantId: tenant!.id, userId: agentId, role: 'field_agent', status: 'invited' });

    const verified = await signInByPhone(phone, newDevice());
    expect(verified.status).toBe('signed_in');

    const [membership] = await owner.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.userId, agentId), eq(memberships.tenantId, tenant!.id)));
    expect(membership!.status).toBe('active');
  });

  it('refresh fails after logout', async () => {
    const phone = newPhone();
    await createUser({ phone });
    const verified = await signInByPhone(phone, newDevice());
    if (verified.status !== 'signed_in') throw new Error(`status ${verified.status}`);
    const { accessToken, refreshToken } = verified.session;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const body = refreshed.json<{ accessToken: string; accessExpiresInSeconds: number }>();
    expect(body.accessExpiresInSeconds).toBe(900);
    expect(await verifyAccessToken(secret, body.accessToken)).toEqual(
      await verifyAccessToken(secret, accessToken),
    );

    const anonymous = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(anonymous.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(logout.statusCode).toBe(204);

    const sessionId = (await verifyAccessToken(secret, accessToken))!.sessionId;
    const [session] = await owner.db
      .select({ revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(session!.revokedAt).not.toBeNull();

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ code: 'session_expired' });
  });

  it('logout clears the push token of the session device', async () => {
    const phone = newPhone();
    const userId = await createUser({ phone });
    const device = newDevice();
    const other = newDevice();
    const verified = await signInByPhone(phone, device);
    if (verified.status !== 'signed_in') throw new Error(`status ${verified.status}`);
    const { accessToken } = verified.session;
    const headers = { authorization: `Bearer ${accessToken}` };
    for (const [d, pushToken] of [
      [device, `push-${randomUUID()}`],
      [other, `push-${randomUUID()}`],
    ] as const) {
      const res = await app.inject({
        method: 'PUT',
        url: `/me/devices/${d.installationId}`,
        headers,
        payload: { platform: d.platform, appVersion: d.appVersion, pushToken },
      });
      expect(res.statusCode).toBe(204);
    }

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers });
    expect(logout.statusCode).toBe(204);

    const saved = await owner.db
      .select({ installationId: devices.installationId, pushToken: devices.pushToken })
      .from(devices)
      .where(eq(devices.userId, userId));
    expect(saved.find((d) => d.installationId === device.installationId)?.pushToken).toBeNull();
    // O outro aparelho da conta continua recebendo.
    expect(saved.find((d) => d.installationId === other.installationId)?.pushToken).not.toBeNull();
  });

  it('revoking a session on the server clears the device push token', async () => {
    const phone = newPhone();
    const userId = await createUser({ phone });
    const device = newDevice();
    const other = newDevice();
    const verified = await signInByPhone(phone, device);
    if (verified.status !== 'signed_in') throw new Error(`status ${verified.status}`);
    const { accessToken, refreshToken } = verified.session;
    const headers = { authorization: `Bearer ${accessToken}` };
    for (const [d, pushToken] of [
      [device, `push-${randomUUID()}`],
      [other, `push-${randomUUID()}`],
    ] as const) {
      const res = await app.inject({
        method: 'PUT',
        url: `/me/devices/${d.installationId}`,
        headers,
        payload: { platform: d.platform, appVersion: d.appVersion, pushToken },
      });
      expect(res.statusCode).toBe(204);
    }

    // Sessão ainda válida: renovar não mexe no token.
    const alive = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(alive.statusCode).toBe(200);
    const tokenOf = async (installationId: string) =>
      (
        await owner.db
          .select({ pushToken: devices.pushToken })
          .from(devices)
          .where(and(eq(devices.userId, userId), eq(devices.installationId, installationId)))
      )[0]?.pushToken;
    expect(await tokenOf(device.installationId)).not.toBeNull();

    // O servidor revoga a sessão (por exemplo, outra conta ganhou o número): a renovação falha.
    await owner.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, userId));
    const refused = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refused.statusCode).toBe(401);

    expect(await tokenOf(device.installationId)).toBeNull();
    // O outro aparelho da conta não é tocado.
    expect(await tokenOf(other.installationId)).not.toBeNull();
  });

  it('auth rate limit per IP', async () => {
    const limited = await build({ max: 3, timeWindowMs: 60_000 });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await limited.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { refreshToken: 'desconhecido' },
        });
        expect(res.statusCode).toBe(401);
      }
      const fourth = await limited.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'desconhecido' },
      });
      expect(fourth.statusCode).toBe(429);
      expect(fourth.json()).toMatchObject({ code: 'rate_limited' });

      // O limite vale só para /auth.
      const health = await limited.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
