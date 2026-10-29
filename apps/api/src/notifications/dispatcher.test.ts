import { randomUUID } from 'node:crypto';
import { createDatabase, schema, withContext } from '@alocidadao/db';
import { completionEmail, type GeoPoint } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { EmailMessage, EmailSender } from '../messaging/email.js';
import { addDays, todayInSaoPaulo } from '../panel/occurrences.js';
import type { PushMessage, PushResult, PushSender } from '../push/types.js';
import { panelAuthHeader } from '../test/panel.js';
import { daysAgo, panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { DISPATCH_CONCURRENCY, dispatchNotifications } from './dispatcher.js';

const { devices, notificationOutbox, users, workOrders } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const CENTER: GeoPoint = { lat: -23.2, lng: -47.2 };

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ database: appDb.db, auth: testAuthOptions });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

// A fila é do banco inteiro: linhas de outros testes (gatilho) não podem entrar no lote.
beforeEach(async () => {
  await owner.db.execute(
    sql`update notification_outbox set status = 'skipped' where status = 'pending'`,
  );
});

type Behavior = PushResult | Error;

/** Sender falso: grava cada envio e responde pelo token (padrão: enviado). */
function fakeSender(behavior: Record<string, Behavior> = {}) {
  const calls: { token: string; message: PushMessage }[] = [];
  const sender: PushSender = {
    send: async (token, message) => {
      calls.push({ token, message });
      const result = behavior[token] ?? { kind: 'sent' };
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { sender, calls };
}

function fakeEmail() {
  const sent: EmailMessage[] = [];
  const email: EmailSender = {
    send: async (msg) => {
      sent.push(msg);
    },
  };
  return { email, sent };
}

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function deps(
  push: { android?: PushSender; ios?: PushSender } = {},
  email: EmailSender = fakeEmail().email,
  log = fakeLog(),
) {
  return {
    db: appDb.db,
    push: {
      android: push.android ?? fakeSender().sender,
      ios: push.ios ?? fakeSender().sender,
    },
    email,
    log,
  };
}

/** Solicitação aberta de um cidadão (com e-mail), numa prefeitura nova. */
async function citizenRequest() {
  const seed = await fx.seedPanelTenant();
  const occurrenceId = await fx.addOccurrence(seed.tenantId, {
    categoryId: seed.potholeId,
    at: CENTER,
    createdAt: daysAgo(1),
  });
  const request = await fx.addRequest(seed.tenantId, {
    occurrenceId,
    categoryId: seed.potholeId,
    citizenId: seed.citizenId,
    at: CENTER,
  });
  return { seed, occurrenceId, request };
}

async function addDevice(
  userId: string,
  platform: 'android' | 'ios',
  pushToken: string | null = `tok-${randomUUID()}`,
) {
  await owner.db.insert(devices).values({
    userId,
    installationId: randomUUID(),
    platform,
    appVersion: '1.0.0',
    pushToken,
  });
  return pushToken!;
}

async function queue(input: {
  tenantId: string;
  userId: string;
  kind: string;
  protocol: string;
  channel?: 'push' | 'email';
  requestId?: string;
  workOrderId?: string;
}) {
  const [row] = await owner.db
    .insert(notificationOutbox)
    .values({ channel: 'push', ...input })
    .returning({ id: notificationOutbox.id });
  return row!.id;
}

async function outboxRow(id: string) {
  const [row] = await owner.db
    .select({
      status: notificationOutbox.status,
      attempts: notificationOutbox.attempts,
      lastError: notificationOutbox.lastError,
      sentAt: notificationOutbox.sentAt,
      retryIn: sql<number>`extract(epoch from ${notificationOutbox.nextAttemptAt} - now())::float`,
    })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.id, id));
  return row!;
}

async function deviceToken(token: string) {
  return owner.db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.pushToken, token));
}

