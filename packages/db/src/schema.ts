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
  smallint,
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
/** Tipo de convite por e-mail: gestão (admin e gestor), agente e equipe interna. */
export const inviteKind = pgEnum('invite_kind', ['panel', 'agent', 'staff']);

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
 * Códigos enviados pelo WhatsApp ou e-mail. Guarda só o hash; app_user não lê nem grava:
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
 * O que a equipe interna fez dentro de uma prefeitura, ou no backoffice (sem prefeitura: equipe,
 * situação comercial). A prefeitura lê as suas; só inserção (UPDATE e DELETE não são concedidos
 * a app_user).
 */
export const staffAuditEvents = pgTable(
  'staff_audit_events',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  // Por pessoa da equipe: a saída implícita do modo suporte procura o último evento dela.
  (t) => [index().on(t.tenantId, t.createdAt), index().on(t.staffUserId, t.createdAt)],
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

/**
 * Bairros da malha do IBGE (dado público, leitura livre). `code` (CD_BAIRRO) identifica o bairro
 * e torna a importação repetível. Carregada pelo dono do banco (`pnpm db:import:neighborhoods`).
 */
export const ibgeNeighborhoods = pgTable(
  'ibge_neighborhoods',
  {
    id: id(),
    ibgeCode: text('ibge_code').notNull(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    boundary: multiPolygon('boundary').notNull(),
  },
  (t) => [
    index('ibge_neighborhoods_boundary_idx').using('gist', t.boundary),
    index('ibge_neighborhoods_ibge_code_idx').on(t.ibgeCode),
    check('ibge_neighborhoods_ibge_code_check', sql`${t.ibgeCode} ~ '^[0-9]{7}$'`),
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
    /** Base da equipe: a W2 mostra a distância até o ponto e sugere a mais próxima. */
    baseAddress: text('base_address'),
    baseLocation: geometry('base_location', { type: 'point', mode: 'xy', srid: 4326 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    // Nome único na prefeitura, sem diferenciar maiúsculas (W6: "team_name_taken").
    uniqueIndex('teams_tenant_name_idx').on(t.tenantId, sql`lower(${t.name})`),
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
    // Um agente fica em uma equipe só por prefeitura.
    uniqueIndex('team_members_tenant_user_idx').on(t.tenantId, t.userId),
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
    /** Bairro do ponto, calculado por gatilho a partir das camadas de bairros; nunca do endereço. */
    neighborhood: text('neighborhood'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    index().on(t.tenantId, t.neighborhood),
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
    check(
      'occurrences_merged_into_check',
      sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null) and ${t.mergedIntoId} <> ${t.id}`,
    ),
  ],
);

/**
 * Bairros próprios da prefeitura: quando existem, valem no lugar da malha do IBGE. Só a equipe
 * (admin) grava, pelas funções `replace_tenant_neighborhoods` e `clear_tenant_neighborhoods`.
 */
export const tenantNeighborhoods = pgTable(
  'tenant_neighborhoods',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    boundary: multiPolygon('boundary').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.name),
    index('tenant_neighborhoods_boundary_idx').using('gist', t.boundary),
  ],
);

/**
 * Par de ocorrências que o gestor marcou como "é outro problema": a sugestão de junção não volta
 * para nenhum dos dois lados. O par fica ordenado (menor id, maior id) para valer uma vez só.
 */
export const occurrenceSeparations = pgTable(
  'occurrence_separations',
  {
    tenantId: tenantId(),
    occurrenceAId: uuid('occurrence_a_id').notNull(),
    occurrenceBId: uuid('occurrence_b_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.occurrenceAId, t.occurrenceBId] }),
    foreignKey({
      columns: [t.tenantId, t.occurrenceAId],
      foreignColumns: [occurrences.tenantId, occurrences.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.occurrenceBId],
      foreignColumns: [occurrences.tenantId, occurrences.id],
    }),
    check('occurrence_separations_order_check', sql`${t.occurrenceAId} < ${t.occurrenceBId}`),
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
    // Candidatas da confirmação automática (auto_confirm_requests).
    index('requests_awaiting_confirmation_idx')
      .on(t.statusChangedAt)
      .where(sql`${t.status} = 'awaiting_confirmation'`),
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

/**
 * Fila de avisos (push e e-mail) criados pelo gatilho dos eventos de status.
 * Sem GRANT para app_user: só as funções SECURITY DEFINER leem e escrevem.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    channel: text('channel', { enum: ['push', 'email'] }).notNull(),
    kind: text('kind').notNull(),
    protocol: text('protocol').notNull(),
    requestId: uuid('request_id'),
    workOrderId: uuid('work_order_id'),
    details: jsonb('details'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    check('notification_outbox_channel_check', sql`${t.channel} in ('push', 'email')`),
    check(
      'notification_outbox_status_check',
      sql`${t.status} in ('pending', 'sent', 'failed', 'skipped')`,
    ),
    index('notification_outbox_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Avisos do sino do painel: cada pessoa vê só os seus, na prefeitura atual. */
export const panelNotifications = pgTable(
  'panel_notifications',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    protocol: text('protocol').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    workOrderId: uuid('work_order_id'),
    details: jsonb('details'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.occurrenceId],
      foreignColumns: [occurrences.tenantId, occurrences.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    index('panel_notifications_user_idx').on(t.userId, t.tenantId, t.createdAt.desc()),
  ],
);

/**
 * Cada envio de convite por e-mail. Serve para achar o agente que ainda não recebeu (nenhuma linha
 * `agent` no par pessoa/prefeitura) e para o limite de reenvio. `tenant_id` nulo só no convite da
 * equipe interna. Sem GRANT para app_user: só as funções SECURITY DEFINER leem e escrevem.
 */
export const inviteDeliveries = pgTable(
  'invite_deliveries',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    kind: inviteKind('kind').notNull(),
    sentBy: uuid('sent_by').references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.userId, t.tenantId, t.kind, t.sentAt.desc()),
    check('invite_deliveries_tenant_check', sql`(${t.kind} = 'staff') = (${t.tenantId} is null)`),
  ],
);

/**
 * Contato da página de apresentação (alocidadao.com.br): uma linha só (`id = 1`), criada pela
 * migração. Leitura livre (a rota pública não tem login); só o admin da plataforma altera.
 */
export const siteContact = pgTable(
  'site_contact',
  {
    id: smallint('id').primaryKey().default(1),
    /** Celular do WhatsApp em E.164. */
    whatsapp: text('whatsapp').notNull(),
    email: text('email').notNull(),
    /** Frase embaixo do WhatsApp, como "Resposta no mesmo dia". */
    responseNote: text('response_note').notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [check('site_contact_single_row_check', sql`${t.id} = 1`)],
);
