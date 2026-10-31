import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext } from './client.js';
import {
  autoConfirmRequests,
  claimNotifications,
  claimPushToken,
  cleanupNotifications,
  clearPushToken,
  finishNotification,
} from './notifications.js';
import {
  categories,
  departmentManagers,
  departments,
  devices,
  memberships,
  notificationOutbox,
  occurrences,
  panelNotifications,
  photos,
  requests,
  statusEvents,
  teamMembers,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono do banco prepara os dados; os testes rodam como app_user, a mesma conexão da API.

const { db: owner, pool: ownerPool } = createDatabase(TEST_OWNER_URL);
const { db: app, pool: appPool } = createDatabase(TEST_APP_URL);

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
const occurrenceIds: Record<string, string> = {};

/** Mensagem original do Postgres (o Drizzle embrulha o erro). */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error && current.cause) current = current.cause;
    return (current as Error).message;
  }
  return '';
}

async function seedTenant(label: string, ibgeCode: string) {
  const [tenant] = await owner
    .insert(tenants)
    .values({
      name: `Município ${label}`,
      displayName: `Prefeitura ${label}`,
      city: label,
      state: 'SP',
      ibgeCode,
      status: 'active',
    })
    .returning();
  const tenantId = tenant!.id;
  const [department] = await owner
    .insert(departments)
    .values({ tenantId, name: 'Obras' })
    .returning();
  const [category] = await owner
    .insert(categories)
    .values({ tenantId, departmentId: department!.id, name: 'Buraco' })
    .returning();
  const [occurrence] = await owner
    .insert(occurrences)
    .values({
      tenantId,
      categoryId: category!.id,
      location: geoPoint({ lat: -23.55, lng: -46.63 }),
    })
    .returning();
  occurrenceIds[tenantId] = occurrence!.id;
  return tenantId;
}

async function seedUser(label: string) {
  const [user] = await owner
    .insert(users)
    .values({
      name: label,
      email: `${label}.${randomUUID()}@teste.dev`,
      phone: `+5511${Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, '9')}`,
    })
    .returning();
  return user!.id;
}

function notice(tenantId: string, userId: string, protocol: string) {
  return {
    tenantId,
    userId,
    kind: 'occurrence_new',
    protocol,
    occurrenceId: occurrenceIds[tenantId]!,
  };
}

beforeAll(async () => {
  tenantA = await seedTenant('Notif A', '9100001');
  tenantB = await seedTenant('Notif B', '9100002');
  userA = await seedUser('gestora-a');
  userB = await seedUser('gestor-b');
  await owner
    .insert(panelNotifications)
    .values([
      notice(tenantA, userA, 'A-1'),
      notice(tenantA, userB, 'A-2'),
      notice(tenantB, userA, 'B-1'),
    ]);
  await owner.insert(notificationOutbox).values({
    tenantId: tenantA,
    userId: userA,
    channel: 'push',
    kind: 'occurrence_new',
    protocol: 'A-1',
  });
});

afterAll(async () => {
  await ownerPool.end();
  await appPool.end();
});