describe('dispatchNotifications', () => {
  it('dispatches a citizen push to every device and marks sent', async () => {
    const { seed, request } = await citizenRequest();
    const androidToken = await addDevice(seed.citizenId, 'android');
    const iosToken = await addDevice(seed.citizenId, 'ios');
    await addDevice(seed.citizenId, 'android', null);
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_in_progress',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender();
    const ios = fakeSender();

    expect(await dispatchNotifications(deps({ android: android.sender, ios: ios.sender }))).toBe(1);

    const expected: PushMessage = {
      title: 'Alô Cidadão',
      body: `Solicitação ${request.protocol}: em atendimento`,
      data: { kind: 'request_in_progress', tenantId: seed.tenantId, requestId: request.id },
    };
    expect(android.calls).toEqual([{ token: androidToken, message: expected }]);
    expect(ios.calls).toEqual([{ token: iosToken, message: expected }]);
    const row = await outboxRow(id);
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row.sentAt).not.toBeNull();
  });

  it('processes at most DISPATCH_CONCURRENCY rows at a time', async () => {
    const { seed, request } = await citizenRequest();
    await addDevice(seed.citizenId, 'android');
    const total = DISPATCH_CONCURRENCY * 3 + 2;
    const ids = [];
    for (let i = 0; i < total; i++) {
      ids.push(
        await queue({
          tenantId: seed.tenantId,
          userId: seed.citizenId,
          kind: 'request_in_progress',
          protocol: request.protocol,
          requestId: request.id,
        }),
      );
    }
    let inFlight = 0;
    let peak = 0;
    const android: PushSender = {
      send: async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        return { kind: 'sent' };
      },
    };

    expect(await dispatchNotifications(deps({ android }))).toBe(total);

    expect(peak).toBe(DISPATCH_CONCURRENCY);
    for (const id of ids) expect((await outboxRow(id)).status).toBe('sent');
  });

  it('sends once per distinct token', async () => {
    const { seed, request } = await citizenRequest();
    const token = await addDevice(seed.citizenId, 'android');
    // Mesmo token em dois registros (antes da limpeza do registro, por exemplo).
    await addDevice(seed.citizenId, 'android', token);
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_rejected',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender();

    await dispatchNotifications(deps({ android: android.sender }));
    // Uma segunda rodada não reenvia o que já foi enviado.
    await dispatchNotifications(deps({ android: android.sender }));

    expect(android.calls.map((c) => c.token)).toEqual([token]);
    expect((await outboxRow(id)).status).toBe('sent');
  });

  it('invalid token clears it and still marks sent when another device received', async () => {
    const { seed, request } = await citizenRequest();
    const dead = await addDevice(seed.citizenId, 'android');
    const alive = await addDevice(seed.citizenId, 'ios');
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_reopened',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender({ [dead]: { kind: 'invalid_token' } });
    const ios = fakeSender();

    await dispatchNotifications(deps({ android: android.sender, ios: ios.sender }));

    expect(await deviceToken(dead)).toEqual([]);
    expect(await deviceToken(alive)).toEqual([{ userId: seed.citizenId }]);
    expect((await outboxRow(id)).status).toBe('sent');

    // Só tokens recusados: nada foi entregue, a linha é pulada.
    const onlyDead = await addDevice(seed.citizenId, 'android');
    await owner.db.update(devices).set({ pushToken: null }).where(eq(devices.pushToken, alive));
    const second = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_reopened',
      protocol: request.protocol,
      requestId: request.id,
    });
    await dispatchNotifications(
      deps({ android: fakeSender({ [onlyDead]: { kind: 'invalid_token' } }).sender }),
    );
    expect(await outboxRow(second)).toMatchObject({
      status: 'skipped',
      lastError: 'invalid_token',
    });
  });

  it('skips a push without any device token', async () => {
    const { seed, request } = await citizenRequest();
    await addDevice(seed.citizenId, 'android', null);
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_in_progress',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender();

    await dispatchNotifications(deps({ android: android.sender }));

    expect(android.calls).toEqual([]);
    expect(await outboxRow(id)).toMatchObject({ status: 'skipped', lastError: 'no_device' });
  });

  it('retry reschedules with the backoff and fails after the fifth attempt', async () => {
    const { seed, request } = await citizenRequest();
    const token = await addDevice(seed.citizenId, 'android');
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_in_progress',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender({ [token]: { kind: 'retry', reason: 'server_error_503' } });

    for (const [attempt, wait] of [
      [1, 60],
      [2, 300],
      [3, 1800],
      [4, 7200],
    ] as const) {
      await dispatchNotifications(deps({ android: android.sender }));
      const row = await outboxRow(id);
      expect(row).toMatchObject({ status: 'pending', attempts: attempt });
      expect(row.lastError).toContain('server_error_503');
      expect(row.retryIn).toBeGreaterThan(wait - 10);
      expect(row.retryIn).toBeLessThanOrEqual(wait);
      // Antes da espera, a linha não volta.
      await dispatchNotifications(deps({ android: android.sender }));
      expect(android.calls).toHaveLength(attempt);
      await owner.db
        .update(notificationOutbox)
        .set({ nextAttemptAt: sql`now()` })
        .where(eq(notificationOutbox.id, id));
    }

    await dispatchNotifications(deps({ android: android.sender }));
    expect(await outboxRow(id)).toMatchObject({ status: 'failed', attempts: 5 });
    expect(android.calls).toHaveLength(5);
  });

  it('a device that received makes the row sent even when another asks for retry', async () => {
    const { seed, request } = await citizenRequest();
    const ok = await addDevice(seed.citizenId, 'android');
    const busy = await addDevice(seed.citizenId, 'ios');
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_in_progress',
      protocol: request.protocol,
      requestId: request.id,
    });
    const android = fakeSender();
    const ios = fakeSender({ [busy]: { kind: 'retry', reason: 'server_error_503' } });

    await dispatchNotifications(deps({ android: android.sender, ios: ios.sender }));
    const row = await outboxRow(id);
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row.lastError).toContain('server_error_503');

    // Nada volta à fila: quem já recebeu não recebe de novo.
    await owner.db
      .update(notificationOutbox)
      .set({ nextAttemptAt: sql`now()` })
      .where(eq(notificationOutbox.id, id));
    expect(await dispatchNotifications(deps({ android: android.sender, ios: ios.sender }))).toBe(0);
    expect(android.calls.map((c) => c.token)).toEqual([ok]);
    expect(ios.calls.map((c) => c.token)).toEqual([busy]);
  });

  it('a throwing sender reschedules and the loop keeps going', async () => {
    const first = await citizenRequest();
    const second = await citizenRequest();
    const broken = await addDevice(first.seed.citizenId, 'android');
    const fine = await addDevice(second.seed.citizenId, 'android');
    const brokenRow = await queue({
      tenantId: first.seed.tenantId,
      userId: first.seed.citizenId,
      kind: 'request_in_progress',
      protocol: first.request.protocol,
      requestId: first.request.id,
    });
    const fineRow = await queue({
      tenantId: second.seed.tenantId,
      userId: second.seed.citizenId,
      kind: 'request_in_progress',
      protocol: second.request.protocol,
      requestId: second.request.id,
    });
    const android = fakeSender({ [broken]: new Error('FCM fora do ar') });
    const log = fakeLog();

    expect(await dispatchNotifications(deps({ android: android.sender }, undefined, log))).toBe(2);

    expect(android.calls.map((c) => c.token).toSorted()).toEqual([broken, fine].toSorted());
    const failed = await outboxRow(brokenRow);
    expect(failed).toMatchObject({ status: 'pending', attempts: 1 });
    expect(failed.lastError).toContain('FCM fora do ar');
    expect(failed.retryIn).toBeGreaterThan(50);
    expect((await outboxRow(fineRow)).status).toBe('sent');
    expect(log.error).toHaveBeenCalled();
  });

  it('email row sends the completion email', async () => {
    const { seed, request } = await citizenRequest();
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_awaiting_confirmation',
      protocol: request.protocol,
      requestId: request.id,
      channel: 'email',
    });
    const { email, sent } = fakeEmail();

    await dispatchNotifications(deps({}, email));

    expect(sent).toEqual([{ to: seed.citizen.email, ...completionEmail(request.protocol) }]);
    expect((await outboxRow(id)).status).toBe('sent');

    // Sem e-mail na conta: a linha é pulada.
    await owner.db.update(users).set({ email: null }).where(eq(users.id, seed.citizenId));
    const second = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_awaiting_confirmation',
      protocol: request.protocol,
      requestId: request.id,
      channel: 'email',
    });
    await dispatchNotifications(deps({}, email));
    expect(sent).toHaveLength(1);
    expect(await outboxRow(second)).toMatchObject({ status: 'skipped', lastError: 'no_email' });
  });

  it('a failing email reschedules', async () => {
    const { seed, request } = await citizenRequest();
    const id = await queue({
      tenantId: seed.tenantId,
      userId: seed.citizenId,
      kind: 'request_awaiting_confirmation',
      protocol: request.protocol,
      requestId: request.id,
      channel: 'email',
    });
    const email: EmailSender = {
      send: async () => {
        throw new Error('Resend recusou o e-mail: 500');
      },
    };

    await dispatchNotifications(deps({}, email));

    const row = await outboxRow(id);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.lastError).toContain('Resend recusou');
  });

  it('assigning an occurrence end to end queues pushes for the citizen and the agents', async () => {
    const { seed, occurrenceId, request } = await citizenRequest();
    const { tenantId } = seed;
    const managerId = await fx.newManager(tenantId, [seed.worksId]);
    const teamId = await fx.addTeam(tenantId, { departmentId: seed.worksId, name: 'Equipe Push' });
    const agentId = await fx.addAgent(tenantId, teamId, 'active');
    const citizenToken = await addDevice(seed.citizenId, 'android');
    const agentToken = await addDevice(agentId, 'ios');
    // O gestor que atribui não recebe nada.
    await addDevice(managerId, 'android');

    const response = await app.inject({
      method: 'POST',
      url: `/panel/occurrences/${occurrenceId}/assign`,
      headers: await panelAuthHeader(appDb.db, managerId, tenantId),
      payload: { teamId, dueDate: addDays(todayInSaoPaulo(), 3), instructions: null },
    });
    expect(response.statusCode).toBe(200);
    const [order] = await withContext(owner.db, { tenantId }, (tx) =>
      tx.select().from(workOrders).where(eq(workOrders.occurrenceId, occurrenceId)),
    );

    const android = fakeSender();
    const ios = fakeSender();
    expect(await dispatchNotifications(deps({ android: android.sender, ios: ios.sender }))).toBe(2);

    expect(android.calls).toEqual([
      {
        token: citizenToken,
        message: {
          title: 'Alô Cidadão',
          body: `Solicitação ${request.protocol}: em atendimento`,
          data: { kind: 'request_in_progress', tenantId, requestId: request.id },
        },
      },
    ]);
    expect(ios.calls).toEqual([
      {
        token: agentToken,
        message: {
          title: 'Alô Cidadão',
          body: `Nova atividade: ${request.protocol}`,
          data: { kind: 'work_order_assigned', tenantId, workOrderId: order!.id },
        },
      },
    ]);
  });
});
