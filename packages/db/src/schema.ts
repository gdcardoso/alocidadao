import {
  ACCOUNT_STATUSES,
  COMMERCIAL_STATUSES,
  DEFAULT_CLUSTER_RADIUS_M,
  ICON_GROUPS,
  MEMBERSHIP_STATUSES,
  OCCURRENCE_STATUSES,
  PHOTO_PURPOSES,
  PHOTO_REVIEWS,
  PLATFORM_ROLES,
  REQUEST_STATUSES,
  TENANT_ROLES,
  TENANT_STATUSES,
  WORK_ORDER_STATUSES,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  date,
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
export const photoPurpose = pgEnum('photo_purpose', PHOTO_PURPOSES);
export const iconGroup = pgEnum('icon_group', ICON_GROUPS);
export const tenantStatus = pgEnum('tenant_status', TENANT_STATUSES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);
export const platformRole = pgEnum('platform_role', PLATFORM_ROLES);
export const commercialStatus = pgEnum('commercial_status', COMMERCIAL_STATUSES);

// ── Tabelas globais (sem tenant_id) ────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  /** Nome mostrado no app e no painel. */
  displayName: text('display_name').notNull(),
  city: text('city').notNull(),
  state: char('state', { length: 2 }).notNull(),
  ibgeCode: text('ibge_code').notNull().unique(),
  boundary: multiPolygon('boundary'),
  status: tenantStatus('status').notNull().default('onboarding'),
  /** Telefone da central de atendimento da prefeitura. */
  centralPhone: text('central_phone'),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email'),
    /** E.164. Identifica a conta no login; o número pode ser reaproveitado por outra pessoa. */
    phone: text('phone'),
    /** Só os 11 dígitos. */
    cpf: text('cpf').unique(),
    accountStatus: accountStatus('account_status').notNull().default('active'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    /** Papel na equipe interna da plataforma; nulo para quem não é da equipe. */
    platformRole: platformRole('platform_role'),
    /** Versão dos Termos aceita no cadastro (TERMS_VERSION) e quando. */
    termsVersion: text('terms_version'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    /** Conta excluída: fica `frozen`, com os dados pessoais apagados. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
    // Número reaproveitado: a conta antiga é congelada e o telefone fica livre para a nova.
    uniqueIndex('users_phone_active_idx')
      .on(t.phone)
      .where(sql`${t.accountStatus} = 'active'`),
    check('users_phone_check', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('users_cpf_check', sql`${t.cpf} ~ '^[0-9]{11}$'`),
    // Conta excluída fica sem telefone e sem CPF.
    check(
      'users_phone_or_cpf_check',
      sql`${t.phone} is not null or ${t.cpf} is not null or ${t.deletedAt} is not null`,
    ),
  ],
);

// ── Acesso: códigos, sessões e aparelhos ──────────────────────────────────
// Políticas e funções na migração auth_functions.

/**
 * Códigos enviados por SMS ou e-mail. Guarda só o hash; app_user não lê nem grava:
 * tudo passa pelas funções auth_issue_code e auth_consume_code.
 */
export const verificationCodes = pgTable(
  'verification_codes',
  {
    /** Gerado na API: entra no hash do código. */
    id: uuid('id').primaryKey(),
    purpose: text('purpose', {
      enum: ['phone_login', 'phone_change', 'panel_login', 'account_recovery'],
    }).notNull(),
    /** Telefone (E.164) ou e-mail para onde o código foi. */
    target: text('target').notNull(),
    userId: uuid('user_id').references(() => users.id),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.purpose, t.target, t.createdAt),
    check(
      'verification_codes_purpose_check',
      sql`${t.purpose} in ('phone_login', 'phone_change', 'panel_login', 'account_recovery')`,
    ),
  ],
);

/** Sessões do app e do painel. O banco guarda só o sha256 do token de renovação. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    audience: text('audience', { enum: ['app', 'panel'] }).notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    installationId: uuid('installation_id'),
    /** Painel: a sessão vence após esse tempo sem renovação. Nulo no app (não expira). */
    idleTimeoutSeconds: integer('idle_timeout_seconds'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId),
    check('sessions_audience_check', sql`${t.audience} in ('app', 'panel')`),
  ],
);