describe('avisos do sino e fila de envio', () => {
  it('cada pessoa só vê os próprios avisos do sino da prefeitura atual', async () => {
    const rows = await withContext(app, { tenantId: tenantA, userId: userA }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(rows.map((row) => row.protocol)).toEqual(['A-1']);

    const other = await withContext(app, { tenantId: tenantA, userId: userB }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(other.map((row) => row.protocol)).toEqual(['A-2']);

    const otherTenant = await withContext(app, { tenantId: tenantB, userId: userA }, (tx) =>
      tx.select().from(panelNotifications),
    );
    expect(otherTenant.map((row) => row.protocol)).toEqual(['B-1']);

    const noContext = await withContext(app, {}, (tx) => tx.select().from(panelNotifications));
    expect(noContext).toEqual([]);
  });

  it('a pessoa só marca como lido: não altera outras colunas nem cria ou apaga avisos', async () => {
    const context = { tenantId: tenantA, userId: userA };
    const updated = await withContext(app, context, (tx) =>
      tx
        .update(panelNotifications)
        .set({ readAt: new Date() })
        .where(eq(panelNotifications.protocol, 'A-1'))
        .returning({ id: panelNotifications.id }),
    );
    expect(updated).toHaveLength(1);

    const hidden = await withContext(app, context, (tx) =>
      tx
        .update(panelNotifications)
        .set({ readAt: new Date() })
        .where(eq(panelNotifications.protocol, 'A-2'))
        .returning({ id: panelNotifications.id }),
    );
    expect(hidden).toEqual([]);

    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx
            .update(panelNotifications)
            .set({ protocol: 'X' })
            .where(sql`true`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx.insert(panelNotifications).values(notice(tenantA, userA, 'A-3')),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await dbError(withContext(app, context, (tx) => tx.delete(panelNotifications)))).toMatch(
      /permission denied/,
    );
  });

  it('app_user não lê a fila', async () => {
    const context = { tenantId: tenantA, userId: userA };
    expect(
      await dbError(withContext(app, context, (tx) => tx.select().from(notificationOutbox))),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withContext(app, context, (tx) =>
          tx.insert(notificationOutbox).values({
            tenantId: tenantA,
            userId: userA,
            channel: 'push',
            kind: 'occurrence_new',
            protocol: 'A-9',
          }),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('a fila só aceita canal e status conhecidos', async () => {
    const base = { tenantId: tenantA, userId: userA, kind: 'occurrence_new', protocol: 'A-1' };
    expect(
      await dbError(owner.insert(notificationOutbox).values({ ...base, channel: 'sms' as never })),
    ).toMatch(/notification_outbox_channel_check|violates check/);
    expect(
      await dbError(
        owner
          .insert(notificationOutbox)
          .values({ ...base, channel: 'push', status: 'lost' as never }),
      ),
    ).toMatch(/notification_outbox_status_check|violates check/);
  });
});

// Gatilho dos avisos (0033): cada evento de status gravado como as ações da API gravam gera as
// linhas da fila (push e e-mail) e do sino. As pessoas da prefeitura são as mesmas em todos os
// testes; cada teste cria a própria ocorrência e confere só os avisos dela.

type EventValues = typeof statusEvents.$inferInsert;
type Role = 'field_agent' | 'manager' | 'tenant_admin';

interface Town {
  tenantId: string;
  departmentId: string;
  categoryId: string;
  teamId: string;
  admin: string;
  manager: string;
  managerAdmin: string;
  otherManager: string;
  inactiveManager: string;
  frozenManager: string;
  deletedAdmin: string;
  agent1: string;
  agent2: string;
  inactiveAgent: string;
  frozenAgent: string;
  otherTownAdmin: string;
}

let town: Town;
const POINT = { lat: -23.55, lng: -46.63 };

async function role(tenantId: string, userId: string, value: Role, status = 'active' as const) {
  await owner.insert(memberships).values({ tenantId, userId, role: value, status });
}

async function inactiveRole(tenantId: string, userId: string, value: Role) {
  await owner.insert(memberships).values({ tenantId, userId, role: value, status: 'inactive' });
}

async function seedTown(): Promise<Town> {
  const tenantId = await seedTenant('Notif Gatilho', '9100003');
  const otherTenantId = await seedTenant('Notif Gatilho B', '9100004');
  const [department] = await owner
    .insert(departments)
    .values({ tenantId, name: 'Iluminação' })
    .returning();
  const [otherDepartment] = await owner
    .insert(departments)
    .values({ tenantId, name: 'Limpeza' })
    .returning();
  const [category] = await owner
    .insert(categories)
    .values({ tenantId, departmentId: department!.id, name: 'Poste apagado' })
    .returning();
  const [team] = await owner
    .insert(teams)
    .values({ tenantId, departmentId: department!.id, name: 'Equipe Luz' })
    .returning();
  const departmentId = department!.id;
  const teamId = team!.id;

  const admin = await seedUser('admin');
  await role(tenantId, admin, 'tenant_admin');

  const manager = await seedUser('gestor');
  await role(tenantId, manager, 'manager');
  const managerAdmin = await seedUser('gestora-admin');
  await role(tenantId, managerAdmin, 'manager');
  await role(tenantId, managerAdmin, 'tenant_admin');
  const otherManager = await seedUser('gestor-outro-setor');
  await role(tenantId, otherManager, 'manager');
  const inactiveManager = await seedUser('gestor-inativo');
  await inactiveRole(tenantId, inactiveManager, 'manager');
  const frozenManager = await seedUser('gestor-congelado');
  await role(tenantId, frozenManager, 'manager');
  await owner.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenManager));
  const deletedAdmin = await seedUser('admin-excluido');
  await role(tenantId, deletedAdmin, 'tenant_admin');
  await owner.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deletedAdmin));
  await owner.insert(departmentManagers).values([
    { tenantId, departmentId, userId: manager },
    { tenantId, departmentId, userId: managerAdmin },
    { tenantId, departmentId: otherDepartment!.id, userId: otherManager },
    { tenantId, departmentId, userId: inactiveManager },
    { tenantId, departmentId, userId: frozenManager },
  ]);

  const agent1 = await seedUser('agente-1');
  const agent2 = await seedUser('agente-2');
  const inactiveAgent = await seedUser('agente-inativo');
  const frozenAgent = await seedUser('agente-congelado');
  await role(tenantId, agent1, 'field_agent');
  await role(tenantId, agent2, 'field_agent');
  await inactiveRole(tenantId, inactiveAgent, 'field_agent');
  await role(tenantId, frozenAgent, 'field_agent');
  await owner.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenAgent));
  await owner
    .insert(teamMembers)
    .values(
      [agent1, agent2, inactiveAgent, frozenAgent].map((userId) => ({ tenantId, teamId, userId })),
    );

  // Admin de outra prefeitura: nunca recebe aviso desta.
  const otherTownAdmin = await seedUser('admin-outra-prefeitura');
  await role(otherTenantId, otherTownAdmin, 'tenant_admin');

  return {
    tenantId,
    departmentId,
    categoryId: category!.id,
    teamId,
    admin,
    manager,
    managerAdmin,
    otherManager,
    inactiveManager,
    frozenManager,
    deletedAdmin,
    agent1,
    agent2,
    inactiveAgent,
    frozenAgent,
    otherTownAdmin,
  };
}

/** Quem recebe o sino desta prefeitura: gestores do setor e admins, ativos. */
const bellRecipients = () => [town.admin, town.manager, town.managerAdmin].toSorted();

async function newOccurrence(
  status: 'triage' | 'in_progress' | 'awaiting_confirmation' = 'triage',
) {
  const [occurrence] = await owner
    .insert(occurrences)
    .values({
      tenantId: town.tenantId,
      categoryId: town.categoryId,
      location: geoPoint(POINT),
      status,
    })
    .returning();
  return occurrence!.id;
}

async function newRequest(
  occurrenceId: string,
  citizenId: string,
  status: 'open' | 'in_progress' | 'awaiting_confirmation' = 'open',
  createdAt = new Date(),
) {
  return withContext(owner, { tenantId: town.tenantId }, async (tx) => {
    const [request] = await tx
      .insert(requests)
      .values({
        tenantId: town.tenantId,
        citizenId,
        categoryId: town.categoryId,
        occurrenceId,
        status,
        description: 'Poste apagado na esquina',
        location: geoPoint(POINT),
        gpsLocation: geoPoint(POINT),
        createdAt,
      })
      .returning();
    return { id: request!.id, protocol: request!.protocol };
  });
}

async function newWorkOrder(
  occurrenceId: string,
  status: 'assigned' | 'in_execution' | 'impeded' | 'awaiting_review' = 'assigned',
) {
  const [order] = await owner
    .insert(workOrders)
    .values({ tenantId: town.tenantId, occurrenceId, teamId: town.teamId, status })
    .returning();
  return order!.id;
}

/** Eventos gravados numa transação só, como numa ação da API. */
async function events(...values: Omit<EventValues, 'tenantId'>[]) {
  await owner.transaction(async (tx) => {
    for (const value of values) {
      await tx.insert(statusEvents).values({ tenantId: town.tenantId, ...value });
    }
  });
}

async function outbox(filter: { requestId?: string; workOrderId?: string }) {
  const rows = await owner
    .select({
      userId: notificationOutbox.userId,
      channel: notificationOutbox.channel,
      kind: notificationOutbox.kind,
      protocol: notificationOutbox.protocol,
      requestId: notificationOutbox.requestId,
      workOrderId: notificationOutbox.workOrderId,
      details: notificationOutbox.details,
      status: notificationOutbox.status,
      tenantId: notificationOutbox.tenantId,
    })
    .from(notificationOutbox)
    .where(
      filter.requestId
        ? eq(notificationOutbox.requestId, filter.requestId)
        : eq(notificationOutbox.workOrderId, filter.workOrderId!),
    )
    .orderBy(asc(notificationOutbox.userId), asc(notificationOutbox.channel));
  return rows;
}

