import { randomInt, randomUUID } from 'node:crypto';
import { geoPoint, schema, withContext, type Database } from '@alocidadao/db';
import type { GeoPoint, TENANT_ROLES, TenantStatus } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';

const {
  users,
  tenants,
  memberships,
  departments,
  departmentManagers,
  categories,
  teams,
  teamMembers,
  occurrences,
  requests,
  photos,
  statusEvents,
  workOrders,
} = schema;

type OccurrenceStatus = (typeof occurrences.$inferInsert)['status'];
type RequestStatus = (typeof requests.$inferInsert)['status'];
type WorkOrderStatus = (typeof workOrders.$inferInsert)['status'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante `days` dias atrás (aceita fração). */
export const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** Ponto a `meters` metros ao norte (positivo) ou ao sul (negativo) de `point`. */
export const metersNorth = (point: GeoPoint, meters: number): GeoPoint => ({
  lat: point.lat + meters / 111_320,
  lng: point.lng,
});

const newPhone = () => `+55419${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/**
 * Montagem de dados para os testes do painel, gravados como dono do banco (`owner`), no
 * contexto da prefeitura quando a tabela tem RLS.
 */
export function panelFixtures(owner: Database) {
  async function createUser(name: string) {
    const [user] = await owner.insert(users).values({ name, phone: newPhone() }).returning();
    return user!.id;
  }

  /** Cidadão de teste: nada dele (nome, telefone, e-mail) pode sair nas respostas do painel. */
  async function createCitizen() {
    const [user] = await owner
      .insert(users)
      .values({
        name: 'Cidadã Sigilosa',
        phone: newPhone(),
        email: `sigilosa.${randomUUID()}@teste.dev`,
      })
      .returning();
    return { id: user!.id, name: user!.name, phone: user!.phone!, email: user!.email! };
  }

  async function createTenant(status: TenantStatus = 'active') {
    const [tenant] = await owner
      .insert(tenants)
      .values({
        name: 'Município do Painel',
        displayName: 'Prefeitura do Painel',
        city: 'Painel',
        state: 'PR',
        ibgeCode: String(randomInt(1_000_000, 9_999_999)),
        status,
      })
      .returning();
    return tenant!.id;
  }

  async function link(
    tenantId: string,
    userId: string,
    role: (typeof TENANT_ROLES)[number],
    status: 'active' | 'inactive' = 'active',
  ) {
    await owner.insert(memberships).values({ tenantId, userId, role, status });
  }

  /** Gestor com vínculo ativo e os setores dados. */
  async function newManager(tenantId: string, departmentIds: string[], name = 'Gestor') {
    const userId = await createUser(name);
    await link(tenantId, userId, 'manager');
    if (departmentIds.length > 0) {
      await withContext(owner, { tenantId }, (tx) =>
        tx
          .insert(departmentManagers)
          .values(departmentIds.map((departmentId) => ({ tenantId, departmentId, userId }))),
      );
    }
    return userId;
  }

  async function newAdmin(tenantId: string) {
    const userId = await createUser('Admin da Prefeitura');
    await link(tenantId, userId, 'tenant_admin');
    return userId;
  }

  /**
   * Prefeitura ativa com dois setores, Obras (categoria Buraco, raio 50 m, prazo 5 dias) e
   * Iluminação (categoria Poste apagado), e um cidadão.
   */
  async function seedPanelTenant() {
    const tenantId = await createTenant();
    const citizen = await createCitizen();
    return withContext(owner, { tenantId }, async (tx) => {
      const [works, lights] = await tx
        .insert(departments)
        .values([
          { tenantId, name: 'Obras' },
          { tenantId, name: 'Iluminação' },
        ])
        .returning();
      const [pothole, lamp] = await tx
        .insert(categories)
        .values([
          {
            tenantId,
            departmentId: works!.id,
            name: 'Buraco',
            icon: 'construction',
            iconGroup: 'infrastructure',
            clusterRadiusM: 50,
            defaultDeadlineDays: 5,
          },
          {
            tenantId,
            departmentId: lights!.id,
            name: 'Poste apagado',
            icon: 'lightbulb',
            iconGroup: 'infrastructure',
            clusterRadiusM: 50,
          },
        ])
        .returning();
      return {
        tenantId,
        citizen,
        citizenId: citizen.id,
        worksId: works!.id,
        lightsId: lights!.id,
        potholeId: pothole!.id,
        lampId: lamp!.id,
      };
    });
  }

  async function addOccurrence(
    tenantId: string,
    input: {
      categoryId: string;
      at: GeoPoint;
      status?: OccurrenceStatus;
      createdAt?: Date;
      mergedIntoId?: string;
    },
  ) {
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(occurrences)
        .values({
          tenantId,
          categoryId: input.categoryId,
          location: geoPoint(input.at),
          status: input.status ?? 'triage',
          mergedIntoId: input.mergedIntoId,
          createdAt: input.createdAt,
        })
        .returning(),
    );
    return row!.id;
  }

  async function addRequest(
    tenantId: string,
    input: {
      occurrenceId: string;
      categoryId: string;
      citizenId: string;
      at: GeoPoint;
      description?: string;
      address?: string | null;
      status?: RequestStatus;
      createdAt?: Date;
    },
  ) {
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(requests)
        .values({
          tenantId,
          occurrenceId: input.occurrenceId,
          categoryId: input.categoryId,
          citizenId: input.citizenId,
          description: input.description ?? '',
          location: geoPoint(input.at),
          gpsLocation: geoPoint(input.at),
          address: input.address ?? null,
          status: input.status ?? 'open',
          createdAt: input.createdAt,
        })
        .returning({ id: requests.id, protocol: requests.protocol }),
    );
    return row!;
  }

  /** Evento de status da ocorrência (sem solicitação nem atividade), ou da solicitação dada. */
  async function addOccurrenceEvent(
    tenantId: string,
    input: { occurrenceId: string; toStatus: string; at: Date; requestId?: string },
  ) {
    await withContext(owner, { tenantId }, (tx) =>
      tx.insert(statusEvents).values({
        tenantId,
        occurrenceId: input.occurrenceId,
        requestId: input.requestId,
        toStatus: input.toStatus,
        createdAt: input.at,
      }),
    );
  }

  async function addReportPhoto(
    tenantId: string,
    input: { requestId: string; uploadedBy: string; createdAt?: Date },
  ) {
    const storageKey = `requests/${randomUUID()}.jpg`;
    await withContext(owner, { tenantId }, (tx) =>
      tx.insert(photos).values({
        tenantId,
        requestId: input.requestId,
        storageKey,
        uploadedBy: input.uploadedBy,
        purpose: 'report',
        createdAt: input.createdAt,
      }),
    );
    return storageKey;
  }

  async function addTeam(
    tenantId: string,
    input: { departmentId: string; name: string; base?: GeoPoint },
  ) {
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(teams)
        .values({
          tenantId,
          departmentId: input.departmentId,
          name: input.name,
          baseAddress: input.base ? `Base ${input.name}` : null,
          baseLocation: input.base ? geoPoint(input.base) : null,
        })
        .returning(),
    );
    return row!.id;
  }

  /** Agente na equipe, com vínculo `field_agent` ativo ou inativo. */
  async function addAgent(tenantId: string, teamId: string, status: 'active' | 'inactive') {
    const userId = await createUser('Agente de Campo');
    await link(tenantId, userId, 'field_agent', status);
    await withContext(owner, { tenantId }, (tx) =>
      tx.insert(teamMembers).values({ tenantId, teamId, userId }),
    );
    return userId;
  }

  async function addWorkOrder(
    tenantId: string,
    input: { occurrenceId: string; teamId: string; status: WorkOrderStatus },
  ) {
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(workOrders)
        .values({ tenantId, ...input })
        .returning(),
    );
    return row!.id;
  }

  async function separate(tenantId: string, a: string, b: string) {
    const [low, high] = a < b ? [a, b] : [b, a];
    await withContext(owner, { tenantId }, (tx) =>
      tx.execute(sql`
        insert into occurrence_separations (tenant_id, occurrence_a_id, occurrence_b_id)
        values (${tenantId}, ${low}, ${high})
      `),
    );
  }

  return {
    createUser,
    createCitizen,
    createTenant,
    link,
    newManager,
    newAdmin,
    seedPanelTenant,
    addOccurrence,
    addRequest,
    addOccurrenceEvent,
    addReportPhoto,
    addTeam,
    addAgent,
    addWorkOrder,
    separate,
  };
}
