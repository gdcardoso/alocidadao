import { ACTIVE_WORK_ORDER_STATUSES, type GeoPoint } from '@alocidadao/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { findUserByCpf } from './auth.js';
import { createDatabase, geoPoint, withContext } from './client.js';
import { findMergeSuggestions } from './geo.js';
import {
  DEMO_IMPEDIMENT_DESCRIPTION,
  DEMO_REVIEW_DESCRIPTIONS,
  RESET_REJECTION_REASON,
  TENANT_ADMIN_CPF,
  TENANT_ADMIN_EMAIL,
  seedDev,
} from './seed-dev-data.js';
import {
  categories,
  departments,
  memberships,
  occurrenceSeparations,
  occurrences,
  photos,
  requests,
  statusEvents,
  teams,
  tenants,
  users,
  workOrders,
} from './schema.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono prepara os dados; as consultas e o RLS rodam como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const ORIGIN: GeoPoint = { lat: -10.5, lng: -40.5 };

interface Seed {
  tenantId: string;
  departmentId: string;
  categoryId: string;
  citizenId: string;
}

let a: Seed;
let b: Seed;

async function seedTenant(label: string, ibgeCode: string): Promise<Seed> {
  const [tenant] = await owner.db
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
  const [citizen] = await owner.db
    .insert(users)
    .values({
      name: `Cidadão ${label}`,
      email: `cidadao.${label}@painel.dev`,
      phone: `+551192${ibgeCode}`,
    })
    .returning();
  return withContext(owner.db, { tenantId }, async (tx) => {
    await tx.insert(memberships).values({ tenantId, userId: citizen!.id, role: 'citizen' });
    const [department] = await tx
      .insert(departments)
      .values({ tenantId, name: 'Obras' })
      .returning();
    const [category] = await tx
      .insert(categories)
      .values({ tenantId, departmentId: department!.id, name: 'Buraco', clusterRadiusM: 20 })
      .returning();
    return {
      tenantId,
      departmentId: department!.id,
      categoryId: category!.id,
      citizenId: citizen!.id,
    };
  });
}

/** Ocorrência com `requestCount` solicitações; `northM` metros ao norte de ORIGIN. */
async function newOccurrence(
  seed: Seed,
  northM: number,
  options: { status?: 'triage' | 'in_progress'; requestCount?: number; categoryId?: string } = {},
): Promise<string> {
  const point = { lat: ORIGIN.lat + northM / 111_195, lng: ORIGIN.lng };
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [occurrence] = await tx
      .insert(occurrences)
      .values({
        tenantId: seed.tenantId,
        categoryId: options.categoryId ?? seed.categoryId,
        location: geoPoint(point),
        status: options.status ?? 'triage',
      })
      .returning();
    for (let i = 0; i < (options.requestCount ?? 1); i++) {
      await tx.insert(requests).values({
        tenantId: seed.tenantId,
        citizenId: seed.citizenId,
        categoryId: options.categoryId ?? seed.categoryId,
        occurrenceId: occurrence!.id,
        description: `Relato ${i} a ${northM} m`,
        location: geoPoint(point),
        gpsLocation: geoPoint(point),
      });
    }
    return occurrence!.id;
  });
}

/** Categoria nova de 20 m, para cada teste ter o seu conjunto de ocorrências. */
async function newCategory(seed: Seed): Promise<string> {
  return withContext(owner.db, { tenantId: seed.tenantId }, async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({
        tenantId: seed.tenantId,
        departmentId: seed.departmentId,
        name: `Buraco ${Math.random().toString(36).slice(2)}`,
        clusterRadiusM: 20,
      })
      .returning();
    return row!.id;
  });
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
  a = await seedTenant('painel-a', '0000051');
  b = await seedTenant('painel-b', '0000052');
});

