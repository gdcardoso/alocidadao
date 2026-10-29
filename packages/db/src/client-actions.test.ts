import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withContext, type Database } from './client.js';
import { DEMO_ADDRESSES, DEMO_UNSERVED_CENTER, seedDev } from './seed-dev-data.js';
import { findActiveTenantAt, findMunicipalityAt } from './geo.js';
import {
  categories,
  clientActions,
  departmentManagers,
  memberships,
  notificationOutbox,
  occurrences,
  panelNotifications,
  photos,
  requests,
  statusEvents,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono prepara os dados; os testes rodam como app_user (mesma conexão da API).

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const ACTION_ID = randomUUID();
let a: { tenantId: string; userId: string };
let b: { tenantId: string; userId: string };

async function seedTenant(db: Database, label: string, ibgeCode: string) {
  const [tenant] = await db
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
  const [user] = await db
    .insert(users)
    .values({
      name: `Agente ${label}`,
      email: `agente.${label}@acoes.dev`,
      phone: `+551193${ibgeCode}`,
    })
    .returning();
  return { tenantId: tenant!.id, userId: user!.id };
}

function insertAction(seed: { tenantId: string; userId: string }, id: string) {
  return withContext(app.db, { tenantId: seed.tenantId, userId: seed.userId }, (tx) =>
    tx.insert(clientActions).values({
      id,
      tenantId: seed.tenantId,
      userId: seed.userId,
      kind: 'work_order.start',
      targetId: randomUUID(),
      response: { ok: true },
    }),
  );
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

beforeAll(async () => {
  a = await seedTenant(owner.db, 'acoes-a', '0000011');
  b = await seedTenant(owner.db, 'acoes-b', '0000012');
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('registro de ações do aparelho', () => {
  it('recusa repetir o id de uma ação', async () => {
    await insertAction(a, ACTION_ID);
    expect(await dbError(insertAction(a, ACTION_ID))).toMatch(/duplicate key/);
  });

  it('esconde ações de outra prefeitura', async () => {
    const id = randomUUID();
    await insertAction(a, id);
    const visible = (tenantId: string) =>
      withContext(app.db, { tenantId }, (tx) =>
        tx.select({ id: clientActions.id }).from(clientActions),
      );
    expect((await visible(a.tenantId)).map((r) => r.id)).toContain(id);
    expect((await visible(b.tenantId)).map((r) => r.id)).not.toContain(id);
  });

  it('recusa gravar ação com tenant_id de outra prefeitura', async () => {
    const message = await dbError(
      withContext(app.db, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
        tx.insert(clientActions).values({
          id: randomUUID(),
          tenantId: b.tenantId,
          userId: a.userId,
          kind: 'work_order.start',
          response: { ok: true },
        }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('não permite reescrever uma ação', async () =>
    expect(
      await dbError(
        withContext(app.db, { tenantId: a.tenantId }, (tx) =>
          tx.update(clientActions).set({ response: {} }),
        ),
      ),
    ).toMatch(/permission denied/));

  it('não permite apagar uma ação', async () =>
    expect(
      await dbError(
        withContext(app.db, { tenantId: a.tenantId }, (tx) => tx.delete(clientActions)),
      ),
    ).toMatch(/permission denied/));
});

describe('dados de demonstração', () => {
  it('cria a prefeitura de demonstração uma vez só', async () => {
    const first = await seedDev(owner.db);
    const second = await seedDev(owner.db);
    expect(second).toEqual(first);
    expect(first.workOrderIds).toHaveLength(4);
  });

  it('cria o gestor demo e o admin interno, sem duplicar', async () => {
    const first = await seedDev(owner.db);
    await seedDev(owner.db);
    const [manager] = await owner.db.select().from(users).where(eq(users.id, first.managerId));
    expect(manager).toMatchObject({
      cpf: '52998224725',
      email: 'gestor.demo@alocidadao.dev',
      platformRole: null,
    });
    const links = await owner.db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.userId, first.managerId), eq(memberships.tenantId, first.tenantId)),
      );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ role: 'manager', status: 'active' });
    const managed = await owner.db
      .select()
      .from(departmentManagers)
      .where(eq(departmentManagers.userId, first.managerId));
    expect(managed).toHaveLength(1);
    expect(managed[0]?.tenantId).toBe(first.tenantId);

    const [admin] = await owner.db.select().from(users).where(eq(users.id, first.platformAdminId));
    expect(admin).toMatchObject({
      cpf: '11144477735',
      email: 'admin.demo@alocidadao.dev',
      platformRole: 'admin',
    });
    for (const cpf of ['52998224725', '11144477735']) {
      expect(await owner.db.select().from(users).where(eq(users.cpf, cpf))).toHaveLength(1);
    }
  });

  it('cria os 9 tipos da demo com ícone e raio, e os dois municípios', async () => {
    const { tenantId } = await seedDev(owner.db);
    await seedDev(owner.db);
    const rows = await owner.db
      .select({
        name: categories.name,
        icon: categories.icon,
        iconGroup: categories.iconGroup,
        clusterRadiusM: categories.clusterRadiusM,
      })
      .from(categories)
      .where(eq(categories.tenantId, tenantId));
    expect(rows).toHaveLength(9);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          name: 'Buraco na via',
          icon: 'construction',
          iconGroup: 'infrastructure',
          clusterRadiusM: 15,
        },
        { name: 'Sinalização', icon: 'signpost', iconGroup: 'infrastructure', clusterRadiusM: 50 },
        { name: 'Animal', icon: 'paw-print', iconGroup: 'public_services', clusterRadiusM: 50 },
        {
          name: 'Outro',
          icon: 'circle-ellipsis',
          iconGroup: 'public_services',
          clusterRadiusM: 20,
        },
      ]),
    );
    for (const row of rows) expect(row.icon).toBeTruthy();

    const demo = await app.db.transaction((tx) =>
      findMunicipalityAt(tx, { lat: -23.5505, lng: -46.6333 }),
    );
    expect(demo).toEqual({ ibgeCode: '9999901', name: 'Cidade Demo', state: 'SP' });
    const unserved = await app.db.transaction((tx) => findMunicipalityAt(tx, DEMO_UNSERVED_CENTER));
    expect(unserved).toEqual({ ibgeCode: '9999902', name: 'Vila Sem Adesão', state: 'SP' });
    expect(await app.db.transaction((tx) => findActiveTenantAt(tx, DEMO_UNSERVED_CENTER))).toBe(
      undefined,
    );
  });

  it('seed cria atividade com ajuste pedido e autor da atribuição', async () => {
    const seeded = await seedDev(owner.db);
    await seedDev(owner.db);
    const [manager] = await owner.db.select().from(users).where(eq(users.id, seeded.managerId));
    expect(manager?.name).toBe('Carlos Demo');

    const orders = await owner.db
      .select()
      .from(workOrders)
      .where(inArray(workOrders.id, seeded.workOrderIds));
    const byId = new Map(orders.map((order) => [order.id, order]));
    const [first, , , rework] = seeded.workOrderIds.map((id) => byId.get(id)!);
    expect(first).toMatchObject({
      status: 'assigned',
      managerInstructions:
        'Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h.',
    });
    for (const order of orders) {
      expect(order.managerInstructions).toBeTruthy();
      expect(order.dueAt).toBeInstanceOf(Date);
    }

    // Uma atribuição feita pelo gestor em cada atividade, sem duplicar na segunda execução.
    const assigned = await owner.db
      .select()
      .from(statusEvents)
      .where(
        and(
          inArray(statusEvents.workOrderId, seeded.workOrderIds),
          eq(statusEvents.toStatus, 'assigned'),
        ),
      );
    expect(assigned).toHaveLength(4);
    for (const event of assigned) expect(event.actorUserId).toBe(seeded.managerId);

    expect(rework).toMatchObject({ status: 'rework_requested' });
    expect(rework!.agentNote).toBeTruthy();
    const reworkEvents = await owner.db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.workOrderId, rework!.id))
      .orderBy(asc(statusEvents.createdAt));
    expect(reworkEvents.map((event) => event.toStatus)).toEqual([
      'assigned',
      'in_execution',
      'awaiting_review',
      'rework_requested',
    ]);
    expect(reworkEvents.at(-1)).toMatchObject({
      fromStatus: 'awaiting_review',
      actorUserId: seeded.managerId,
      comment:
        'As fotos 2 e 3 ficaram escuras e não mostram o buraco tapado. Tire uma de perto e uma de longe, com a rua aparecendo.',
      details: { reasons: ['new_photos'], discardedPhotoIds: [] },
    });

    // Uma ocorrência com 3 relatos de cidadãos diferentes.
    const reports = await owner.db
      .select({ citizenId: requests.citizenId })
      .from(requests)
      .where(eq(requests.occurrenceId, first!.occurrenceId));
    expect(reports).toHaveLength(3);
    expect(new Set(reports.map((r) => r.citizenId)).size).toBe(3);
  });

  it('completa o gestor e o admin numa prefeitura demo criada antes deles', async () => {
    const before = await seedDev(owner.db);
    await owner.db
      .delete(departmentManagers)
      .where(eq(departmentManagers.userId, before.managerId));
    await owner.db.delete(memberships).where(eq(memberships.userId, before.managerId));
    // As atribuições da demo apontam para o gestor; saem com ele e voltam com o novo.
    await owner.db.delete(statusEvents).where(eq(statusEvents.actorUserId, before.managerId));
    // Os avisos gerados pelos eventos da demo também apontam para as pessoas que saem.
    for (const table of [panelNotifications, notificationOutbox]) {
      await owner.db
        .delete(table)
        .where(or(eq(table.userId, before.managerId), eq(table.userId, before.platformAdminId)));
    }
    await owner.db.delete(users).where(eq(users.id, before.managerId));
    await owner.db.delete(users).where(eq(users.id, before.platformAdminId));
    const after = await seedDev(owner.db);
    expect(after.managerId).not.toBe(before.managerId);
    const assigned = await owner.db
      .select({ actorUserId: statusEvents.actorUserId })
      .from(statusEvents)
      .where(
        and(
          inArray(statusEvents.workOrderId, after.workOrderIds),
          eq(statusEvents.toStatus, 'assigned'),
        ),
      );
    expect(assigned.map((event) => event.actorUserId)).toEqual(
      after.workOrderIds.map(() => after.managerId),
    );
    const links = await owner.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, after.managerId));
    expect(links).toHaveLength(1);
    expect(
      await owner.db
        .select()
        .from(departmentManagers)
        .where(eq(departmentManagers.userId, after.managerId)),
    ).toHaveLength(1);
  });

  it('recria a atividade da demo que foi concluída ou cancelada', async () => {
    const before = await seedDev(owner.db);
    const [closedId, cancelledId] = before.workOrderIds;
    await owner.db
      .update(workOrders)
      .set({ status: 'completed' })
      .where(eq(workOrders.id, closedId!));
    await owner.db
      .update(workOrders)
      .set({ status: 'cancelled' })
      .where(eq(workOrders.id, cancelledId!));

    const after = await seedDev(owner.db);
    expect(after.workOrderIds).toHaveLength(4);
    expect(after.workOrderIds.slice(0, 2)).not.toContain(closedId);
    expect(after.workOrderIds.slice(0, 2)).not.toContain(cancelledId);
    expect(after.workOrderIds.slice(2)).toEqual(before.workOrderIds.slice(2));
    const [fresh] = await owner.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, after.workOrderIds[0]!));
    expect(fresh).toMatchObject({
      status: 'assigned',
      managerInstructions:
        'Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h.',
    });
    const reports = await owner.db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.occurrenceId, fresh!.occurrenceId));
    expect(reports).toHaveLength(3);
    expect(await seedDev(owner.db)).toEqual(after);
  });

  it('recria as atividades da demo quando foram apagadas', async () => {
    const before = await seedDev(owner.db);
    // Simula o TRUNCATE de uma migração: some o operacional, ficam prefeitura, equipe e pessoas.
    const tenantId = before.tenantId;
    await owner.db.delete(statusEvents).where(eq(statusEvents.tenantId, tenantId));
    await owner.db.delete(panelNotifications).where(eq(panelNotifications.tenantId, tenantId));
    await owner.db.delete(notificationOutbox).where(eq(notificationOutbox.tenantId, tenantId));
    await owner.db.delete(photos).where(eq(photos.tenantId, tenantId));
    await owner.db.delete(workOrders).where(eq(workOrders.tenantId, tenantId));
    await owner.db.delete(requests).where(eq(requests.tenantId, tenantId));
    await owner.db.delete(occurrences).where(eq(occurrences.tenantId, tenantId));

    const after = await seedDev(owner.db);
    expect(after).toMatchObject({
      tenantId,
      teamId: before.teamId,
      agentId: before.agentId,
    });
    expect(after.workOrderIds).toHaveLength(4);
    expect(after.workOrderIds).not.toEqual(before.workOrderIds);
    expect(await seedDev(owner.db)).toEqual(after);
  });

  it('põe o endereço no primeiro relato de cada atividade da demo', async () => {
    const before = await seedDev(owner.db);
    // Uma demo criada antes dos endereços: o relato ainda sem endereço ganha o da demo.
    const [firstOrder] = await owner.db
      .select({ occurrenceId: workOrders.occurrenceId })
      .from(workOrders)
      .where(eq(workOrders.id, before.workOrderIds[0]!));
    await owner.db
      .update(requests)
      .set({ address: null })
      .where(eq(requests.occurrenceId, firstOrder!.occurrenceId));

    const seeded = await seedDev(owner.db);
    expect(seeded).toEqual(before);
    const addresses: (string | null)[] = [];
    for (const id of seeded.workOrderIds) {
      const [order] = await owner.db
        .select({ occurrenceId: workOrders.occurrenceId })
        .from(workOrders)
        .where(eq(workOrders.id, id));
      const [first] = await owner.db
        .select({ address: requests.address })
        .from(requests)
        .where(eq(requests.occurrenceId, order!.occurrenceId))
        .orderBy(asc(requests.createdAt))
        .limit(1);
      addresses.push(first!.address);
    }
    expect(addresses).toEqual([...DEMO_ADDRESSES]);
    expect(DEMO_ADDRESSES).toEqual([
      'Rua das Flores, 120 — Centro',
      'Av. Brasil, 1450',
      'Rua Ipê, 33',
      'Rua XV, 88',
    ]);
  });

  it('com reset, cancela as atividades ativas da demo e cria outras', async () => {
    const before = await seedDev(owner.db);
    // O agente já mexeu numa delas: o reset volta a demo ao começo.
    await owner.db
      .update(workOrders)
      .set({ status: 'awaiting_review' })
      .where(eq(workOrders.id, before.workOrderIds[1]!));

    const after = await seedDev(owner.db, { reset: true });
    expect(after).toMatchObject({ tenantId: before.tenantId, teamId: before.teamId });
    expect(after.workOrderIds).toHaveLength(4);
    for (const id of before.workOrderIds) expect(after.workOrderIds).not.toContain(id);

    const old = await owner.db
      .select({ id: workOrders.id, status: workOrders.status })
      .from(workOrders)
      .where(inArray(workOrders.id, before.workOrderIds));
    expect(old.map((order) => order.status)).toEqual(before.workOrderIds.map(() => 'cancelled'));
    const cancelEvents = await owner.db
      .select()
      .from(statusEvents)
      .where(
        and(
          inArray(statusEvents.workOrderId, before.workOrderIds),
          eq(statusEvents.toStatus, 'cancelled'),
        ),
      );
    expect(cancelEvents).toHaveLength(4);
    for (const event of cancelEvents) expect(event.actorUserId).toBe(after.managerId);

    const fresh = await owner.db
      .select({ id: workOrders.id, status: workOrders.status })
      .from(workOrders)
      .where(inArray(workOrders.id, after.workOrderIds));
    const statusById = new Map(fresh.map((order) => [order.id, order.status]));
    expect(after.workOrderIds.map((id) => statusById.get(id))).toEqual([
      'assigned',
      'assigned',
      'assigned',
      'rework_requested',
    ]);
    // Sem reset, a próxima execução reencontra as novas.
    expect(await seedDev(owner.db)).toEqual(after);
  });
  it('avisos gerados pelo seed não ficam na fila; os de antes ficam', async () => {
    const before = await seedDev(owner.db);
    const [earlier] = await owner.db
      .insert(notificationOutbox)
      .values({
        tenantId: before.tenantId,
        userId: before.agentId,
        channel: 'push',
        kind: 'work_order_assigned',
        protocol: 'P-ANTES',
      })
      .returning();
    // Relógio do banco, em texto para não perder os microssegundos: o created_at da fila vem dele.
    const { rows } = await owner.db.execute<{ started: string }>(
      sql`select clock_timestamp()::text as started`,
    );
    const started = rows[0]!.started;

    await seedDev(owner.db, { reset: true });

    const created = await owner.db
      .select({ id: notificationOutbox.id, status: notificationOutbox.status })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.tenantId, before.tenantId),
          gte(notificationOutbox.createdAt, sql`${started}::timestamptz`),
        ),
      );
    // O reset atribui de novo: o gatilho gera avisos, e o seed os tira da fila.
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((row) => row.status === 'skipped')).toBe(true);
    const [kept] = await owner.db
      .select({ status: notificationOutbox.status })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, earlier!.id));
    expect(kept!.status).toBe('pending');
  });
});
