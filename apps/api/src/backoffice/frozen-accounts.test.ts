import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { frozenAccountCodeResponseSchema, maskEmail } from '@alocidadao/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { issueChallenge } from '../auth/codes.js';
import type { EmailMessage } from '../messaging/email.js';
import { panelAuthHeader, staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { appAuthHeader, TEST_AUTH_SECRET, testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';

const { users, sessions, staffAuditEvents } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const emailsSent: EmailMessage[] = [];

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: { ...testAuthOptions, email: { send: async (msg) => void emailsSent.push(msg) } },
  });
});

beforeEach(() => {
  emailsSent.length = 0;
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

/** CPF válido e aleatório (dígitos verificadores calculados). */
function newCpf(): string {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  for (const length of [9, 10]) {
    const sum = digits.reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  const cpf = digits.join('');
  return /^(.)\1{10}$/.test(cpf) ? newCpf() : cpf;
}

const newEmail = () => `pessoa.${randomUUID()}@teste.dev`;
const newPhone = () => `+55319${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/** Conta congelada com CPF (e e-mail, salvo `email: null`; número, salvo `phone: null`). */
async function frozenAccount({
  email = newEmail(),
  phone = newPhone(),
  platformRole = null,
}: {
  email?: string | null;
  phone?: string | null;
  platformRole?: 'admin' | 'support' | null;
} = {}) {
  const cpf = newCpf();
  const [user] = await owner.db
    .insert(users)
    .values({
      name: 'Dona da Conta Antiga',
      phone,
      cpf,
      email,
      accountStatus: 'frozen',
      platformRole,
    })
    .returning();
  return { id: user!.id, cpf, email, phone: user!.phone };
}

async function post(url: string, staffId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: await staffAuthHeader(appDb.db, staffId),
    payload,
  });
}

const requestCode = (staffId: string, payload: Record<string, unknown>) =>
  post('/backoffice/frozen-accounts/recovery-code', staffId, payload);
const recover = (staffId: string, payload: Record<string, unknown>) =>
  post('/backoffice/frozen-accounts/recover', staffId, payload);
const releaseCpf = (staffId: string, payload: Record<string, unknown>) =>
  post('/backoffice/frozen-accounts/release-cpf', staffId, payload);

/** Abre o modo suporte da pessoa na prefeitura (a auditoria das rotas só aceita essa prefeitura). */
async function enterSupport(staffId: string, tenantId: string) {
  const response = await post(`/backoffice/tenants/${tenantId}/support/enter`, staffId, {});
  expect(response.statusCode).toBe(204);
}

/** O código de 6 dígitos do último e-mail enviado para `to`. */
function codeSentTo(to: string): string {
  const message = emailsSent.findLast((m) => m.to === to);
  expect(message, `nenhum e-mail para ${to}`).toBeDefined();
  return /(\d{6})/.exec(message!.text)![1]!;
}

const userRow = async (id: string) => {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  return row!;
};

/** Eventos da pessoa, sem os de entrada e saída do modo suporte. */
const auditBy = async (staffId: string) =>
  (
    await owner.db.select().from(staffAuditEvents).where(eq(staffAuditEvents.staffUserId, staffId))
  ).filter((event) => !event.action.startsWith('support.'));

describe('conta congelada no backoffice', () => {
  it('recovery code goes to the frozen account email, never the typed one', async () => {
    const supportId = await fx.newStaff('support');
    const tenantId = await fx.createTenant();
    await enterSupport(supportId, tenantId);
    const frozen = await frozenAccount({ email: 'Antiga.Dona@Teste.dev' });
    const typed = newEmail();

    // Um e-mail digitado no formulário não muda o destino: o corpo nem o aceita.
    const sent = await requestCode(supportId, { cpf: frozen.cpf, tenantId, email: typed });
    expect(sent.statusCode).toBe(200);
    const body = frozenAccountCodeResponseSchema.parse(sent.json());
    expect(body.maskedEmail).toBe(maskEmail('Antiga.Dona@Teste.dev'));
    expect(body.retryAfterSeconds).toBe(60);
    expect(sent.body.toLowerCase()).not.toContain('antiga.dona@teste.dev');
    expect(emailsSent.map((m) => m.to)).toEqual(['antiga.dona@teste.dev']);

    // Uma sessão aberta da conta antiga é revogada na recuperação.
    await panelAuthHeader(appDb.db, frozen.id);
    const newAddress = newEmail();
    const recovered = await recover(supportId, {
      challengeId: body.challengeId,
      code: codeSentTo('antiga.dona@teste.dev'),
      email: newAddress,
      tenantId,
    });
    expect(recovered.statusCode).toBe(204);
    // O número foi reusado por outra pessoa: a conta recuperada fica sem ele.
    expect(await userRow(frozen.id)).toMatchObject({
      accountStatus: 'active',
      email: newAddress,
      cpf: frozen.cpf,
      phone: null,
    });
    const open = await owner.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, frozen.id), isNull(sessions.revokedAt)));
    expect(open).toEqual([]);

    const events = await auditBy(supportId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId,
      action: 'account.recover',
      targetType: 'user',
      targetId: frozen.id,
      details: null,
    });

    // O mesmo código não vale duas vezes.
    const again = await recover(supportId, {
      challengeId: body.challengeId,
      code: codeSentTo('antiga.dona@teste.dev'),
      email: newEmail(),
      tenantId,
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ code: 'invalid_code' });
  });

  it('a second code right away is 429 code_rate_limited', async () => {
    const adminId = await fx.newStaff('admin');
    const frozen = await frozenAccount();
    expect((await requestCode(adminId, { cpf: frozen.cpf, tenantId: null })).statusCode).toBe(200);
    const again = await requestCode(adminId, { cpf: frozen.cpf, tenantId: null });
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'code_rate_limited' });
    expect(again.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it('recover rejects a challenge issued for another account', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount();

    // Código de recuperação de uma conta ativa (o fluxo do app): não descongela nada.
    const activeId = await fx.createUser('Conta Ativa');
    const activeEmail = newEmail();
    await owner.db.update(users).set({ email: activeEmail }).where(eq(users.id, activeId));
    const forActive = await issueChallenge(appDb.db, {
      secret: TEST_AUTH_SECRET,
      purpose: 'account_recovery',
      target: activeEmail,
      userId: activeId,
    });
    // Código de outra finalidade com a conta congelada como dona.
    const otherPurpose = await issueChallenge(appDb.db, {
      secret: TEST_AUTH_SECRET,
      purpose: 'panel_login',
      target: frozen.cpf,
      userId: frozen.id,
    });
    // Código de recuperação da conta congelada, mas para outro e-mail que não o dela.
    const otherTarget = await issueChallenge(appDb.db, {
      secret: TEST_AUTH_SECRET,
      purpose: 'account_recovery',
      target: newEmail(),
      userId: frozen.id,
    });

    for (const challenge of [forActive, otherPurpose, otherTarget]) {
      if (!challenge.issued) throw new Error('código não emitido');
      const response = await recover(supportId, {
        challengeId: challenge.challengeId,
        code: challenge.code,
        email: newEmail(),
        tenantId: null,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: 'invalid_code' });
    }
    expect(await userRow(frozen.id)).toMatchObject({
      accountStatus: 'frozen',
      email: frozen.email,
    });
    expect(await userRow(activeId)).toMatchObject({ accountStatus: 'active', email: activeEmail });
    expect(await auditBy(supportId)).toEqual([]);
  });

  it('recover with a wrong code is 400 invalid_code', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount();
    const sent = await requestCode(supportId, { cpf: frozen.cpf, tenantId: null });
    const { challengeId } = sent.json<{ challengeId: string }>();
    const right = codeSentTo(frozen.email!);
    const wrong = right === '000000' ? '111111' : '000000';

    const response = await recover(supportId, {
      challengeId,
      code: wrong,
      email: newEmail(),
      tenantId: null,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'invalid_code' });
    expect((await userRow(frozen.id)).accountStatus).toBe('frozen');

    // Desafio inexistente também.
    const unknown = await recover(supportId, {
      challengeId: randomUUID(),
      code: right,
      email: newEmail(),
      tenantId: null,
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ code: 'invalid_code' });
  });

  it('recover with an email of another account is 409 email_in_use and the code still works', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount();
    const takenId = await fx.createUser('Dona do E-mail');
    const taken = newEmail();
    await owner.db.update(users).set({ email: taken }).where(eq(users.id, takenId));

    const sent = await requestCode(supportId, { cpf: frozen.cpf, tenantId: null });
    const { challengeId } = sent.json<{ challengeId: string }>();
    const code = codeSentTo(frozen.email!);

    const conflict = await recover(supportId, { challengeId, code, email: taken, tenantId: null });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ code: 'email_in_use' });
    expect((await userRow(frozen.id)).accountStatus).toBe('frozen');

    // A recusa desfaz o consumo: o mesmo código vale com outro e-mail.
    const ok = await recover(supportId, { challengeId, code, email: newEmail(), tenantId: null });
    expect(ok.statusCode).toBe(204);
    expect((await userRow(frozen.id)).accountStatus).toBe('active');
  });

  it('frozen account without email is 409 frozen_account_without_email', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount({ email: null });
    const response = await requestCode(supportId, { cpf: frozen.cpf, tenantId: null });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'frozen_account_without_email' });
    expect(emailsSent).toEqual([]);
  });

  it('cpf without a frozen account is 404 frozen_account_not_found', async () => {
    const supportId = await fx.newStaff('support');
    // Conta ativa com o CPF: não é congelada, então nem código nem liberação.
    const cpf = newCpf();
    await owner.db
      .insert(users)
      .values({ name: 'Ativa', phone: newPhone(), cpf, email: newEmail() });
    for (const send of [requestCode, releaseCpf]) {
      const response = await send(supportId, { cpf, tenantId: null });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'frozen_account_not_found' });
    }
    expect(emailsSent).toEqual([]);
  });

  it('unknown tenant is 404 tenant_not_found', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount();
    const tenantId = randomUUID();
    for (const send of [requestCode, releaseCpf]) {
      const response = await send(supportId, { cpf: frozen.cpf, tenantId });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'tenant_not_found' });
    }
    const recovered = await recover(supportId, {
      challengeId: randomUUID(),
      code: '123456',
      email: newEmail(),
      tenantId,
    });
    expect(recovered.statusCode).toBe(404);
    expect(recovered.json()).toEqual({ code: 'tenant_not_found' });
    expect(await userRow(frozen.id)).toMatchObject({ accountStatus: 'frozen', cpf: frozen.cpf });
  });

  it('release then manager create succeeds with a new account', async () => {
    const supportId = await fx.newStaff('support');
    const seed = await fx.seedPanelTenant();
    const adminId = await fx.newAdmin(seed.tenantId);
    const frozen = await frozenAccount();
    await enterSupport(supportId, seed.tenantId);

    const released = await releaseCpf(supportId, { cpf: frozen.cpf, tenantId: seed.tenantId });
    expect(released.statusCode).toBe(204);
    expect(await userRow(frozen.id)).toMatchObject({ accountStatus: 'frozen', cpf: null });
    expect(emailsSent).toEqual([]);

    const email = newEmail();
    const created = await app.inject({
      method: 'POST',
      url: '/panel/managers',
      headers: await panelAuthHeader(appDb.db, adminId, seed.tenantId),
      payload: { name: 'Gestora Nova', cpf: frozen.cpf, email, departmentIds: [seed.worksId] },
    });
    expect(created.statusCode).toBe(201);
    const manager = created.json<{ userId: string }>();
    expect(manager.userId).not.toBe(frozen.id);
    expect(await userRow(manager.userId)).toMatchObject({ cpf: frozen.cpf, email });
    // A conta antiga continua congelada, sem CPF e com o e-mail dela.
    expect(await userRow(frozen.id)).toMatchObject({
      accountStatus: 'frozen',
      cpf: null,
      email: frozen.email,
    });

    const events = await auditBy(supportId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: seed.tenantId,
      action: 'account.release_cpf',
      targetType: 'user',
      targetId: frozen.id,
      details: null,
    });
  });

  it('tenantId other than the open support tenant is 403 support_tenant_mismatch', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount();
    const tenantId = await fx.createTenant();
    const otherTenantId = await fx.createTenant();

    const refused = async () => {
      for (const send of [requestCode, releaseCpf]) {
        const response = await send(supportId, { cpf: frozen.cpf, tenantId });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ code: 'support_tenant_mismatch' });
      }
      const recovered = await recover(supportId, {
        challengeId: randomUUID(),
        code: '123456',
        email: newEmail(),
        tenantId,
      });
      expect(recovered.statusCode).toBe(403);
      expect(recovered.json()).toEqual({ code: 'support_tenant_mismatch' });
    };

    // Fora do modo suporte.
    await refused();
    // No modo suporte de outra prefeitura.
    await enterSupport(supportId, otherTenantId);
    await refused();
    // Depois de sair dele.
    await post(`/backoffice/tenants/${otherTenantId}/support/leave`, supportId, {});
    await refused();

    expect(emailsSent).toEqual([]);
    expect(await userRow(frozen.id)).toMatchObject({ accountStatus: 'frozen', cpf: frozen.cpf });
    expect(await auditBy(supportId)).toEqual([]);

    // Na prefeitura do modo suporte aberto, vale.
    await enterSupport(supportId, tenantId);
    expect((await releaseCpf(supportId, { cpf: frozen.cpf, tenantId })).statusCode).toBe(204);
  });

  it('release of a frozen account without phone is 409 frozen_account_without_phone', async () => {
    const supportId = await fx.newStaff('support');
    const frozen = await frozenAccount({ phone: null });
    const response = await releaseCpf(supportId, { cpf: frozen.cpf, tenantId: null });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'frozen_account_without_phone' });
    expect(await userRow(frozen.id)).toMatchObject({ accountStatus: 'frozen', cpf: frozen.cpf });
    expect(await auditBy(supportId)).toEqual([]);
  });

  it('support cannot recover or release a frozen staff account (403 admin_only)', async () => {
    const supportId = await fx.newStaff('support');
    const adminId = await fx.newStaff('admin');
    const frozen = await frozenAccount({ platformRole: 'admin' });

    const sent = await requestCode(supportId, { cpf: frozen.cpf, tenantId: null });
    const { challengeId } = sent.json<{ challengeId: string }>();
    const code = codeSentTo(frozen.email!);
    const recovered = await recover(supportId, {
      challengeId,
      code,
      email: newEmail(),
      tenantId: null,
    });
    expect(recovered.statusCode).toBe(403);
    expect(recovered.json()).toEqual({ code: 'admin_only' });

    const released = await releaseCpf(supportId, { cpf: frozen.cpf, tenantId: null });
    expect(released.statusCode).toBe(403);
    expect(released.json()).toEqual({ code: 'admin_only' });
    expect(await userRow(frozen.id)).toMatchObject({
      accountStatus: 'frozen',
      cpf: frozen.cpf,
      email: frozen.email,
    });
    expect(await auditBy(supportId)).toEqual([]);

    // O admin recupera, com o mesmo código (a recusa desfez o consumo).
    const ok = await recover(adminId, { challengeId, code, email: newEmail(), tenantId: null });
    expect(ok.statusCode).toBe(204);
    expect((await userRow(frozen.id)).accountStatus).toBe('active');
  });

  it('app token is 403 not_platform_staff', async () => {
    const citizenId = await fx.createUser('Cidadão');
    const frozen = await frozenAccount();
    const headers = await appAuthHeader(appDb.db, citizenId);
    for (const path of ['recovery-code', 'release-cpf']) {
      const response = await app.inject({
        method: 'POST',
        url: `/backoffice/frozen-accounts/${path}`,
        headers,
        payload: { cpf: frozen.cpf, tenantId: null },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: 'not_platform_staff' });
    }
    expect(await userRow(frozen.id)).toMatchObject({ accountStatus: 'frozen', cpf: frozen.cpf });
  });
});