describe('ocorrência juntada', () => {
  it('ocorrência juntada exige merged_into_id', async () => {
    const id = await newOccurrence(a, 0);
    const message = await dbError(
      owner.db.update(occurrences).set({ status: 'merged' }).where(eq(occurrences.id, id)),
    );
    expect(message).toContain('occurrences_merged_into_check');
  });

  it('só a ocorrência juntada tem merged_into_id', async () => {
    const id = await newOccurrence(a, 0);
    const other = await newOccurrence(a, 0);
    const message = await dbError(
      owner.db.update(occurrences).set({ mergedIntoId: other }).where(eq(occurrences.id, id)),
    );
    expect(message).toContain('occurrences_merged_into_check');
  });

  it('ocorrência juntada não pode apontar para si mesma', async () => {
    const id = await newOccurrence(a, 0);
    const message = await dbError(
      owner.db
        .update(occurrences)
        .set({ status: 'merged', mergedIntoId: id })
        .where(eq(occurrences.id, id)),
    );
    expect(message).toContain('occurrences_merged_into_check');
  });

  it('aceita a ocorrência juntada em outra', async () => {
    const id = await newOccurrence(a, 0);
    const other = await newOccurrence(a, 0);
    await owner.db
      .update(occurrences)
      .set({ status: 'merged', mergedIntoId: other })
      .where(eq(occurrences.id, id));
    const [row] = await owner.db.select().from(occurrences).where(eq(occurrences.id, id));
    expect(row?.mergedIntoId).toBe(other);
  });
});

describe('separações', () => {
  function insertPair(seed: Seed, first: string, second: string, userId: string) {
    return withContext(app.db, { tenantId: seed.tenantId, userId }, (tx) =>
      tx.insert(occurrenceSeparations).values({
        tenantId: seed.tenantId,
        occurrenceAId: first,
        occurrenceBId: second,
        createdBy: userId,
      }),
    );
  }

  it('par de separação exige a ordem menor-maior', async () => {
    const x = await newOccurrence(a, 0);
    const y = await newOccurrence(a, 0);
    const [low, high] = x < y ? [x, y] : [y, x];
    const message = await dbError(insertPair(a, high, low, a.citizenId));
    expect(message).toContain('occurrence_separations_order_check');
    await insertPair(a, low, high, a.citizenId);
  });

  it('separação de outra prefeitura é invisível', async () => {
    const x = await newOccurrence(a, 0);
    const y = await newOccurrence(a, 0);
    const [low, high] = x < y ? [x, y] : [y, x];
    await insertPair(a, low, high, a.citizenId);

    const own = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select().from(occurrenceSeparations).where(eq(occurrenceSeparations.occurrenceAId, low)),
    );
    expect(own).toHaveLength(1);
    const other = await withContext(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select().from(occurrenceSeparations).where(eq(occurrenceSeparations.occurrenceAId, low)),
    );
    expect(other).toEqual([]);
  });

  it('não grava par com ocorrência de outra prefeitura', async () => {
    const x = await newOccurrence(a, 0);
    const y = await newOccurrence(b, 0);
    const [low, high] = x < y ? [x, y] : [y, x];
    await expect(insertPair(a, low, high, a.citizenId)).rejects.toThrow();
  });
});

describe('acesso ao painel por status da prefeitura', () => {
  async function managerIn(status: 'active' | 'onboarding' | 'suspended', cpf: string) {
    const [tenant] = await owner.db
      .insert(tenants)
      .values({
        name: `Município ${status} ${cpf}`,
        displayName: `Prefeitura ${status}`,
        city: status,
        state: 'SP',
        ibgeCode: `99${cpf.slice(-5)}`,
        status,
      })
      .returning();
    const [user] = await owner.db
      .insert(users)
      .values({ name: `Gestor ${status}`, cpf, email: `gestor.${cpf}@painel.dev` })
      .returning();
    await withContext(owner.db, { tenantId: tenant!.id }, (tx) =>
      tx.insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: 'manager' }),
    );
    return user!.id;
  }

  it('gestor de prefeitura suspensa não tem acesso ao painel', async () => {
    const id = await managerIn('suspended', '31000000001');
    expect(await findUserByCpf(app.db, '31000000001')).toMatchObject({ id, hasPanelAccess: false });
  });

  it('gestor de prefeitura em implantação tem acesso ao painel', async () => {
    const id = await managerIn('onboarding', '31000000002');
    expect(await findUserByCpf(app.db, '31000000002')).toMatchObject({ id, hasPanelAccess: true });
  });

  it('gestor de prefeitura ativa tem acesso ao painel', async () => {
    const id = await managerIn('active', '31000000003');
    expect(await findUserByCpf(app.db, '31000000003')).toMatchObject({ id, hasPanelAccess: true });
  });
});

