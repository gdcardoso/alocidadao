import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PgInsertValue } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumeCode,
  findUserByCpf,
  findUserByPhone,
  issueCode,
  sessionForRefresh,
} from './auth.js';
import { createDatabase, withContext, type Database } from './client.js';
import {
  clientActions,
  devices,
  memberships,
  sessions,
  tenants,
  users,
  verificationCodes,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// Códigos de verificação, sessões e aparelhos. As funções de login rodam sem contexto,
// como app_user; o dono do banco prepara os dados e ajusta datas para simular o tempo.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

let tenantId: string;
let userA: string;
let userB: string;

// Datas calculadas pelo relógio do banco: o relógio do contêiner pode estar defasado em relação
// ao do host, e as funções comparam tudo com `now()` do banco.
const daysAgo = (days: number) => sql<Date>`now() - make_interval(days => ${days}::int)`;
const minutesAgo = (minutes: number) => sql<Date>`now() - make_interval(mins => ${minutes}::int)`;
const minutesAhead = (minutes: number) => sql<Date>`now() + make_interval(mins => ${minutes}::int)`;

/** `now()` do banco, para comparar com datas gravadas por ele. */
async function dbNow(): Promise<number> {
  const result = await owner.pool.query<{ now: Date }>('select now() as now');
  return result.rows[0]!.now.getTime();
}

async function createUser(db: Database, values: PgInsertValue<typeof users>) {
  const [user] = await db.insert(users).values(values).returning();
  return user!.id;
}

/** Drizzle embrulha o erro do Postgres; devolve a mensagem original. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('Era esperado que o banco recusasse a operação');
}

/** Emite um código novo para um destino exclusivo do teste. */
async function issueFresh(target: string, codeHash = 'hash-certo') {
  const id = randomUUID();
  const result = await issueCode(app.db, {
    id,
    purpose: 'phone_login',
    target,
    userId: null,
    codeHash,
  });
  expect(result).toEqual({ issued: true, retryAfterSeconds: 0 });
  return id;
}

beforeAll(async () => {
  const [tenant] = await owner.db
    .insert(tenants)
    .values({
      name: 'Município de Acesso',
      displayName: 'Prefeitura Acesso',
      city: 'Acesso',
      state: 'SP',
      ibgeCode: '0000201',
      status: 'active',
    })
    .returning();
  tenantId = tenant!.id;
  userA = await createUser(owner.db, { name: 'Pessoa A', phone: '+5511950000001' });
  userB = await createUser(owner.db, { name: 'Pessoa B', phone: '+5511950000002' });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('códigos de verificação', () => {
  it('emite código e recusa reenvio antes de 60 s', async () => {
    const target = '+5511950000101';
    await issueFresh(target);
    const second = await issueCode(app.db, {
      id: randomUUID(),
      purpose: 'phone_login',
      target,
      userId: null,
      codeHash: 'outro',
    });
    expect(second.issued).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('recusa o sexto código na mesma hora', async () => {
    const target = '+5511950000102';
    // Espaçados de 2 min, para não esbarrar na trava dos 60 s.
    await owner.db.insert(verificationCodes).values(
      [2, 4, 6, 8, 10].map((minutes) => ({
        id: randomUUID(),
        purpose: 'phone_login' as const,
        target,
        codeHash: 'antigo',
        expiresAt: minutesAhead(10),
        createdAt: minutesAgo(minutes),
      })),
    );
    const sixth = await issueCode(app.db, {
      id: randomUUID(),
      purpose: 'phone_login',
      target,
      userId: null,
      codeHash: 'novo',
    });
    expect(sixth.issued).toBe(false);
    // O mais antigo (10 min atrás) sai da janela de 1 h em cerca de 50 min.
    expect(sixth.retryAfterSeconds).toBeGreaterThan(49 * 60);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(50 * 60);

    // Outra finalidade para o mesmo destino não entra na conta.
    const other = await issueCode(app.db, {
      id: randomUUID(),
      purpose: 'account_recovery',
      target,
      userId: null,
      codeHash: 'novo',
    });
    expect(other.issued).toBe(true);
  });

  it('consome o código certo uma vez só', async () => {
    const id = randomUUID();
    await issueCode(app.db, {
      id,
      purpose: 'phone_change',
      target: '+5511950000103',
      userId: userA,
      codeHash: 'hash-certo',
    });
    expect(await consumeCode(app.db, id, 'hash-certo')).toEqual({
      result: 'ok',
      purpose: 'phone_change',
      target: '+5511950000103',
      userId: userA,
    });
    expect(await consumeCode(app.db, id, 'hash-certo')).toEqual({ result: 'invalid' });
    expect(await consumeCode(app.db, randomUUID(), 'hash-certo')).toEqual({ result: 'invalid' });
  });

  it('código trava na quinta tentativa errada', async () => {
    const id = await issueFresh('+5511950000104');
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await consumeCode(app.db, id, 'errado')).toEqual({ result: 'invalid' });
    }
    expect(await consumeCode(app.db, id, 'errado')).toEqual({ result: 'locked' });
    expect(await consumeCode(app.db, id, 'hash-certo')).toEqual({ result: 'locked' });
  });

  it('código vencido', async () => {
    const id = await issueFresh('+5511950000105');
    await owner.db
      .update(verificationCodes)
      .set({ expiresAt: minutesAgo(1) })
      .where(eq(verificationCodes.id, id));
    expect(await consumeCode(app.db, id, 'hash-certo')).toEqual({ result: 'expired' });
  });

  it('app_user não lê verification_codes', async () => {
    const error = await dbError(
      withContext(app.db, { userId: userA }, (tx) => tx.select().from(verificationCodes)),
    );
    expect(error).toMatch(/permission denied/);
  });
});

describe('login por telefone e por CPF', () => {
  it('findUserByPhone marca conta parada e aparelho conhecido', async () => {
    const installationId = randomUUID();
    const stale = await createUser(owner.db, {
      name: 'Parada',
      phone: '+5511950000201',
      email: 'parada@acesso.dev',
      lastActiveAt: daysAgo(91),
    });
    await createUser(owner.db, {
      name: 'Recente',
      phone: '+5511950000202',
      lastActiveAt: daysAgo(89),
    });
    await createUser(owner.db, {
      name: 'Nunca usou',
      phone: '+5511950000203',
      createdAt: daysAgo(100),
    });
    const known = await createUser(owner.db, { name: 'Conhecida', phone: '+5511950000204' });
    await owner.db
      .insert(devices)
      .values({ userId: known, installationId, platform: 'android', appVersion: '1.0.0' });

    expect(await findUserByPhone(app.db, '+5511950000201', installationId)).toEqual({
      id: stale,
      email: 'parada@acesso.dev',
      stale: true,
      knownDevice: false,
    });
    expect(await findUserByPhone(app.db, '+5511950000202', installationId)).toMatchObject({
      stale: false,
    });
    expect(await findUserByPhone(app.db, '+5511950000203', installationId)).toMatchObject({
      stale: true,
    });
    expect(await findUserByPhone(app.db, '+5511950000204', installationId)).toEqual({
      id: known,
      email: null,
      stale: false,
      knownDevice: true,
    });
    // Outro aparelho da mesma conta não é conhecido.
    expect(await findUserByPhone(app.db, '+5511950000204', randomUUID())).toMatchObject({
      knownDevice: false,
    });
    expect(await findUserByPhone(app.db, '+5511950000299', installationId)).toBeNull();
  });

  it('findUserByPhone ignora conta congelada', async () => {
    const phone = '+5511950000205';
    const id = await createUser(owner.db, { name: 'Congelada', phone });
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, id));
    expect(await findUserByPhone(app.db, phone, randomUUID())).toBeNull();
  });

  it('findUserByCpf exige vínculo de painel', async () => {
    const agent = await createUser(owner.db, {
      name: 'Agente',
      phone: '+5511950000301',
      cpf: '20000000001',
    });
    const manager = await createUser(owner.db, {
      name: 'Gestor',
      phone: '+5511950000302',
      cpf: '20000000002',
      email: 'gestor@acesso.dev',
    });
    const inactiveManager = await createUser(owner.db, {
      name: 'Gestor inativo',
      phone: '+5511950000303',
      cpf: '20000000003',
    });
    const admin = await createUser(owner.db, {
      name: 'Admin',
      phone: '+5511950000304',
      cpf: '20000000004',
      platformRole: 'admin',
    });
    await owner.db.insert(memberships).values([
      { tenantId, userId: agent, role: 'field_agent' },
      { tenantId, userId: manager, role: 'manager' },
      { tenantId, userId: inactiveManager, role: 'manager', status: 'inactive' },
    ]);

    expect(await findUserByCpf(app.db, '20000000001')).toEqual({
      id: agent,
      email: null,
      hasPanelAccess: false,
    });
    expect(await findUserByCpf(app.db, '20000000002')).toEqual({
      id: manager,
      email: 'gestor@acesso.dev',
      hasPanelAccess: true,
    });
    expect(await findUserByCpf(app.db, '20000000003')).toMatchObject({ hasPanelAccess: false });
    expect(await findUserByCpf(app.db, '20000000004')).toMatchObject({
      id: admin,
      hasPanelAccess: true,
    });
    expect(await findUserByCpf(app.db, '29999999999')).toBeNull();
  });
});

describe('sessões e aparelhos', () => {
  async function createSession(values: Partial<PgInsertValue<typeof sessions>> = {}) {
    const tokenHash = randomUUID();
    const [session] = await owner.db
      .insert(sessions)
      .values({ userId: userA, audience: 'app', refreshTokenHash: tokenHash, ...values })
      .returning();
    return { id: session!.id, tokenHash };
  }

  it('sessionForRefresh', async () => {
    // Devolve a sessão ativa e marca a conta como ativa agora.
    await owner.db
      .update(users)
      .set({ lastActiveAt: daysAgo(30) })
      .where(eq(users.id, userA));
    const active = await createSession();
    expect(await sessionForRefresh(app.db, active.tokenHash)).toEqual({
      sessionId: active.id,
      userId: userA,
      audience: 'app',
    });
    const [user] = await owner.db.select().from(users).where(eq(users.id, userA));
    expect(user!.lastActiveAt!.getTime()).toBeGreaterThan((await dbNow()) - 60 * 1000);

    // Painel: o prazo se renova a cada uso.
    const panel = await createSession({
      audience: 'panel',
      idleTimeoutSeconds: 12 * 60 * 60,
      expiresAt: minutesAhead(1),
    });
    expect(await sessionForRefresh(app.db, panel.tokenHash)).toMatchObject({ audience: 'panel' });
    const [renewed] = await owner.db.select().from(sessions).where(eq(sessions.id, panel.id));
    expect(renewed!.expiresAt!.getTime()).toBeGreaterThan((await dbNow()) + 11 * 60 * 60 * 1000);

    // Ignora sessão revogada.
    const revoked = await createSession({ revokedAt: new Date() });
    expect(await sessionForRefresh(app.db, revoked.tokenHash)).toBeNull();

    // Ignora sessão do painel vencida.
    const expired = await createSession({
      audience: 'panel',
      idleTimeoutSeconds: 12 * 60 * 60,
      expiresAt: minutesAgo(1),
    });
    expect(await sessionForRefresh(app.db, expired.tokenHash)).toBeNull();

    // Ignora conta congelada.
    const frozenUser = await createUser(owner.db, { name: 'Congelada', phone: '+5511950000401' });
    const frozen = await createSession({ userId: frozenUser });
    await owner.db.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenUser));
    expect(await sessionForRefresh(app.db, frozen.tokenHash)).toBeNull();

    expect(await sessionForRefresh(app.db, 'inexistente')).toBeNull();
  });

  it('sessões e aparelhos só da própria conta', async () => {
    await createSession({ userId: userB });
    await owner.db.insert(devices).values({
      userId: userB,
      installationId: randomUUID(),
      platform: 'ios',
      appVersion: '1.0.0',
    });

    await withContext(app.db, { userId: userA }, async (tx) => {
      await tx.insert(sessions).values({
        userId: userA,
        audience: 'app',
        refreshTokenHash: randomUUID(),
      });
      await tx.insert(devices).values({
        userId: userA,
        installationId: randomUUID(),
        platform: 'android',
        appVersion: '1.0.0',
      });
    });

    const seen = await withContext(app.db, { userId: userA }, async (tx) => ({
      sessions: await tx.select().from(sessions),
      devices: await tx.select().from(devices),
    }));
    expect(seen.sessions.length).toBeGreaterThan(0);
    expect(seen.devices.length).toBeGreaterThan(0);
    expect(seen.sessions.every((s) => s.userId === userA)).toBe(true);
    expect(seen.devices.every((d) => d.userId === userA)).toBe(true);

    expect(
      await dbError(
        withContext(app.db, { userId: userA }, (tx) =>
          tx
            .insert(sessions)
            .values({ userId: userB, audience: 'app', refreshTokenHash: randomUUID() }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await dbError(
        withContext(app.db, { userId: userA }, (tx) =>
          tx.insert(devices).values({
            userId: userB,
            installationId: randomUUID(),
            platform: 'android',
            appVersion: '1.0.0',
          }),
        ),
      ),
    ).toMatch(/row-level security/);

    // Sair revoga a sessão; o resto da sessão não muda por UPDATE direto.
    const revoked = await withContext(app.db, { userId: userA }, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, userA))
        .returning({ id: sessions.id }),
    );
    expect(revoked.length).toBeGreaterThan(0);
    expect(
      await dbError(
        withContext(app.db, { userId: userA }, (tx) =>
          tx.update(sessions).set({ refreshTokenHash: 'trocado' }),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('client_actions recusa user_id de outra pessoa', async () => {
    const error = await dbError(
      withContext(app.db, { tenantId, userId: userA }, (tx) =>
        tx.insert(clientActions).values({
          id: randomUUID(),
          tenantId,
          userId: userB,
          kind: 'work_order.start',
          response: { ok: true },
        }),
      ),
    );
    expect(error).toMatch(/row-level security/);

    await withContext(app.db, { tenantId, userId: userA }, (tx) =>
      tx.insert(clientActions).values({
        id: randomUUID(),
        tenantId,
        userId: userA,
        kind: 'work_order.start',
        response: { ok: true },
      }),
    );
  });

  it('a conta grava a versão dos Termos aceita', async () => {
    const accepted = await withContext(app.db, { userId: userA }, (tx) =>
      tx
        .update(users)
        .set({ termsVersion: '2026-10-23', termsAcceptedAt: sql`now()` })
        .where(eq(users.id, userA))
        .returning({ termsVersion: users.termsVersion }),
    );
    expect(accepted).toEqual([{ termsVersion: '2026-10-23' }]);
  });
});
