import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, geoPoint, withContext } from './client.js';
import {
  categories,
  departmentManagers,
  departments,
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

async function newOccurrence(status: 'triage' | 'in_progress' = 'triage') {
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