describe('findMergeSuggestions', () => {
  it('sugestões de junção ignoram a própria ocorrência, as juntadas e os pares descartados', async () => {
    const categoryId = await newCategory(a);
    const origin = await newOccurrence(a, 0, { requestCount: 2, categoryId });
    const near = await newOccurrence(a, 5, { categoryId });
    const farther = await newOccurrence(a, 12, { requestCount: 3, categoryId });
    const dismissed = await newOccurrence(a, 8, { categoryId });
    const merged = await newOccurrence(a, 3, { categoryId });
    const outside = await newOccurrence(a, 40, { categoryId });
    await owner.db
      .update(occurrences)
      .set({ status: 'merged', mergedIntoId: near })
      .where(eq(occurrences.id, merged));
    const [low, high] = origin < dismissed ? [origin, dismissed] : [dismissed, origin];
    await owner.db.insert(occurrenceSeparations).values({
      tenantId: a.tenantId,
      occurrenceAId: low,
      occurrenceBId: high,
    });
    expect(outside).toBeTruthy();

    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findMergeSuggestions(tx, { occurrenceId: origin, limit: 3 }),
    );

    expect(found.map((item) => item.occurrenceId)).toEqual([near, farther]);
    expect(found[0]).toMatchObject({
      distanceM: 5,
      requestCount: 1,
      categoryName: expect.stringMatching(/^Buraco /),
      description: 'Relato 0 a 5 m',
    });
    expect(found[0]!.protocol).toMatch(/^\d{4}-\d+$/);
    expect(found[1]).toMatchObject({ distanceM: 12, requestCount: 3 });
  });

  it('usa a solicitação não cancelada mais antiga e respeita o limite', async () => {
    const categoryId = await newCategory(a);
    const origin = await newOccurrence(a, 100, { categoryId });
    const target = await newOccurrence(a, 105, { requestCount: 2, categoryId });
    await newOccurrence(a, 110, { categoryId });
    await owner.db.execute(
      sql`update requests set status = 'cancelled'
          where id = (select id from requests where occurrence_id = ${target}
                      order by created_at, id limit 1)`,
    );
    const [oldest] = await owner.db
      .execute<{ description: string }>(
        sql`select description from requests where occurrence_id = ${target}
          and status <> 'cancelled' order by created_at, id limit 1`,
      )
      .then((result) => result.rows);

    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findMergeSuggestions(tx, { occurrenceId: origin, limit: 1 }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      occurrenceId: target,
      requestCount: 1,
      description: oldest!.description,
    });
  });

  it('não enxerga ocorrência de outra prefeitura', async () => {
    const categoryId = await newCategory(a);
    const origin = await newOccurrence(a, 200, { categoryId });
    await newOccurrence(b, 205);
    const found = await withContext(app.db, { tenantId: a.tenantId }, (tx) =>
      findMergeSuggestions(tx, { occurrenceId: origin }),
    );
    expect(found).toEqual([]);
  });
});

