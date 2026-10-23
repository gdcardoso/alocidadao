import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { maskEmail, type PanelChallengeResponse, type SessionResponse } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { EmailSender } from '../messaging/email.js';
import type { SmsSender } from '../messaging/sms.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { verifyAccessToken } from './tokens.js';

const { users, memberships, tenants } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const secret = 'segredo-de-teste-da-api-com-mais-de-32-caracteres';

const emailsSent: { to: string; subject: string; text: string }[] = [];
const sms: SmsSender = { send: async () => {} };
const email: EmailSender = {
  send: async (msg) => {
    emailsSent.push(msg);
  },
};

let app: Awaited<ReturnType<typeof buildApp>>;

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** CPF válido e exclusivo do teste. */
function newCpf(): string {
  const base = String(randomInt(100_000_000, 999_999_999));
  const first = base + checkDigit(base, 9);
  return first + checkDigit(first, 10);
}

const newPhone = () => `+55219${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function createUser(values: Partial<typeof users.$inferInsert>) {
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Conta do painel', phone: newPhone(), ...values })
    .returning();
  return user!.id;
}

async function createTenant() {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município Painel',
      displayName: 'Prefeitura Painel',
      city: 'Painel',
      state: 'MG',
      ibgeCode: String(randomInt(1_000_000, 9_999_999)),
      status: 'active',
    })
    .returning();
  return tenant!.id;
}

async function addMembership(
  userId: string,
  role: (typeof memberships.$inferInsert)['role'],
  status: (typeof memberships.$inferInsert)['status'] = 'active',
) {
  await owner.db
    .insert(memberships)
    .values({ tenantId: await createTenant(), userId, role, status });
}

function panelStart(cpf: string) {
  return app.inject({ method: 'POST', url: '/auth/panel/start', payload: { cpf } });
}

function panelVerify(challengeId: string, code = '123456') {
  return app.inject({ method: 'POST', url: '/auth/panel/verify', payload: { challengeId, code } });
}

async function signInPanel(cpf: string) {
  const start = await panelStart(cpf);
  expect(start.statusCode).toBe(200);
  const verify = await panelVerify(start.json<PanelChallengeResponse>().challengeId);
  expect(verify.statusCode).toBe(200);
  return verify.json<SessionResponse>().session;
}

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: {
      secret,
      devFixedCode: '123456',
      sms,
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

describe('panel auth routes', () => {
  it('manager signs in with CPF and e-mail code', async () => {
    const cpf = newCpf();
    const mail = 'Gestora.Painel@Exemplo.com';
    const userId = await createUser({ cpf, email: mail });
    await addMembership(userId, 'manager');

    // CPF com pontuação também é aceito.
    const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const start = await panelStart(formatted);
    expect(start.statusCode).toBe(200);
    const body = start.json<PanelChallengeResponse>();
    expect(body.maskedEmail).toBe(maskEmail(mail));
    expect(start.body).not.toContain(mail);
    expect(start.body.toLowerCase()).not.toContain(mail.toLowerCase());
    expect(body.expiresInSeconds).toBe(600);
    expect(body.resendInSeconds).toBe(60);

    expect(emailsSent).toContainEqual({
      to: mail.toLowerCase(),
      subject: 'Seu código do Alô Cidadão',
      text: 'Seu código é 123456. Ele vale por 10 minutos. Se você não pediu este código, ignore este e-mail.',
    });

    const wrong = await panelVerify(body.challengeId, '000000');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ code: 'code_invalid' });

    const verify = await panelVerify(body.challengeId);
    expect(verify.statusCode).toBe(200);
    const { session } = verify.json<SessionResponse>();
    expect(await verifyAccessToken(secret, session.accessToken)).toMatchObject({
      userId,
      audience: 'panel',
    });

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: userId, panelTenants: [{ role: 'manager' }] });

    // Um novo pedido para o mesmo CPF logo em seguida esbarra no limite de reenvio.
    const again = await panelStart(cpf);
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'code_rate_limited' });
  });

  it('CPF with invalid check digits is 400', async () => {
    const cpf = newCpf();
    const wrongDigit = (Number(cpf[10]) + 1) % 10;
    const res = await panelStart(cpf.slice(0, 10) + wrongDigit);
    expect(res.statusCode).toBe(400);
  });

  it('CPF without panel access is 404', async () => {
    // Agente de campo.
    const agentCpf = newCpf();
    const agentId = await createUser({ cpf: agentCpf, email: 'agente.painel@exemplo.com' });
    await addMembership(agentId, 'field_agent');
    // Cidadão sem vínculo.
    const citizenCpf = newCpf();
    await createUser({ cpf: citizenCpf, email: 'cidadao.painel@exemplo.com' });
    // Gestor com vínculo desativado.
    const inactiveCpf = newCpf();
    const inactiveId = await createUser({ cpf: inactiveCpf, email: 'inativo.painel@exemplo.com' });
    await addMembership(inactiveId, 'manager', 'inactive');
    // Gestor sem e-mail.
    const noEmailCpf = newCpf();
    const noEmailId = await createUser({ cpf: noEmailCpf });
    await addMembership(noEmailId, 'tenant_admin');

    for (const cpf of [agentCpf, citizenCpf, inactiveCpf, noEmailCpf, newCpf()]) {
      const res = await panelStart(cpf);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'panel_access_not_found' });
    }
  });

  it('platform staff without membership signs in', async () => {
    const cpf = newCpf();
    const userId = await createUser({
      cpf,
      email: 'suporte.painel@exemplo.com',
      platformRole: 'support',
    });
    const session = await signInPanel(cpf);
    expect(await verifyAccessToken(secret, session.accessToken)).toMatchObject({
      userId,
      audience: 'panel',
    });
  });

  it('panel access lost before verify refuses the code', async () => {
    const cpf = newCpf();
    const userId = await createUser({ cpf, email: 'perdeu.acesso@exemplo.com' });
    await addMembership(userId, 'manager');
    const start = await panelStart(cpf);
    expect(start.statusCode).toBe(200);

    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, userId));
    const verify = await panelVerify(start.json<PanelChallengeResponse>().challengeId);
    expect(verify.statusCode).toBe(400);
    expect(verify.json()).toEqual({ code: 'code_invalid' });
  });

  it('panel token is refused by app-only routes', async () => {
    const cpf = newCpf();
    const userId = await createUser({ cpf, email: 'admin.painel@exemplo.com' });
    await addMembership(userId, 'tenant_admin');
    const session = await signInPanel(cpf);

    const res = await app.inject({
      method: 'PUT',
      url: `/me/devices/${randomUUID()}`,
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { platform: 'android', appVersion: '1.0.0' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized' });
  });
});
