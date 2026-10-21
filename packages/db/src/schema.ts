import { REQUEST_STATUSES, TENANT_ROLES, WORK_ORDER_STATUSES } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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
    status: requestStatus('status').notNull().default('open'),
    description: text('description').notNull(),
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    address: text('address'),
    extra: jsonb('extra').notNull().default({}),
    duplicateOfId: uuid('duplicate_of_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    unique().on(t.tenantId, t.protocol),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.duplicateOfId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index().on(t.tenantId, t.status),
    index().on(t.citizenId),
    index('requests_location_idx').using('gist', t.location),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    teamId: uuid('team_id').notNull(),
    status: workOrderStatus('status').notNull().default('assigned'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completionNote: text('completion_note'),
    impedimentReason: text('impediment_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.requestId],
      foreignColumns: [requests.tenantId, requests.id],
    }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id] }),
    // No máximo uma atividade ativa por solicitação.
    uniqueIndex('work_orders_one_active_per_request_idx')
      .on(t.requestId)
      .where(sql`${t.status} in ('assigned', 'in_execution')`),
    index().on(t.tenantId, t.teamId, t.status),
  ],
);

/** Histórico de status: só inserção (UPDATE e DELETE são revogados de app_user). */
export const statusEvents = pgTable(
  'status_events',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    workOrderId: uuid('work_order_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    comment: text('comment'),
    connection: jsonb('connection'),
    createdAt: createdAt(),
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
    index().on(t.requestId, t.createdAt),
  ],
);