describe('dados de demonstração do painel', () => {
  it('seed cria admin da prefeitura, base da equipe e triagem com sugestão', async () => {
    const first = await seedDev(owner.db);
    await seedDev(owner.db);
    const { tenantId } = first;

    // Admin da prefeitura: acesso ao painel pelo vínculo tenant_admin.
    const admin = await findUserByCpf(app.db, TENANT_ADMIN_CPF);
    expect(admin).toMatchObject({ email: TENANT_ADMIN_EMAIL, hasPanelAccess: true });
    const adminLinks = await owner.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, admin!.id), eq(memberships.tenantId, tenantId)));
    expect(adminLinks.map((link) => link.role)).toEqual(['tenant_admin']);

    // Equipes: Centro com base, Norte com base e sem agentes, Limpeza sem base.
    const teamRows = await owner.db
      .select({
        name: teams.name,
        baseAddress: teams.baseAddress,
        distance: sql<number | null>`ST_Distance(${teams.baseLocation}::geography,
          ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326)::geography)`,
        department: departments.name,
      })
      .from(teams)
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .where(eq(teams.tenantId, tenantId));
    const byName = Object.fromEntries(teamRows.map((row) => [row.name, row]));
    expect(byName['Equipe Obras – Centro']).toMatchObject({
      baseAddress: 'Rua do Paço, 50',
      department: 'Obras',
    });
    expect(Number(byName['Equipe Obras – Centro']!.distance)).toBeGreaterThan(800);
    expect(Number(byName['Equipe Obras – Centro']!.distance)).toBeLessThan(1200);
    expect(Number(byName['Equipe Obras – Norte']!.distance)).toBeGreaterThan(4500);
    expect(Number(byName['Equipe Obras – Norte']!.distance)).toBeLessThan(5500);
    expect(byName['Equipe Limpeza – Centro']).toMatchObject({
      baseAddress: null,
      distance: null,
      department: 'Limpeza Urbana',
    });

    // Lixo e poda saíram de Obras.
    const catalog = await owner.db
      .select({ name: categories.name, department: departments.name })
      .from(categories)
      .innerJoin(departments, eq(departments.id, categories.departmentId))
      .where(eq(categories.tenantId, tenantId));
    const department = Object.fromEntries(catalog.map((row) => [row.name, row.department]));
    expect(department['Lixo e entulho']).toBe('Limpeza Urbana');
    expect(department['Poda de árvore']).toBe('Limpeza Urbana');
    expect(department['Buraco na via']).toBe('Obras');

    // Triagem de exemplo: cada fila com a idade e a quantidade de relatos do desenho.
    const triage = await triageRows(tenantId);
    const pothole = triage.filter((row) => row.category === 'Buraco na via');
    const big = pothole.find((row) => row.requests === 3)!;
    const small = pothole.find((row) => row.requests === 1)!;
    expect(big.citizens).toBe(3);
    expect(big.statusSinceH).toBeGreaterThan(47);
    expect(big.statusSinceH).toBeLessThan(49);
    expect(big.ageH).toBeCloseTo(big.statusSinceH, 1);

    const lighting = triage.find((row) => row.category === 'Iluminação')!;
    expect(lighting).toMatchObject({ requests: 1 });
    expect(lighting.statusSinceH).toBeGreaterThan(95);
    expect(lighting.statusSinceH).toBeLessThan(97);
    const sidewalk = triage.find((row) => row.category === 'Calçada')!;
    expect(sidewalk.statusSinceH).toBeGreaterThan(4.9);
    expect(sidewalk.statusSinceH).toBeLessThan(5.1);
    const litter = triage.find((row) => row.category === 'Lixo e entulho')!;
    expect(litter).toMatchObject({ requests: 2, department: 'Limpeza Urbana' });

    // A segunda ocorrência de buraco, a 10 m da primeira, vira sugestão de junção.
    const suggestions = await withContext(app.db, { tenantId }, (tx) =>
      findMergeSuggestions(tx, { occurrenceId: big.id, limit: 3 }),
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      occurrenceId: small.id,
      categoryName: 'Buraco na via',
      requestCount: 1,
    });
    expect(suggestions[0]!.distanceM).toBeGreaterThanOrEqual(9);
    expect(suggestions[0]!.distanceM).toBeLessThanOrEqual(11);
    // Sem duplicar na segunda execução.
    expect(pothole).toHaveLength(2);
  });

  it('com reset, recria a triagem de exemplo que foi tratada', async () => {
    const { tenantId } = await seedDev(owner.db);
    const before = await triageRows(tenantId);
    const big = before.find((row) => row.category === 'Buraco na via' && row.requests === 3)!;
    await owner.db
      .update(occurrences)
      .set({ status: 'rejected', rejectionReason: 'Teste' })
      .where(eq(occurrences.id, big.id));

    await seedDev(owner.db, { reset: true });

    const after = await triageRows(tenantId);
    const recreated = after.filter((row) => row.category === 'Buraco na via' && row.requests === 3);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.id).not.toBe(big.id);
    expect(after).toHaveLength(before.length);
  });

  it('com reset, recusa as sobras do painel e não duplica as atividades da demo', async () => {
    const seeded = await seedDev(owner.db);
    const { tenantId } = seeded;
    const before = await triageRows(tenantId);
    const big = before.find((row) => row.category === 'Buraco na via' && row.requests === 3)!;
    const lighting = before.find((row) => row.category === 'Iluminação')!;

    // Sobra de uma separação: um relato da ocorrência grande levado a uma ocorrência nova.
    const [moved] = await owner.db
      .select({ id: requests.id, location: requests.location })
      .from(requests)
      .where(eq(requests.occurrenceId, big.id))
      .orderBy(desc(requests.createdAt))
      .limit(1);
    const [split] = await owner.db
      .insert(occurrences)
      .values({
        tenantId,
        categoryId: (await categoryIdOf(tenantId, 'Buraco na via'))!,
        location: moved!.location,
        status: 'triage',
      })
      .returning({ id: occurrences.id });
    await owner.db
      .update(requests)
      .set({ occurrenceId: split!.id })
      .where(eq(requests.id, moved!.id));

    // Sobra de uma atribuição: a iluminação foi para a equipe, com atividade ativa.
    await owner.db
      .update(occurrences)
      .set({ status: 'in_progress' })
      .where(eq(occurrences.id, lighting.id));
    await owner.db
      .update(requests)
      .set({ status: 'in_progress' })
      .where(eq(requests.occurrenceId, lighting.id));
    const [assigned] = await owner.db
      .insert(workOrders)
      .values({ tenantId, occurrenceId: lighting.id, teamId: seeded.teamId, status: 'assigned' })
      .returning({ id: workOrders.id });

    const first = await seedDev(owner.db, { reset: true });
    const second = await seedDev(owner.db, { reset: true });

    // A triagem volta ao desenho, sem as sobras.
    const after = await triageRows(tenantId);
    expect(after.map((row) => [row.category, row.requests])).toEqual(
      before.map((row) => [row.category, row.requests]),
    );
    for (const id of [big.id, split!.id, lighting.id]) {
      const [row] = await owner.db
        .select({ status: occurrences.status, reason: occurrences.rejectionReason })
        .from(occurrences)
        .where(eq(occurrences.id, id));
      expect(row).toEqual({ status: 'rejected', reason: RESET_REJECTION_REASON });
      const pending = await owner.db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.occurrenceId, id));
      expect(pending.every((request) => request.status === 'rejected')).toBe(true);
      const [event] = await owner.db
        .select({ from: statusEvents.fromStatus, actor: statusEvents.actorUserId })
        .from(statusEvents)
        .where(
          and(
            eq(statusEvents.occurrenceId, id),
            isNull(statusEvents.requestId),
            isNull(statusEvents.workOrderId),
            eq(statusEvents.toStatus, 'rejected'),
          ),
        );
      expect(event).toMatchObject({ actor: seeded.managerId });
    }
    const [cancelled] = await owner.db
      .select({ status: workOrders.status })
      .from(workOrders)
      .where(eq(workOrders.id, assigned!.id));
    expect(cancelled!.status).toBe('cancelled');

    // Em atendimento só ficam as 4 atividades do agente e as 3 da fila do painel, uma vez cada,
    // mesmo após dois resets.
    const inProgress = await owner.db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.tenantId, tenantId), eq(occurrences.status, 'in_progress')));
    expect(inProgress).toHaveLength(7);
    const active = await owner.db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.teamId, seeded.teamId),
          inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
        ),
      );
    expect(active.map((order) => order.id).toSorted()).toEqual(
      [...second.workOrderIds, ...second.panelWorkOrderIds].toSorted(),
    );
    expect(second.workOrderIds).not.toEqual(first.workOrderIds);
    // Sem reset, nada muda.
    expect(await seedDev(owner.db)).toEqual(second);
    expect(await triageRows(tenantId)).toHaveLength(before.length);
  });
});

