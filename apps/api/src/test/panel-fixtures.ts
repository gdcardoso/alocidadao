import { randomInt, randomUUID } from 'node:crypto';
import { geoPoint, schema, withContext, type Database } from '@alocidadao/db';
import type { GeoPoint, TENANT_ROLES, TenantStatus } from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';

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
    input: {
      occurrenceId: string;
      teamId: string;
      status: WorkOrderStatus;
      dueAt?: Date;
      agentNote?: string;
      impedimentReason?: string;
      managerInstructions?: string;
    },
  ) {
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(workOrders)
        .values({ tenantId, ...input })
        .returning(),
    );
    return row!.id;
  }

  /** Evento de status da atividade (conclusão ou impedimento do agente, por exemplo). */
  async function addWorkOrderEvent(
    tenantId: string,
    input: {
      occurrenceId: string;
      workOrderId: string;
      toStatus: string;
      at: Date;
      actorUserId?: string;
      comment?: string;
      details?: Record<string, unknown>;
    },
  ) {
    await withContext(owner, { tenantId }, (tx) =>
      tx.insert(statusEvents).values({
        tenantId,
        occurrenceId: input.occurrenceId,
        workOrderId: input.workOrderId,
        toStatus: input.toStatus,
        actorUserId: input.actorUserId,
        comment: input.comment,
        details: input.details,
        createdAt: input.at,
      }),
    );
  }

  /** Foto do agente na atividade: conclusão (padrão, pendente) ou impedimento. */
  async function addWorkOrderPhoto(
    tenantId: string,
    input: {
      workOrderId: string;
      uploadedBy: string;
      purpose?: 'completion' | 'impediment';
      review?: 'pending' | 'published' | 'discarded';
      createdAt?: Date;
    },
  ) {
    const storageKey = `${tenantId}/uploads/${randomUUID()}.jpg`;
    const [row] = await withContext(owner, { tenantId }, (tx) =>
      tx
        .insert(photos)
        .values({
          tenantId,
          workOrderId: input.workOrderId,
          storageKey,
          uploadedBy: input.uploadedBy,
          purpose: input.purpose ?? 'completion',
          review: input.review ?? 'pending',
          createdAt: input.createdAt,
        })
        .returning({ id: photos.id }),
    );
    return { id: row!.id, storageKey };
  }

  /** Foto de contestação do cidadão na solicitação. */
  async function addContestPhoto(
    tenantId: string,
    input: { requestId: string; uploadedBy: string },
  ) {
    const storageKey = `requests/${randomUUID()}.jpg`;
    await withContext(owner, { tenantId }, (tx) =>
      tx.insert(photos).values({
        tenantId,
        requestId: input.requestId,
        storageKey,
        uploadedBy: input.uploadedBy,
        purpose: 'contest',
      }),
    );
    return storageKey;
  }

  /**
   * Atividade aguardando revisão: ocorrência em atendimento com uma solicitação em atendimento,
   * agente com evento de conclusão há `hoursAgo` horas (a `distanceM` do local) e uma foto
   * pendente por chave de `photoCount`.
   */
  async function seedReview(
    seed: { tenantId: string; citizenId: string; potholeId: string },
    input: {
      teamId: string;
      at: GeoPoint;
      hoursAgo?: number;
      distanceM?: number;
      photoCount?: number;
      address?: string;
    },
  ) {
    const { tenantId } = seed;
    const occurrenceId = await addOccurrence(tenantId, {
      categoryId: seed.potholeId,
      at: input.at,
      status: 'in_progress',
    });
    const request = await addRequest(tenantId, {
      occurrenceId,
      categoryId: seed.potholeId,
      citizenId: seed.citizenId,
      at: input.at,
      address: input.address ?? 'Rua da Revisão, 10',
      status: 'in_progress',
    });
    const reportKey = await addReportPhoto(tenantId, {
      requestId: request.id,
      uploadedBy: seed.citizenId,
    });
    const workOrderId = await addWorkOrder(tenantId, {
      occurrenceId,
      teamId: input.teamId,
      status: 'awaiting_review',
      agentNote: 'Buraco tapado com massa asfáltica.',
    });
    // O agente tem vínculo na prefeitura, e por isso o painel pode ler o nome dele (RLS).
    const agentId = await addAgent(tenantId, input.teamId, 'active');
    await owner.update(users).set({ name: 'Agente Revisão' }).where(eq(users.id, agentId));
    await addWorkOrderEvent(tenantId, {
      occurrenceId,
      workOrderId,
      toStatus: 'awaiting_review',
      at: new Date(Date.now() - (input.hoursAgo ?? 1) * 3_600_000),
      actorUserId: agentId,
      comment: 'Buraco tapado com massa asfáltica.',
      details: { location: input.at, distanceM: input.distanceM ?? 8 },
    });
    const photoIds: string[] = [];
    for (let i = 0; i < (input.photoCount ?? 2); i += 1) {
      const photo = await addWorkOrderPhoto(tenantId, {
        workOrderId,
        uploadedBy: agentId,
        createdAt: new Date(Date.now() - 60_000 + i * 1000),
      });
      photoIds.push(photo.id);
    }
    return { occurrenceId, requestId: request.id, workOrderId, agentId, photoIds, reportKey };
  }

  /**
   * Atividade impedida: ocorrência em atendimento com uma solicitação em atendimento, agente com
   * evento de impedimento há `hoursAgo` horas (motivo, relato e foto `impediment`).
   */
  async function seedImpediment(
    seed: { tenantId: string; citizenId: string; potholeId: string },
    input: {
      teamId: string;
      at: GeoPoint;
      hoursAgo?: number;
      reason?: string;
      note?: string;
      withPhoto?: boolean;
      address?: string;
    },
  ) {
    const { tenantId } = seed;
    const occurrenceId = await addOccurrence(tenantId, {
      categoryId: seed.potholeId,
      at: input.at,
      status: 'in_progress',
    });
    const request = await addRequest(tenantId, {
      occurrenceId,
      categoryId: seed.potholeId,
      citizenId: seed.citizenId,
      at: input.at,
      address: input.address ?? 'Rua do Impedimento, 20',
      status: 'in_progress',
    });
    const reason = input.reason ?? 'missing_material';
    const workOrderId = await addWorkOrder(tenantId, {
      occurrenceId,
      teamId: input.teamId,
      status: 'impeded',
      impedimentReason: reason,
      managerInstructions: 'Levar o cone.',
    });
    const agentId = await addAgent(tenantId, input.teamId, 'active');
    await owner.update(users).set({ name: 'Agente Impedido' }).where(eq(users.id, agentId));
    await addWorkOrderEvent(tenantId, {
      occurrenceId,
      workOrderId,
      toStatus: 'impeded',
      at: new Date(Date.now() - (input.hoursAgo ?? 1) * 3_600_000),
      actorUserId: agentId,
      comment: input.note ?? 'Faltou massa asfáltica.',
      details: { reason, location: input.at, distanceM: 12 },
    });
    const photo =
      input.withPhoto === false
        ? undefined
        : await addWorkOrderPhoto(tenantId, {
            workOrderId,
            uploadedBy: agentId,
            purpose: 'impediment',
          });
    return { occurrenceId, requestId: request.id, workOrderId, agentId, photoId: photo?.id };
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
    addWorkOrderEvent,
    addWorkOrderPhoto,
    addContestPhoto,
    seedReview,
    seedImpediment,
    separate,
  };
}