async function bell(occurrenceId: string, kind?: string) {
  return owner
    .select({
      userId: panelNotifications.userId,
      tenantId: panelNotifications.tenantId,
      kind: panelNotifications.kind,
      protocol: panelNotifications.protocol,
      occurrenceId: panelNotifications.occurrenceId,
      workOrderId: panelNotifications.workOrderId,
      details: panelNotifications.details,
      readAt: panelNotifications.readAt,
    })
    .from(panelNotifications)
    .where(
      kind
        ? and(eq(panelNotifications.occurrenceId, occurrenceId), eq(panelNotifications.kind, kind))
        : eq(panelNotifications.occurrenceId, occurrenceId),
    )
    .orderBy(asc(panelNotifications.userId));
}

const userIds = (rows: { userId: string }[]) => rows.map((row) => row.userId).toSorted();

describe('gatilho dos avisos', () => {
  beforeAll(async () => {
    town = await seedTown();
  });

  it('atribuir avisa o cidadão e os agentes da equipe', async () => {
    const citizen = await seedUser('cidada-atribuir');
    const occurrenceId = await newOccurrence('triage');
    const request = await newRequest(occurrenceId, citizen);
    // Como a API: app_user na transação do gestor (actions.ts, atribuir).
    const workOrderId = await withContext(
      app,
      { tenantId: town.tenantId, userId: town.manager },
      async (tx) => {
        const [order] = await tx
          .insert(workOrders)
          .values({ tenantId: town.tenantId, occurrenceId, teamId: town.teamId })
          .returning();
        await tx.insert(statusEvents).values([
          {
            tenantId: town.tenantId,
            occurrenceId,
            workOrderId: order!.id,
            toStatus: 'assigned',
            actorUserId: town.manager,
          },
          {
            tenantId: town.tenantId,
            occurrenceId,
            fromStatus: 'triage',
            toStatus: 'in_progress',
            actorUserId: town.manager,
          },
          {
            tenantId: town.tenantId,
            occurrenceId,
            requestId: request.id,
            fromStatus: 'open',
            toStatus: 'in_progress',
            actorUserId: town.manager,
          },
        ]);
        return order!.id;
      },
    );

    expect(await outbox({ requestId: request.id })).toEqual([
      {
        userId: citizen,
        channel: 'push',
        kind: 'request_in_progress',
        protocol: request.protocol,
        requestId: request.id,
        workOrderId: null,
        details: null,
        status: 'pending',
        tenantId: town.tenantId,
      },
    ]);
    const agents = await outbox({ workOrderId });
    expect(userIds(agents)).toEqual([town.agent1, town.agent2].toSorted());
    for (const row of agents) {
      expect(row).toMatchObject({
        channel: 'push',
        kind: 'work_order_assigned',
        protocol: request.protocol,
        requestId: null,
        workOrderId,
        details: null,
        status: 'pending',
        tenantId: town.tenantId,
      });
    }
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('recusar depois de impedimento avisa o cidadão', async () => {
    const citizen = await seedUser('cidadao-recusa');
    const occurrenceId = await newOccurrence('in_progress');
    const request = await newRequest(occurrenceId, citizen, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'impeded');
    await events(
      {
        occurrenceId,
        workOrderId,
        fromStatus: 'impeded',
        toStatus: 'cancelled',
        actorUserId: town.manager,
      },
      { occurrenceId, fromStatus: 'in_progress', toStatus: 'rejected', actorUserId: town.manager },
      {
        occurrenceId,
        requestId: request.id,
        fromStatus: 'in_progress',
        toStatus: 'rejected',
        actorUserId: town.manager,
      },
    );

    const rows = await outbox({ requestId: request.id });
    expect(rows.map((row) => [row.userId, row.channel, row.kind, row.protocol])).toEqual([
      [citizen, 'push', 'request_rejected', request.protocol],
    ]);
    expect(await outbox({ workOrderId })).toEqual([]);
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('junção com ocorrência em atendimento avisa o cidadão', async () => {
    const citizen = await seedUser('cidadao-juncao');
    const occurrenceId = await newOccurrence('in_progress');
    const request = await newRequest(occurrenceId, citizen, 'open');
    await events({
      occurrenceId,
      requestId: request.id,
      fromStatus: 'open',
      toStatus: 'in_progress',
      actorUserId: town.manager,
      comment: 'Juntada a outra ocorrência',
    });

    const rows = await outbox({ requestId: request.id });
    expect(rows.map((row) => [row.userId, row.channel, row.kind])).toEqual([
      [citizen, 'push', 'request_in_progress'],
    ]);
  });

  it('publicar avisa o cidadão por push e e-mail', async () => {
    const citizenA = await seedUser('cidada-publicar-a');
    const citizenB = await seedUser('cidadao-publicar-b');
    const occurrenceId = await newOccurrence('in_progress');
    const first = await newRequest(occurrenceId, citizenA, 'in_progress');
    const second = await newRequest(occurrenceId, citizenB, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'awaiting_review');
    await events(
      {
        occurrenceId,
        workOrderId,
        fromStatus: 'awaiting_review',
        toStatus: 'completed',
        actorUserId: town.manager,
      },
      {
        occurrenceId,
        fromStatus: 'in_progress',
        toStatus: 'awaiting_confirmation',
        actorUserId: town.manager,
      },
      ...[first, second].map((request) => ({
        occurrenceId,
        requestId: request.id,
        fromStatus: 'in_progress',
        toStatus: 'awaiting_confirmation',
        actorUserId: town.manager,
      })),
    );

    for (const [request, citizen] of [
      [first, citizenA],
      [second, citizenB],
    ] as const) {
      const rows = await outbox({ requestId: request.id });
      expect(rows.map((row) => [row.userId, row.channel, row.kind, row.protocol])).toEqual([
        [citizen, 'email', 'request_awaiting_confirmation', request.protocol],
        [citizen, 'push', 'request_awaiting_confirmation', request.protocol],
      ]);
    }
    expect(await outbox({ workOrderId })).toEqual([]);
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('contestação avisa os outros moradores e o sino, e não quem contestou', async () => {
    const contester = await seedUser('cidada-contesta');
    const neighbor = await seedUser('vizinho');
    const occurrenceId = await newOccurrence('in_progress');
    const contested = await newRequest(occurrenceId, contester, 'awaiting_confirmation');
    const other = await newRequest(occurrenceId, neighbor, 'awaiting_confirmation');
    // Como requests.ts: a do cidadão, as outras (autor vazio) e a ocorrência.
    await events(
      {
        occurrenceId,
        requestId: contested.id,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'open',
        actorUserId: contester,
        comment: 'Continua apagado',
      },
      {
        occurrenceId,
        requestId: other.id,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'open',
        comment: 'Outro morador contestou',
      },
      {
        occurrenceId,
        fromStatus: 'completed',
        toStatus: 'in_progress',
        actorUserId: contester,
      },
    );

    expect(await outbox({ requestId: contested.id })).toEqual([]);
    const reopened = await outbox({ requestId: other.id });
    expect(reopened.map((row) => [row.userId, row.channel, row.kind, row.protocol])).toEqual([
      [neighbor, 'push', 'request_reopened', other.protocol],
    ]);
    const rows = await bell(occurrenceId);
    expect(userIds(rows)).toEqual(bellRecipients());
    for (const row of rows) {
      expect(row).toMatchObject({
        tenantId: town.tenantId,
        kind: 'request_contested',
        protocol: contested.protocol,
        occurrenceId,
        workOrderId: null,
        details: null,
        readAt: null,
      });
    }
  });

  it('cancelar e confirmar não avisam o cidadão; cancelar vai ao sino', async () => {
    const citizen = await seedUser('cidadao-cancela');
    const cancelOccurrence = await newOccurrence('triage');
    const cancelled = await newRequest(cancelOccurrence, citizen, 'open');
    await events(
      {
        occurrenceId: cancelOccurrence,
        requestId: cancelled.id,
        fromStatus: 'open',
        toStatus: 'cancelled',
        actorUserId: citizen,
      },
      {
        occurrenceId: cancelOccurrence,
        fromStatus: 'triage',
        toStatus: 'cancelled',
        actorUserId: citizen,
      },
    );
    expect(await outbox({ requestId: cancelled.id })).toEqual([]);
    const rows = await bell(cancelOccurrence);
    expect(userIds(rows)).toEqual(bellRecipients());
    expect(rows.every((row) => row.kind === 'request_cancelled')).toBe(true);
    expect(rows.every((row) => row.protocol === cancelled.protocol)).toBe(true);

    const confirmOccurrence = await newOccurrence('in_progress');
    const confirmed = await newRequest(confirmOccurrence, citizen, 'awaiting_confirmation');
    await events(
      {
        occurrenceId: confirmOccurrence,
        requestId: confirmed.id,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'completed',
        actorUserId: citizen,
      },
      {
        occurrenceId: confirmOccurrence,
        fromStatus: 'completed',
        toStatus: 'closed',
        actorUserId: citizen,
      },
    );
    expect(await outbox({ requestId: confirmed.id })).toEqual([]);
    expect(await bell(confirmOccurrence)).toEqual([]);
  });

  it('confirmação automática não avisa ninguém', async () => {
    const citizen = await seedUser('cidadao-auto');
    const occurrenceId = await newOccurrence('in_progress');
    const request = await newRequest(occurrenceId, citizen, 'awaiting_confirmation');
    await events(
      {
        occurrenceId,
        requestId: request.id,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'completed',
      },
      { occurrenceId, fromStatus: 'completed', toStatus: 'closed' },
    );
    expect(await outbox({ requestId: request.id })).toEqual([]);
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('ocorrência nova vai ao sino; apoio a ocorrência na fila não vai', async () => {
    const author = await seedUser('cidada-nova');
    const supporter = await seedUser('cidadao-apoio');
    const occurrenceId = await newOccurrence('triage');
    const first = await newRequest(occurrenceId, author);
    await events({
      occurrenceId,
      requestId: first.id,
      toStatus: 'open',
      actorUserId: author,
    });
    const second = await newRequest(occurrenceId, supporter);
    await events({
      occurrenceId,
      requestId: second.id,
      toStatus: 'open',
      actorUserId: supporter,
    });

    const rows = await bell(occurrenceId);
    expect(userIds(rows)).toEqual(bellRecipients());
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'occurrence_new',
        protocol: first.protocol,
        workOrderId: null,
        details: null,
      });
    }
    expect(await outbox({ requestId: first.id })).toEqual([]);
    expect(await outbox({ requestId: second.id })).toEqual([]);

    // Apoio a ocorrência em atendimento: nasce em atendimento, sem aviso.
    const busyOccurrence = await newOccurrence('in_progress');
    const support = await newRequest(busyOccurrence, supporter, 'in_progress');
    await events({
      occurrenceId: busyOccurrence,
      requestId: support.id,
      toStatus: 'in_progress',
      actorUserId: supporter,
    });
    expect(await outbox({ requestId: support.id })).toEqual([]);
    expect(await bell(busyOccurrence)).toEqual([]);
  });

  it('concluir com e sem fotos muda o texto do sino', async () => {
    const citizen = await seedUser('cidadao-concluir');
    const withPhotosOccurrence = await newOccurrence('in_progress');
    await newRequest(withPhotosOccurrence, citizen, 'in_progress');
    const withPhotos = await newWorkOrder(withPhotosOccurrence, 'in_execution');
    // Como agent/actions.ts: as fotos entram antes do evento, na mesma transação.
    await owner.transaction(async (tx) => {
      await tx.insert(photos).values({
        tenantId: town.tenantId,
        workOrderId: withPhotos,
        storageKey: `conclusao-${randomUUID()}`,
        uploadedBy: town.agent1,
        review: 'pending',
        purpose: 'completion',
      });
      await tx.insert(statusEvents).values({
        tenantId: town.tenantId,
        occurrenceId: withPhotosOccurrence,
        workOrderId: withPhotos,
        fromStatus: 'in_execution',
        toStatus: 'awaiting_review',
        actorUserId: town.agent1,
      });
    });
    const rowsWith = await bell(withPhotosOccurrence);
    expect(userIds(rowsWith)).toEqual(bellRecipients());
    for (const row of rowsWith) {
      expect(row).toMatchObject({
        kind: 'work_order_completed',
        workOrderId: withPhotos,
        details: { withPhotos: true },
      });
    }

    // Sem foto nesta conclusão: a foto de uma conclusão anterior (antes do ajuste) não conta.
    const withoutOccurrence = await newOccurrence('in_progress');
    await newRequest(withoutOccurrence, citizen, 'in_progress');
    const without = await newWorkOrder(withoutOccurrence, 'in_execution');
    await owner.insert(photos).values({
      tenantId: town.tenantId,
      workOrderId: without,
      storageKey: `conclusao-antiga-${randomUUID()}`,
      uploadedBy: town.agent1,
      review: 'discarded',
      purpose: 'completion',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await events({
      occurrenceId: withoutOccurrence,
      workOrderId: without,
      fromStatus: 'in_execution',
      toStatus: 'awaiting_review',
      actorUserId: town.agent1,
    });
    const rowsWithout = await bell(withoutOccurrence);
    expect(userIds(rowsWithout)).toEqual(bellRecipients());
    for (const row of rowsWithout) {
      expect(row).toMatchObject({
        kind: 'work_order_completed',
        details: { withPhotos: false },
      });
    }
    expect(await outbox({ workOrderId: withPhotos })).toEqual([]);
    expect(await outbox({ workOrderId: without })).toEqual([]);
  });

  it('impedimento vai ao sino; reagendar não avisa', async () => {
    const citizen = await seedUser('cidadao-impedimento');
    const occurrenceId = await newOccurrence('in_progress');
    const request = await newRequest(occurrenceId, citizen, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'in_execution');
    await events({
      occurrenceId,
      workOrderId,
      fromStatus: 'in_execution',
      toStatus: 'impeded',
      actorUserId: town.agent1,
      details: { reason: 'Rua alagada' },
    });
    const rows = await bell(occurrenceId);
    expect(userIds(rows)).toEqual(bellRecipients());
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'work_order_impeded',
        protocol: request.protocol,
        workOrderId,
        details: null,
      });
    }

    await events({
      occurrenceId,
      workOrderId,
      fromStatus: 'impeded',
      toStatus: 'assigned',
      actorUserId: town.manager,
    });
    expect(await outbox({ workOrderId })).toEqual([]);
    expect(await bell(occurrenceId)).toHaveLength(rows.length);
  });

  it('pedir ajuste avisa os agentes', async () => {
    const citizen = await seedUser('cidadao-ajuste');
    const occurrenceId = await newOccurrence('in_progress');
    const request = await newRequest(occurrenceId, citizen, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'awaiting_review');
    await events({
      occurrenceId,
      workOrderId,
      fromStatus: 'awaiting_review',
      toStatus: 'rework_requested',
      actorUserId: town.manager,
    });
    const rows = await outbox({ workOrderId });
    expect(userIds(rows)).toEqual([town.agent1, town.agent2].toSorted());
    for (const row of rows) {
      expect(row).toMatchObject({
        channel: 'push',
        kind: 'work_order_rework',
        protocol: request.protocol,
        workOrderId,
      });
    }
    expect(await outbox({ requestId: request.id })).toEqual([]);
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('quem agiu não recebe o aviso do sino', async () => {
    const citizen = await seedUser('cidadao-autor');
    const occurrenceId = await newOccurrence('in_progress');
    await newRequest(occurrenceId, citizen, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'in_execution');
    // A gestora que também é admin registra o impedimento: os outros recebem, ela não.
    await events({
      occurrenceId,
      workOrderId,
      fromStatus: 'in_execution',
      toStatus: 'impeded',
      actorUserId: town.managerAdmin,
    });
    expect(userIds(await bell(occurrenceId))).toEqual([town.admin, town.manager].toSorted());

    // O agente que pede o ajuste (caso extremo) também não recebe o próprio push.
    await events({
      occurrenceId,
      workOrderId,
      fromStatus: 'impeded',
      toStatus: 'rework_requested',
      actorUserId: town.agent1,
    });
    expect(userIds(await outbox({ workOrderId }))).toEqual([town.agent2]);
  });

  it('gestor que é admin recebe uma linha só', async () => {
    const citizen = await seedUser('cidada-linha-unica');
    const occurrenceId = await newOccurrence('triage');
    const request = await newRequest(occurrenceId, citizen);
    await events({ occurrenceId, requestId: request.id, toStatus: 'open', actorUserId: citizen });
    const rows = await bell(occurrenceId);
    expect(rows.filter((row) => row.userId === town.managerAdmin)).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  it('gestor de outro setor não recebe', async () => {
    const citizen = await seedUser('cidadao-outro-setor');
    const occurrenceId = await newOccurrence('triage');
    const request = await newRequest(occurrenceId, citizen);
    await events({ occurrenceId, requestId: request.id, toStatus: 'open', actorUserId: citizen });
    const recipients = userIds(await bell(occurrenceId));
    expect(recipients).not.toContain(town.otherManager);
    expect(recipients).not.toContain(town.otherTownAdmin);
    expect(recipients).toEqual(bellRecipients());
  });

  it('vínculo inativo não recebe', async () => {
    const citizen = await seedUser('cidadao-inativo');
    const occurrenceId = await newOccurrence('in_progress');
    await newRequest(occurrenceId, citizen, 'in_progress');
    const workOrderId = await newWorkOrder(occurrenceId, 'assigned');
    await events(
      { occurrenceId, workOrderId, toStatus: 'assigned', actorUserId: town.manager },
      {
        occurrenceId,
        workOrderId,
        fromStatus: 'assigned',
        toStatus: 'impeded',
        actorUserId: town.agent1,
      },
    );
    const agents = userIds(await outbox({ workOrderId }));
    expect(agents).toEqual([town.agent1, town.agent2].toSorted());
    expect(agents).not.toContain(town.inactiveAgent);
    expect(agents).not.toContain(town.frozenAgent);
    const managers = userIds(await bell(occurrenceId));
    expect(managers).toEqual(bellRecipients());
    for (const userId of [town.inactiveManager, town.frozenManager, town.deletedAdmin]) {
      expect(managers).not.toContain(userId);
    }

    // Cidadão com conta congelada também não recebe.
    const frozenCitizen = await seedUser('cidada-congelada');
    await owner.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozenCitizen));
    const other = await newRequest(occurrenceId, frozenCitizen, 'open');
    await events({
      occurrenceId,
      requestId: other.id,
      fromStatus: 'open',
      toStatus: 'in_progress',
      actorUserId: town.manager,
    });
    expect(await outbox({ requestId: other.id })).toEqual([]);
  });

  it('protocolo da atividade é o da solicitação mais antiga', async () => {
    const citizenA = await seedUser('cidada-recente');
    const citizenB = await seedUser('cidadao-antigo');
    const occurrenceId = await newOccurrence('in_progress');
    // A mais antiga é criada depois: o protocolo dela é maior, mas a data é anterior.
    await newRequest(occurrenceId, citizenA, 'in_progress');
    const oldest = await newRequest(
      occurrenceId,
      citizenB,
      'in_progress',
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const workOrderId = await newWorkOrder(occurrenceId, 'assigned');
    await events(
      { occurrenceId, workOrderId, toStatus: 'assigned', actorUserId: town.manager },
      {
        occurrenceId,
        workOrderId,
        fromStatus: 'assigned',
        toStatus: 'awaiting_review',
        actorUserId: town.agent1,
      },
    );
    const pushes = await outbox({ workOrderId });
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.every((row) => row.protocol === oldest.protocol)).toBe(true);
    const rows = await bell(occurrenceId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.protocol === oldest.protocol)).toBe(true);
  });
});

// Fila, aparelhos e confirmação automática (0034): as funções que a API chama como app_user.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ago = (ms: number) => new Date(Date.now() - ms);

/** Tira da frente o que outros testes deixaram pendente: cada teste da fila vê só as próprias linhas. */
async function clearQueue() {
  await owner
    .update(notificationOutbox)
    .set({ status: 'skipped' })
    .where(eq(notificationOutbox.status, 'pending'));
}

async function queued(
  userId: string,
  values: Partial<typeof notificationOutbox.$inferInsert> = {},
) {
  const [row] = await owner
    .insert(notificationOutbox)
    .values({
      tenantId: town.tenantId,
      userId,
      channel: 'push',
      kind: 'request_in_progress',
      protocol: 'P-FILA',
      ...values,
    })
    .returning();
  return row!;
}

async function device(userId: string, platform: 'android' | 'ios', pushToken: string | null) {
  const [row] = await owner
    .insert(devices)
    .values({ userId, installationId: randomUUID(), platform, appVersion: '1.0.0', pushToken })
    .returning();
  return row!.id;
}

async function outboxRow(id: string) {
  const [row] = await owner.select().from(notificationOutbox).where(eq(notificationOutbox.id, id));
  return row!;
}

/** Segundos entre a próxima tentativa e agora, pelo relógio do banco. */
async function secondsUntilNextAttempt(id: string) {
  const { rows } = await owner.execute<{ seconds: number }>(sql`
    select extract(epoch from next_attempt_at - now())::float8 as seconds
    from notification_outbox where id = ${id}
  `);
  return rows[0]!.seconds;
}

async function pushTokenOf(deviceId: string) {
  const [row] = await owner
    .select({ pushToken: devices.pushToken })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row!.pushToken;
}

/** Solicitação aguardando confirmação desde `since`. */
async function awaiting(occurrenceId: string, since: Date) {
  const citizen = await seedUser('cidadao-aguarda');
  const request = await newRequest(occurrenceId, citizen, 'awaiting_confirmation');
  await owner.update(requests).set({ statusChangedAt: since }).where(eq(requests.id, request.id));
  return request;
}

async function requestStatus(id: string) {
  const [row] = await owner
    .select({ status: requests.status, statusChangedAt: requests.statusChangedAt })
    .from(requests)
    .where(eq(requests.id, id));
  return row!;
}

async function occurrenceStatus(id: string) {
  const [row] = await owner
    .select({ status: occurrences.status })
    .from(occurrences)
    .where(eq(occurrences.id, id));
  return row!.status;
}

async function eventsOf(occurrenceId: string) {
  return owner
    .select({
      requestId: statusEvents.requestId,
      workOrderId: statusEvents.workOrderId,
      fromStatus: statusEvents.fromStatus,
      toStatus: statusEvents.toStatus,
      actorUserId: statusEvents.actorUserId,
    })
    .from(statusEvents)
    .where(eq(statusEvents.occurrenceId, occurrenceId))
    .orderBy(asc(statusEvents.createdAt), asc(statusEvents.requestId));
}

describe('fila, aparelhos e confirmação automática', () => {
  beforeAll(async () => {
    town ??= await seedTown();
  });

  it('duas pegadas simultâneas não pegam a mesma linha', async () => {
    await clearQueue();
    const person = await seedUser('pessoa-fila');
    await device(person, 'android', `tok-${randomUUID()}`);
    const ids: string[] = [];
    for (let index = 0; index < 20; index++) ids.push((await queued(person)).id);

    // Duas conexões do pool, como duas instâncias da API.
    const [first, second] = await Promise.all([
      claimNotifications(app, 15),
      claimNotifications(app, 15),
    ]);
    const firstIds = first.map((row) => row.id);
    const secondIds = second.map((row) => row.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect([...firstIds, ...secondIds].toSorted()).toEqual(ids.toSorted());
    // Quem já foi pego fica travado por 10 minutos: uma terceira pegada não traz nada.
    expect(await claimNotifications(app, 50)).toEqual([]);
    const rows = await owner
      .select({ attempts: notificationOutbox.attempts })
      .from(notificationOutbox)
      .where(inArray(notificationOutbox.id, ids));
    expect(rows.every((row) => row.attempts === 1)).toBe(true);

    // Pegada ainda sem commit: a outra conexão pula as linhas travadas e não espera por elas.
    const more: string[] = [];
    for (let index = 0; index < 4; index++) more.push((await queued(person)).id);
    await app.transaction(async (tx) => {
      const held = await claimNotifications(tx, 2);
      const meanwhile = await claimNotifications(app, 50);
      expect(held).toHaveLength(2);
      expect(meanwhile).toHaveLength(2);
      expect([...held, ...meanwhile].map((row) => row.id).toSorted()).toEqual(more.toSorted());
    });
  });

  it('pegada traz os tokens distintos da pessoa e o e-mail', async () => {
    await clearQueue();
    const person = await seedUser('pessoa-tokens');
    const [user] = await owner.select().from(users).where(eq(users.id, person));
    const shared = `tok-a-${randomUUID()}`;
    const ios = `tok-i-${randomUUID()}`;
    await device(person, 'android', shared);
    await device(person, 'android', shared);
    await device(person, 'ios', ios);
    await device(person, 'android', null);
    const other = await seedUser('pessoa-outra');
    await device(other, 'android', `tok-o-${randomUUID()}`);
    const row = await queued(person, { channel: 'email', kind: 'request_awaiting_confirmation' });

    const claimed = await claimNotifications(app, 10);
    expect(claimed).toHaveLength(1);
    const [item] = claimed;
    expect({
      ...item,
      pushTokens: item!.pushTokens.toSorted((a, b) => a.token.localeCompare(b.token)),
    }).toEqual({
      id: row.id,
      channel: 'email',
      kind: 'request_awaiting_confirmation',
      protocol: 'P-FILA',
      tenantId: town.tenantId,
      requestId: null,
      workOrderId: null,
      details: null,
      attempts: 1,
      pushTokens: [
        { platform: 'android', token: shared },
        { platform: 'ios', token: ios },
      ].toSorted((a, b) => a.token.localeCompare(b.token)),
      email: user!.email,
    });
    const seconds = await secondsUntilNextAttempt(row.id);
    expect(seconds).toBeGreaterThan(9 * 60);
    expect(seconds).toBeLessThanOrEqual(10 * 60);
  });

  it('pegada pula conta congelada ou excluída', async () => {
    await clearQueue();
    const active = await seedUser('pessoa-ativa');
    const frozen = await seedUser('pessoa-congelada');
    const deleted = await seedUser('pessoa-excluida');
    await owner.update(users).set({ accountStatus: 'frozen' }).where(eq(users.id, frozen));
    await owner.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted));
    const activeRow = await queued(active);
    const frozenRow = await queued(frozen);
    const deletedRow = await queued(deleted);

    const claimed = await claimNotifications(app, 10);
    expect(claimed.map((row) => row.id)).toEqual([activeRow.id]);
    expect((await outboxRow(frozenRow.id)).status).toBe('skipped');
    expect((await outboxRow(deletedRow.id)).status).toBe('skipped');

    // Descongelar depois não traz o aviso de volta.
    await owner.update(users).set({ accountStatus: 'active' }).where(eq(users.id, frozen));
    await owner
      .update(notificationOutbox)
      .set({ nextAttemptAt: ago(MINUTE_MS) })
      .where(eq(notificationOutbox.id, frozenRow.id));
    expect(await claimNotifications(app, 10)).toEqual([]);
  });

  it('pegada não envia work_order_* a quem saiu da equipe', async () => {
    await clearQueue();
    const stays = await seedUser('agente-fica');
    const left = await seedUser('agente-saiu');
    const demoted = await seedUser('agente-sem-vinculo');
    for (const userId of [stays, left, demoted]) await role(town.tenantId, userId, 'field_agent');
    await owner.insert(teamMembers).values(
      [stays, left, demoted].map((userId) => ({
        tenantId: town.tenantId,
        teamId: town.teamId,
        userId,
      })),
    );
    const occurrenceId = await newOccurrence('in_progress');
    const [order] = await owner
      .insert(workOrders)
      .values({ tenantId: town.tenantId, occurrenceId, teamId: town.teamId })
      .returning();
    const kind = 'work_order_assigned';
    const staysRow = await queued(stays, { kind, workOrderId: order!.id });
    const leftRow = await queued(left, { kind, workOrderId: order!.id });
    const demotedRow = await queued(demoted, { kind, workOrderId: order!.id });
    // Saiu da equipe e perdeu o vínculo de agente depois de o aviso entrar na fila.
    await owner
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, town.teamId), eq(teamMembers.userId, left)));
    await owner
      .update(memberships)
      .set({ status: 'inactive' })
      .where(and(eq(memberships.userId, demoted), eq(memberships.role, 'field_agent')));

    const claimed = await claimNotifications(app, 10);
    expect(claimed.map((row) => row.id)).toEqual([staysRow.id]);
    expect((await outboxRow(leftRow.id)).status).toBe('skipped');
    expect((await outboxRow(demotedRow.id)).status).toBe('skipped');
  });

  it('pegada pula work_order_* sem atividade', async () => {
    await clearQueue();
    const agent = await seedUser('agente-sem-atividade');
    await role(town.tenantId, agent, 'field_agent');
    const row = await queued(agent, { kind: 'work_order_assigned', workOrderId: null });

    expect(await claimNotifications(app, 10)).toEqual([]);
    expect((await outboxRow(row.id)).status).toBe('skipped');
  });

  it('nova tentativa volta à fila no tempo pedido', async () => {
    await clearQueue();
    const person = await seedUser('pessoa-tentativa');
    const row = await queued(person);
    await claimNotifications(app, 10);

    await finishNotification(app, row.id, {
      status: 'retry',
      retryInSeconds: 300,
      error: 'timeout',
    });
    expect(await outboxRow(row.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'timeout',
    });
    const seconds = await secondsUntilNextAttempt(row.id);
    expect(seconds).toBeGreaterThan(295);
    expect(seconds).toBeLessThanOrEqual(300);
    expect(await claimNotifications(app, 10)).toEqual([]);

    // Passado o tempo, volta a ser pega, com a tentativa contada.
    await owner
      .update(notificationOutbox)
      .set({ nextAttemptAt: ago(MINUTE_MS) })
      .where(eq(notificationOutbox.id, row.id));
    const again = await claimNotifications(app, 10);
    expect(again.map((item) => [item.id, item.attempts])).toEqual([[row.id, 2]]);

    await finishNotification(app, row.id, { status: 'sent' });
    const sent = await outboxRow(row.id);
    expect(sent).toMatchObject({ status: 'sent', lastError: null });
    expect(sent.sentAt).not.toBeNull();
    // Depois de enviada, uma nova tentativa atrasada não a devolve à fila.
    await finishNotification(app, row.id, { status: 'retry', retryInSeconds: 60 });
    expect((await outboxRow(row.id)).status).toBe('sent');

    const failed = await queued(person);
    await claimNotifications(app, 10);
    await finishNotification(app, failed.id, { status: 'failed', error: 'fcm_down' });
    expect(await outboxRow(failed.id)).toMatchObject({
      status: 'failed',
      lastError: 'fcm_down',
      sentAt: null,
    });
  });

  it('token reivindicado sai de outra conta', async () => {
    const token = `tok-r-${randomUUID()}`;
    const previous = await seedUser('dono-anterior');
    const current = await seedUser('dono-atual');
    const previousDevice = await device(previous, 'android', token);
    const oldDevice = await device(current, 'android', token);
    const keptDevice = await device(current, 'ios', `tok-k-${randomUUID()}`);
    const newDevice = await device(current, 'android', null);

    // Como o registro do aparelho na API: reivindica e grava no próprio aparelho, na mesma transação.
    await withContext(app, { userId: current }, async (tx) => {
      await claimPushToken(tx, token);
      await tx.update(devices).set({ pushToken: token }).where(eq(devices.id, newDevice));
    });
    expect(await pushTokenOf(previousDevice)).toBeNull();
    expect(await pushTokenOf(oldDevice)).toBeNull();
    expect(await pushTokenOf(newDevice)).toBe(token);
    expect(await pushTokenOf(keptDevice)).not.toBeNull();

    // Sem pessoa no contexto, nada muda.
    await expect(withContext(app, {}, (tx) => claimPushToken(tx, token))).rejects.toThrow();
    expect(await pushTokenOf(newDevice)).toBe(token);

    // Token recusado pelo provedor: sai de onde estiver.
    await clearPushToken(app, token);
    expect(await pushTokenOf(newDevice)).toBeNull();
  });

  it('confirmação automática confirma depois de 7 dias e não antes', async () => {
    const oldOccurrence = await newOccurrence('awaiting_confirmation');
    const old = await awaiting(oldOccurrence, ago(7 * DAY_MS + MINUTE_MS));
    const recentOccurrence = await newOccurrence('awaiting_confirmation');
    const recent = await awaiting(recentOccurrence, ago(7 * DAY_MS - 10 * MINUTE_MS));

    expect(await autoConfirmRequests(app)).toBeGreaterThanOrEqual(1);

    const confirmed = await requestStatus(old.id);
    expect(confirmed.status).toBe('completed');
    expect(Date.now() - confirmed.statusChangedAt.getTime()).toBeLessThan(MINUTE_MS);
    expect(await occurrenceStatus(oldOccurrence)).toBe('completed');
    expect(await eventsOf(oldOccurrence)).toEqual([
      {
        requestId: old.id,
        workOrderId: null,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'completed',
        actorUserId: null,
      },
      {
        requestId: null,
        workOrderId: null,
        fromStatus: 'awaiting_confirmation',
        toStatus: 'completed',
        actorUserId: null,
      },
    ]);

    expect((await requestStatus(recent.id)).status).toBe('awaiting_confirmation');
    expect(await occurrenceStatus(recentOccurrence)).toBe('awaiting_confirmation');
    expect(await eventsOf(recentOccurrence)).toEqual([]);
  });

  it('confirmação automática processa em lotes de 100', async () => {
    const batch = 100;
    const occurrenceId = await newOccurrence('awaiting_confirmation');
    const ids: string[] = [];
    for (let i = 0; i < batch + 5; i++) {
      ids.push((await awaiting(occurrenceId, ago(60 * DAY_MS + i * MINUTE_MS))).id);
    }

    // Há mais candidatas que o lote: uma chamada confirma só o lote.
    expect(await autoConfirmRequests(app)).toBe(batch);
    const statuses = await Promise.all(ids.map(async (id) => (await requestStatus(id)).status));
    expect(statuses.filter((status) => status === 'completed')).toHaveLength(batch);

    // Chamadas seguintes terminam o resto.
    let rounds = 0;
    while ((await autoConfirmRequests(app)) === batch && rounds++ < 5);
    for (const id of ids) expect((await requestStatus(id)).status).toBe('completed');
    expect(await autoConfirmRequests(app)).toBe(0);
  }, 60_000);

  it('confirmação automática roda duas vezes sem duplicar', async () => {
    const occurrenceId = await newOccurrence('awaiting_confirmation');
    const request = await awaiting(occurrenceId, ago(8 * DAY_MS));

    // Duas instâncias ao mesmo tempo, e depois mais uma rodada.
    await Promise.all([autoConfirmRequests(app), autoConfirmRequests(app)]);
    expect(await autoConfirmRequests(app)).toBe(0);

    expect((await requestStatus(request.id)).status).toBe('completed');
    const rows = await eventsOf(occurrenceId);
    expect(rows.filter((row) => row.requestId === request.id)).toHaveLength(1);
    expect(rows.filter((row) => row.requestId === null)).toHaveLength(1);
  });

  it('ocorrência só fecha sem outra aguardando', async () => {
    const occurrenceId = await newOccurrence('awaiting_confirmation');
    const old = await awaiting(occurrenceId, ago(8 * DAY_MS));
    const recent = await awaiting(occurrenceId, ago(DAY_MS));

    await autoConfirmRequests(app);
    expect((await requestStatus(old.id)).status).toBe('completed');
    expect((await requestStatus(recent.id)).status).toBe('awaiting_confirmation');
    expect(await occurrenceStatus(occurrenceId)).toBe('awaiting_confirmation');
    expect((await eventsOf(occurrenceId)).filter((row) => row.requestId === null)).toEqual([]);

    // Vencido o prazo da outra, a ocorrência fecha.
    await owner
      .update(requests)
      .set({ statusChangedAt: ago(8 * DAY_MS) })
      .where(eq(requests.id, recent.id));
    await autoConfirmRequests(app);
    expect((await requestStatus(recent.id)).status).toBe('completed');
    expect(await occurrenceStatus(occurrenceId)).toBe('completed');
    expect((await eventsOf(occurrenceId)).filter((row) => row.requestId === null)).toHaveLength(1);
  });

  it('confirmação automática não gera push', async () => {
    const occurrenceId = await newOccurrence('awaiting_confirmation');
    const request = await awaiting(occurrenceId, ago(8 * DAY_MS));
    await autoConfirmRequests(app);
    expect((await requestStatus(request.id)).status).toBe('completed');
    expect(await outbox({ requestId: request.id })).toEqual([]);
    expect(await bell(occurrenceId)).toEqual([]);
  });

  it('limpeza apaga avisos do sino com mais de 90 dias', async () => {
    const occurrenceId = await newOccurrence();
    const person = await seedUser('pessoa-limpeza');
    const bellRow = (createdAt: Date) => ({
      tenantId: town.tenantId,
      userId: person,
      kind: 'occurrence_new',
      protocol: 'P-LIMPEZA',
      occurrenceId,
      createdAt,
    });
    const [, recentBell] = await owner
      .insert(panelNotifications)
      .values([bellRow(ago(91 * DAY_MS)), bellRow(ago(89 * DAY_MS))])
      .returning();
    for (const status of ['sent', 'skipped', 'failed'] as const) {
      await queued(person, { status, createdAt: ago(31 * DAY_MS) });
    }
    const oldPending = await queued(person, { status: 'pending', createdAt: ago(31 * DAY_MS) });
    const recentSent = await queued(person, { status: 'sent', createdAt: ago(29 * DAY_MS) });

    await cleanupNotifications(app);

    const bells = await owner
      .select({ id: panelNotifications.id })
      .from(panelNotifications)
      .where(eq(panelNotifications.userId, person));
    expect(bells.map((row) => row.id)).toEqual([recentBell!.id]);
    const queue = await owner
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.userId, person));
    expect(queue.map((row) => row.id).toSorted()).toEqual(
      [oldPending.id, recentSent.id].toSorted(),
    );
  });
});