describe('fila de revisão e de impedimentos da demo', () => {
  /** A atividade ativa da ocorrência cujo relato tem esta descrição; uma só, mesmo após resets. */
  async function activeOrderOf(tenantId: string, description: string) {
    const rows = await owner.db
      .selectDistinct({ order: workOrders })
      .from(workOrders)
      .innerJoin(requests, eq(requests.occurrenceId, workOrders.occurrenceId))
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          eq(requests.description, description),
          inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
        ),
      );
    expect(rows).toHaveLength(1);
    return rows[0]!.order;
  }

  async function checkFixtures(seeded: Awaited<ReturnType<typeof seedDev>>) {
    const { tenantId, teamId, agentId } = seeded;
    const fixtures = [
      {
        description: DEMO_REVIEW_DESCRIPTIONS[0],
        status: 'awaiting_review',
        waitH: 30,
        details: { distanceM: 8 },
      },
      {
        description: DEMO_REVIEW_DESCRIPTIONS[1],
        status: 'awaiting_review',
        waitH: 3,
        details: { distanceM: 250 },
      },
      {
        description: DEMO_IMPEDIMENT_DESCRIPTION,
        status: 'impeded',
        waitH: 3,
        details: { reason: 'missing_material' },
      },
    ] as const;
    const ids: string[] = [];
    for (const fixture of fixtures) {
      const order = await activeOrderOf(tenantId, fixture.description);
      ids.push(order.id);
      expect(order).toMatchObject({ teamId, status: fixture.status });
      if (fixture.status === 'awaiting_review') {
        expect(order.agentNote).toBeTruthy();
        expect(order.completedAt).toBeInstanceOf(Date);
      } else {
        expect(order.impedimentReason).toBe('missing_material');
      }

      const [occurrence] = await owner.db
        .select({ status: occurrences.status })
        .from(occurrences)
        .where(eq(occurrences.id, order.occurrenceId));
      expect(occurrence!.status).toBe('in_progress');
      const reports = await owner.db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.occurrenceId, order.occurrenceId));
      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(reports.length).toBeLessThanOrEqual(2);
      for (const report of reports) expect(report.status).toBe('in_progress');

      // Sem foto: o endereço das fotos no navegador é pendência do Plano 8.
      expect(
        await owner.db.select().from(photos).where(eq(photos.workOrderId, order.id)),
      ).toHaveLength(0);

      // O evento mais recente da atividade é o do agente, com a distância ou o motivo.
      const [last] = await owner.db
        .select()
        .from(statusEvents)
        .where(eq(statusEvents.workOrderId, order.id))
        .orderBy(desc(statusEvents.createdAt))
        .limit(1);
      expect(last).toMatchObject({
        fromStatus: 'in_execution',
        toStatus: fixture.status,
        actorUserId: agentId,
      });
      expect(last!.details).toMatchObject(fixture.details);
      expect(last!.comment).toBeTruthy();
      const waitH = (Date.now() - last!.createdAt.getTime()) / 3_600_000;
      expect(waitH).toBeGreaterThan(fixture.waitH - 0.2);
      expect(waitH).toBeLessThan(fixture.waitH + 0.2);
    }
    expect(seeded.panelWorkOrderIds).toEqual(ids);
  }

  it('seed cria duas atividades em revisão e uma impedida', async () => {
    const first = await seedDev(owner.db);
    const second = await seedDev(owner.db);
    expect(second).toEqual(first);
    await checkFixtures(first);

    // O reset recria as três (as esperas voltam ao desenho) e não as recusa.
    const reset = await seedDev(owner.db, { reset: true });
    for (const id of first.panelWorkOrderIds) expect(reset.panelWorkOrderIds).not.toContain(id);
    await checkFixtures(reset);
    expect(await seedDev(owner.db)).toEqual(reset);

    // A que o gestor já decidiu volta na próxima execução.
    await owner.db
      .update(workOrders)
      .set({ status: 'completed' })
      .where(eq(workOrders.id, reset.panelWorkOrderIds[0]!));
    const after = await seedDev(owner.db);
    expect(after.panelWorkOrderIds[0]).not.toBe(reset.panelWorkOrderIds[0]);
    expect(after.panelWorkOrderIds.slice(1)).toEqual(reset.panelWorkOrderIds.slice(1));
    await checkFixtures(after);
  });

  it('seed mantém a atividade da fila devolvida ao agente, sem duplicar', async () => {
    const before = await seedDev(owner.db, { reset: true });
    const returned = before.panelWorkOrderIds[1]!;
    await owner.db
      .update(workOrders)
      .set({ status: 'rework_requested' })
      .where(eq(workOrders.id, returned));

    const after = await seedDev(owner.db);
    expect(after.panelWorkOrderIds).toEqual(before.panelWorkOrderIds);
    const order = await activeOrderOf(before.tenantId, DEMO_REVIEW_DESCRIPTIONS[1]);
    expect(order).toMatchObject({ id: returned, status: 'rework_requested' });
    const inProgress = await owner.db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.tenantId, before.tenantId), eq(occurrences.status, 'in_progress')));
    expect(inProgress).toHaveLength(7);

    // O reset volta a fila ao desenho.
    await checkFixtures(await seedDev(owner.db, { reset: true }));
  });
});

