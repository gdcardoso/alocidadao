import { randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import type { FastifyBaseLogger } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailSender } from '../messaging/email.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { resendInvite, sendInvite, type InviteTarget } from './send.js';

const { inviteDeliveries, users } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
});

const LINKS = { panelUrl: 'http://painel.teste', playStoreUrl: null, appStoreUrl: null };

function fakeLog() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger & {
    warn: ReturnType<typeof vi.fn>;
  };
}

function recorder(fail = false) {
  const sent: EmailMessage[] = [];
  const email: EmailSender = {
    send: async (msg) => {
      if (fail) throw new Error('provedor fora do ar');
      sent.push(msg);
    },
  };
  return { sent, email };
}

const deliveriesOf = (userId: string, tenantId: string) =>
  owner.db
    .select()
    .from(inviteDeliveries)
    .where(and(eq(inviteDeliveries.userId, userId), eq(inviteDeliveries.tenantId, tenantId)));

async function managerTarget() {
  const tenantId = await fx.createTenant('active');
  const adminId = await fx.newAdmin(tenantId);
  const managerId = await fx.newManager(tenantId, []);
  const to = `gestor.${randomUUID()}@teste.dev`;
  await owner.db.update(users).set({ email: to }).where(eq(users.id, managerId));
  const target: InviteTarget = {
    kind: 'panel',
    userId: managerId,
    tenantId,
    to,
    name: 'Gestor Teste',
    tenantName: 'Prefeitura do Painel',
    role: 'manager',
  };
  return { tenantId, adminId, managerId, target };
}

describe('sendInvite', () => {
  it('records the delivery and sends the panel invite', async () => {
    const { tenantId, adminId, managerId, target } = await managerTarget();
    const { sent, email } = recorder();
    const log = fakeLog();

    await sendInvite(
      { db: appDb.db, email, links: LINKS, log },
      { tenantId, userId: adminId },
      target,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: target.to,
      fromName: 'Alô Cidadão · Prefeitura do Painel',
    });
    expect(sent[0]!.text).toContain('Gestor');
    const rows = await deliveriesOf(managerId, tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'panel', sentBy: adminId });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a failing sender is logged and does not throw', async () => {
    const { tenantId, adminId, managerId, target } = await managerTarget();
    const { email } = recorder(true);
    const log = fakeLog();

    await expect(
      sendInvite({ db: appDb.db, email, links: LINKS, log }, { tenantId, userId: adminId }, target),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ kind: 'panel', userId: managerId });
    // A entrega não fica registrada: o envio falhou.
    expect(await deliveriesOf(managerId, tenantId)).toHaveLength(0);
  });

  it('a caller without permission is logged and nothing is sent', async () => {
    const { tenantId, target } = await managerTarget();
    const outsider = await fx.createUser('Sem Vínculo');
    const { sent, email } = recorder();
    const log = fakeLog();

    await sendInvite(
      { db: appDb.db, email, links: LINKS, log },
      { tenantId, userId: outsider },
      target,
    );

    expect(sent).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe('resendInvite', () => {
  it('sends, then refuses another resend within the interval', async () => {
    const { tenantId, adminId, target } = await managerTarget();
    const { sent, email } = recorder();
    const deps = { db: appDb.db, email, links: LINKS, log: fakeLog() };

    const first = await resendInvite(deps, { tenantId, userId: adminId }, target);
    expect(first).toEqual({ maskedEmail: expect.stringContaining('•••@teste.dev') });
    expect(sent).toHaveLength(1);

    const second = await resendInvite(deps, { tenantId, userId: adminId }, target);
    expect(second).toEqual({ retryAfterSeconds: expect.any(Number) });
    const wait = (second as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(sent).toHaveLength(1);
  });

  it('a failing sender throws and does not count for the interval', async () => {
    const { tenantId, adminId, managerId, target } = await managerTarget();
    const deps = { db: appDb.db, email: recorder(true).email, links: LINKS, log: fakeLog() };

    await expect(resendInvite(deps, { tenantId, userId: adminId }, target)).rejects.toThrow(
      'provedor fora do ar',
    );
    expect(await deliveriesOf(managerId, tenantId)).toHaveLength(0);
  });
});
