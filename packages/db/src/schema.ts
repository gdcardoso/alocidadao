import {
  DEFAULT_CLUSTER_RADIUS_M,
  ICON_GROUPS,
  OCCURRENCE_STATUSES,
  PHOTO_REVIEWS,
  REQUEST_STATUSES,
  TENANT_ROLES,
  WORK_ORDER_STATUSES,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  foreignKey,
  geometry,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Convenções de isolamento (ver docs/decisoes/0001-isolamento-por-prefeitura.md):
// - Toda tabela da prefeitura tem `tenant_id` e uma política RLS (migração rls).
// - Toda tabela da prefeitura expõe UNIQUE (tenant_id, id), e as referências
//   entre elas usam FK composta (tenant_id, x_id): um registro nunca aponta
//   para outro de prefeitura diferente, mesmo que o id seja conhecido.

const multiPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});

const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const tenantRole = pgEnum('tenant_role', TENANT_ROLES);
export const requestStatus = pgEnum('request_status', REQUEST_STATUSES);
export const workOrderStatus = pgEnum('work_order_status', WORK_ORDER_STATUSES);
export const occurrenceStatus = pgEnum('occurrence_status', OCCURRENCE_STATUSES);
export const photoReview = pgEnum('photo_review', PHOTO_REVIEWS);
export const iconGroup = pgEnum('icon_group', ICON_GROUPS);

// ── Tabelas globais (sem tenant_id) ────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  state: char('state', { length: 2 }).notNull(),
  ibgeCode: text('ibge_code').notNull().unique(),
  boundary: multiPolygon('boundary'),
  active: boolean('active').notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    cpf: text('cpf').unique(),
    passwordHash: text('password_hash').notNull(),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

// ── Tabelas da prefeitura ──────────────────────────────────────────────────

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: tenantRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.userId, t.role), index().on(t.userId)],
);

export const departments = pgTable(
  'departments',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.id), unique().on(t.tenantId, t.name)],
);

export const departmentManagers = pgTable(
  'department_managers',
  {
    tenantId: tenantId(),
    departmentId: uuid('department_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.userId] }),
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    tenantId: tenantId(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id] }),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    iconGroup: iconGroup('icon_group').notNull().default('infrastructure'),
    // Distância máxima para agrupar uma solicitação nova numa ocorrência aberta da categoria.
    clusterRadiusM: integer('cluster_radius_m').notNull().default(DEFAULT_CLUSTER_RADIUS_M),
    defaultDeadlineDays: integer('default_deadline_days').notNull().default(7),
    extraFields: jsonb('extra_fields').notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    unique().on(t.tenantId, t.name),
    foreignKey({
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    check('categories_cluster_radius_m_check', sql`${t.clusterRadiusM} between 1 and 500`),
  ],
);

/**
 * O problema no local (o buraco, o poste): agrupa as solicitações de vários cidadãos.
 * A gestão trabalha sobre a ocorrência; cada cidadão acompanha a própria solicitação.
 */
export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    tenantId: tenantId(),
    categoryId: uuid('category_id').notNull(),
    /** Ponto central da ocorrência. */
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    status: occurrenceStatus('status').notNull().default('triage'),
    mergedIntoId: uuid('merged_into_id'),
    /** Motivo da recusa, visto pelo cidadão. */
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    // Alvo da FK das solicitações: garante que a solicitação tem a categoria da ocorrência.
    unique().on(t.tenantId, t.id, t.categoryId),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.mergedIntoId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index().on(t.tenantId, t.status),
    index('occurrences_location_idx').using('gist', t.location),
  ],
);