async function categoryIdOf(tenantId: string, name: string): Promise<string | undefined> {
  const [row] = await owner.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.name, name)));
  return row?.id;
}

interface TriageRow {
  id: string;
  category: string;
  department: string;
  requests: number;
  citizens: number;
  ageH: number;
  statusSinceH: number;
}

/** Ocorrências em triagem da prefeitura, com a idade do status vinda do evento da ocorrência. */
async function triageRows(tenantId: string): Promise<TriageRow[]> {
  const result = await withContext(owner.db, { tenantId }, (tx) =>
    tx.execute<{
      id: string;
      category: string;
      department: string;
      requests: number;
      citizens: number;
      age_h: number;
      since_h: number;
    }>(sql`
      select o.id, c.name as category, d.name as department,
        (select count(*)::int from requests r where r.occurrence_id = o.id) as requests,
        (select count(distinct r.citizen_id)::int from requests r where r.occurrence_id = o.id)
          as citizens,
        extract(epoch from (now() - o.created_at)) / 3600 as age_h,
        extract(epoch from (now() - (
          select max(e.created_at) from ${statusEvents} e
          where e.occurrence_id = o.id and e.request_id is null and e.work_order_id is null
            and e.to_status = 'triage'))) / 3600 as since_h
      from occurrences o
      join categories c on c.id = o.category_id
      join departments d on d.id = c.department_id
      where o.tenant_id = ${tenantId} and o.status = 'triage'
      order by o.created_at`),
  );
  return result.rows.map((row) => ({
    id: row.id,
    category: row.category,
    department: row.department,
    requests: row.requests,
    citizens: row.citizens,
    ageH: Number(row.age_h),
    statusSinceH: Number(row.since_h),
  }));
}