/** Aparelhos em que a conta já entrou; definem o "aparelho conhecido" no login. */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    installationId: uuid('installation_id').notNull(),
    platform: text('platform', { enum: ['android', 'ios'] }).notNull(),
    appVersion: text('app_version').notNull(),
    pushToken: text('push_token'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.userId, t.installationId),
    check('devices_platform_check', sql`${t.platform} in ('android', 'ios')`),
  ],
);

// ── Tabelas da equipe interna da plataforma ────────────────────────────────
// Políticas próprias (migração platform_rls), não a tenant_isolation: o contrato e a
// auditoria têm tenant_id, mas quem escreve neles é a equipe interna, não a prefeitura.

/** Contratos da prefeitura com a plataforma. Lidos pela equipe interna; escritos só pelo admin. */
export const tenantContracts = pgTable(
  'tenant_contracts',
  {
    id: id(),
    tenantId: tenantId(),
    plan: text('plan').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    includedPanelUsers: integer('included_panel_users').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.tenantId),
    check('tenant_contracts_ends_on_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check('tenant_contracts_included_panel_users_check', sql`${t.includedPanelUsers} > 0`),
  ],
);

/**
 * O que a equipe interna fez dentro de uma prefeitura. A prefeitura lê; só inserção
 * (UPDATE e DELETE não são concedidos a app_user).
 */
export const staffAuditEvents = pgTable(
  'staff_audit_events',
  {
    id: id(),
    tenantId: tenantId(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.createdAt)],
);

/** Cidadão de um município sem prefeitura cadastrada avisando que quer o app lá. */
export const cityInterest = pgTable(
  'city_interest',
  {
    ibgeCode: char('ibge_code', { length: 7 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ibgeCode, t.userId] }),
    check('city_interest_ibge_code_check', sql`${t.ibgeCode} ~ '^[0-9]{7}$'`),
  ],
);

/** Situação comercial de cada município, mantida pela equipe interna. */
export const municipalityLeads = pgTable(
  'municipality_leads',
  {
    ibgeCode: char('ibge_code', { length: 7 }).primaryKey(),
    commercialStatus: commercialStatus('commercial_status').notNull().default('new'),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [check('municipality_leads_ibge_code_check', sql`${t.ibgeCode} ~ '^[0-9]{7}$'`)],
);

/**
 * Limites dos municípios do IBGE (dado público, leitura livre). Diz em que cidade o cidadão
 * está mesmo onde não há prefeitura cliente. Carregada pelo dono do banco
 * (`pnpm db:import:municipalities`); app_user só lê.
 */
export const municipalities = pgTable(
  'municipalities',
  {
    ibgeCode: char('ibge_code', { length: 7 }).primaryKey(),
    name: text('name').notNull(),
    state: char('state', { length: 2 }).notNull(),
    boundary: multiPolygon('boundary').notNull(),
  },
  (t) => [
    index('municipalities_boundary_idx').using('gist', t.boundary),
    check('municipalities_ibge_code_check', sql`${t.ibgeCode} ~ '^[0-9]{7}$'`),
  ],
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
    status: membershipStatus('status').notNull().default('active'),
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
    // Busca por raio em metros (ST_DWithin sobre geography), usada para achar ocorrências parecidas.
    index('occurrences_location_geog_idx').using('gist', sql`(${t.location}::geography)`),
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
    /**
     * Para que serve a foto: `report` (relato) e `contest` (contestação) são do cidadão, na
     * solicitação; `completion` (conclusão) e `impediment` (impedimento) são do agente, na atividade.
     */
    purpose: photoPurpose('purpose').notNull(),
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
    check(
      'photos_purpose_check',
      sql`(${t.purpose} in ('report', 'contest')) = (${t.requestId} is not null)`,
    ),
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