/** Contador do protocolo sequencial por prefeitura e ano (usado por next_request_protocol()). */
export const requestCounters = pgTable(
  'request_counters',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

export const requests = pgTable(
  'requests',
  {
    id: id(),
    tenantId: tenantId(),
    protocol: text('protocol')
      .notNull()
      .default(sql`next_request_protocol()`),
    citizenId: uuid('citizen_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    status: requestStatus('status').notNull().default('open'),
    description: text('description').notNull(),
    /** Local do relato, ajustado pelo cidadão (no máximo 200 m do GPS, ver MAX_LOCATION_ADJUST_M). */
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    /** Posição do GPS do aparelho no momento do relato. */
    gpsLocation: geometry('gps_location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    address: text('address'),
    extra: jsonb('extra').notNull().default({}),
    dueAt: timestamp('due_at', { withTimezone: true }),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    unique().on(t.tenantId, t.protocol),
    // A categoria da solicitação é sempre a da ocorrência: reclassificar a ocorrência
    // leva as solicitações junto (ON UPDATE CASCADE).
    foreignKey({
      columns: [t.tenantId, t.occurrenceId, t.categoryId],
      foreignColumns: [occurrences.tenantId, occurrences.id, occurrences.categoryId],
    }).onUpdate('cascade'),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
    }),
    index().on(t.tenantId, t.status),
    index().on(t.citizenId),
    index('requests_location_idx').using('gist', t.location),
    index().on(t.occurrenceId),
    // O shared recusa ajuste acima de 200 m (haversine); a trava do banco tem folga de 5 m
    // para não recusar o que o shared aceitou por diferença de cálculo.
    check(
      'requests_location_adjust_check',
      sql`ST_DWithin(${t.location}::geography, ${t.gpsLocation}::geography, 205)`,
    ),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    id: id(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    teamId: uuid('team_id').notNull(),
    status: workOrderStatus('status').notNull().default('assigned'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** Orientações do gestor para a equipe. */
    managerInstructions: text('manager_instructions'),
    /** Relato original do agente ao concluir; não é mostrado ao cidadão. */
    agentNote: text('agent_note'),
    /** Texto revisado pelo gestor e publicado para o cidadão. */
    publicNote: text('public_note'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    impedimentReason: text('impediment_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.occurrenceId],
      foreignColumns: [occurrences.tenantId, occurrences.id],
    }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id] }),
    // No máximo uma atividade ativa por ocorrência. Impedida conta como ativa:
    // o gestor ainda decide se reagenda ou cancela.
    uniqueIndex('work_orders_one_active_per_occurrence_idx')
      .on(t.occurrenceId)
      .where(sql`${t.status} not in ('completed', 'cancelled')`),
    index().on(t.tenantId, t.teamId, t.status),
  ],
);

/** Histórico de status: só inserção (UPDATE e DELETE são revogados de app_user). */
export const statusEvents = pgTable(
  'status_events',
  {
    id: id(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    requestId: uuid('request_id'),
    workOrderId: uuid('work_order_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    comment: text('comment'),
    connection: jsonb('connection'),
    /** Dados do evento além do comentário: motivos da devolução, fotos descartadas. */
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.occurrenceId],
      foreignColumns: [occurrences.tenantId, occurrences.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    index().on(t.requestId, t.createdAt),
    index().on(t.occurrenceId, t.createdAt),
  ],
);

/**
 * Fotos de uma solicitação (enviadas pelo cidadão) ou de uma atividade (enviadas pelo agente).
 * Só as fotos da atividade passam pela revisão do gestor antes de chegar ao cidadão.
 */
export const photos = pgTable(
  'photos',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id'),
    workOrderId: uuid('work_order_id'),
    storageKey: text('storage_key').notNull().unique(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    review: photoReview('review'),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    index().on(t.requestId),
    index().on(t.workOrderId),
    check('photos_owner_check', sql`num_nonnulls(${t.requestId}, ${t.workOrderId}) = 1`),
    check('photos_review_check', sql`(${t.workOrderId} is null) = (${t.review} is null)`),
  ],
);

/**
 * Ações feitas no aparelho (possivelmente offline) e a resposta dada a cada uma.
 * O id nasce no aparelho: reenviar a mesma ação devolve a resposta guardada em vez de repetir o efeito.
 * Só inserção (UPDATE e DELETE são revogados de app_user).
 */
export const clientActions = pgTable(
  'client_actions',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    targetId: uuid('target_id'),
    response: jsonb('response').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.id)],
);
