import { schema, type Database, type Transaction } from '@alocidadao/db';
import {
  apiErrorSchema,
  categoriesResponseSchema,
  categoryCreateBodySchema,
  categoryRowSchema,
  categoryUpdateBodySchema,
  departmentBodySchema,
  departmentRowSchema,
  managerCreateBodySchema,
  managerRowSchema,
  managerUpdateBodySchema,
  managersResponseSchema,
  maskEmail,
  type CategoryCreateBody,
  type CategoryRow,
  type CategoryUpdateBody,
  type DepartmentBody,
  type DepartmentRow,
  type ManagerCreateBody,
  type ManagerRow,
  type ManagerUpdateBody,
} from '@alocidadao/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import {
  CATEGORY_NAME_CONSTRAINT,
  DEPARTMENT_NAME_CONSTRAINT,
  isPgError,
  isUniqueViolation,
  USER_CPF_CONSTRAINT,
  USER_EMAIL_CONSTRAINT,
  violatedConstraint,
} from '../db-errors.js';
import { Refusal, run, runOrRefuse } from './actions.js';
import { requirePanelAdmin, type PanelIdentity } from './member.js';
import { queryDepartments } from './teams.js';

const { categories, departmentManagers, departments, memberships } = schema;

type AdminError =
  | {
      status: 404;
      code: 'manager_not_found' | 'category_not_found' | 'department_not_found';
    }
  | { status: 409; code: 'email_mismatch'; maskedEmail: string }
  | {
      status: 409;
      code:
        | 'email_in_use'
        | 'cpf_unavailable'
        | 'already_manager'
        | 'email_change_not_allowed'
        | 'staff_account_not_allowed'
        | 'category_name_taken'
        | 'department_name_taken';
    }
  | { status: 422; code: 'department_not_found' | 'cannot_change_self' };

export type AdminResult<T> = { ok: T } | { error: AdminError };

const fail = (error: AdminError) => ({ error }) as const;

const runAdmin = <T>(db: Database, identity: PanelIdentity, fn: (tx: Transaction) => Promise<T>) =>
  runOrRefuse<AdminError, T>(db, identity, fn);

const MANAGER_NOT_FOUND = { status: 404, code: 'manager_not_found' } as const;
const CATEGORY_NOT_FOUND = { status: 404, code: 'category_not_found' } as const;
const DEPARTMENT_NOT_FOUND = { status: 404, code: 'department_not_found' } as const;
const DEPARTMENT_NOT_ELIGIBLE = { status: 422, code: 'department_not_found' } as const;
const CANNOT_CHANGE_SELF = { status: 422, code: 'cannot_change_self' } as const;

/** Traduz as violações de unicidade conhecidas; qualquer outra volta como exceção. */
function translateUnique(error: unknown): AdminError | undefined {
  if (!isUniqueViolation(error)) return undefined;
  switch (violatedConstraint(error)) {
    case USER_EMAIL_CONSTRAINT:
      return { status: 409, code: 'email_in_use' };
    case USER_CPF_CONSTRAINT:
      return { status: 409, code: 'cpf_unavailable' };
    case CATEGORY_NAME_CONSTRAINT:
      return { status: 409, code: 'category_name_taken' };
    case DEPARTMENT_NAME_CONSTRAINT:
      return { status: 409, code: 'department_name_taken' };
    default:
      return undefined;
  }
}

/** Resultado do bloco; recusas do banco viram o erro da API e o resto é rethrow. */
async function guard<T>(block: () => Promise<AdminResult<T>>): Promise<AdminResult<T>> {
  try {
    return await block();
  } catch (error) {
    const unique = translateUnique(error);
    if (unique) return fail(unique);
    if (isPgError(error, '23514', 'email_change_not_allowed')) {
      return fail({ status: 409, code: 'email_change_not_allowed' });
    }
    // Conta da equipe interna não vira gestor nem admin, nem por reativação (trigger de memberships).
    if (isPgError(error, '23514', 'staff_account_not_allowed')) {
      return fail({ status: 409, code: 'staff_account_not_allowed' });
    }
    if (isPgError(error, 'P0002')) return fail(MANAGER_NOT_FOUND);
    throw error;
  }
}

// ── Gestores ──

type MembershipRow = {
  user_id: string;
  name: string;
  cpf: string | null;
  email: string | null;
  role: ManagerRow['role'];
  status: ManagerRow['status'];
};

/** Admins e gestores da prefeitura; `userId` limita a uma pessoa. Quem tem os dois papéis conta como admin. */
async function queryManagers(
  tx: Transaction,
  identity: PanelIdentity,
  userId?: string,
): Promise<ManagerRow[]> {
  const people = await tx.execute<MembershipRow>(sql`
    SELECT u.id AS user_id, u.name, u.cpf, u.email, m.role, m.status
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${identity.tenantId}
      AND m.role IN ('manager', 'tenant_admin')
      AND ${userId ? sql`u.id = ${userId}` : sql`true`}
  `);
  const scopes = await tx.execute<{ user_id: string; id: string; name: string }>(sql`
    SELECT dm.user_id, d.id, d.name
    FROM department_managers dm
    JOIN departments d ON d.tenant_id = dm.tenant_id AND d.id = dm.department_id
    WHERE dm.tenant_id = ${identity.tenantId}
      AND ${userId ? sql`dm.user_id = ${userId}` : sql`true`}
    ORDER BY d.name, d.id
  `);

  const byUser = new Map<string, MembershipRow>();
  for (const row of people.rows) {
    const current = byUser.get(row.user_id);
    if (!current || row.role === 'tenant_admin') byUser.set(row.user_id, row);
  }
  const rows: ManagerRow[] = [...byUser.values()].map((row) => ({
    userId: row.user_id,
    name: row.name,
    cpf: row.cpf,
    email: row.email,
    role: row.role,
    status: row.status,
    departments:
      row.role === 'tenant_admin'
        ? []
        : scopes.rows
            .filter((scope) => scope.user_id === row.user_id)
            .map((scope) => ({ id: scope.id, name: scope.name })),
  }));
  const group = (row: ManagerRow) =>
    row.role === 'tenant_admin' ? 0 : row.status === 'inactive' ? 2 : 1;
  return rows.toSorted(
    (a, b) =>
      group(a) - group(b) ||
      a.name.localeCompare(b.name, 'pt-BR') ||
      a.userId.localeCompare(b.userId),
  );
}

export function loadManagers(db: Database, identity: PanelIdentity) {
  return run(db, identity, async (tx) => ({ items: await queryManagers(tx, identity) }));
}

/** Todos os setores existem na prefeitura; senão, a recusa 422. */
async function requireDepartments(tx: Transaction, identity: PanelIdentity, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, identity.tenantId), inArray(departments.id, unique)));
  if (found.length !== unique.length) throw new Refusal(DEPARTMENT_NOT_ELIGIBLE);
  return unique;
}

/** Troca os setores do gestor pelos informados. */
async function replaceDepartments(
  tx: Transaction,
  identity: PanelIdentity,
  userId: string,
  departmentIds: string[],
) {
  await tx
    .delete(departmentManagers)
    .where(
      and(
        eq(departmentManagers.tenantId, identity.tenantId),
        eq(departmentManagers.userId, userId),
      ),
    );
  await tx
    .insert(departmentManagers)
    .values(
      departmentIds.map((departmentId) => ({ tenantId: identity.tenantId, departmentId, userId })),
    );
}

export function createManager(
  db: Database,
  identity: PanelIdentity,
  body: ManagerCreateBody,
): Promise<AdminResult<ManagerRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      const departmentIds = await requireDepartments(tx, identity, body.departmentIds);

      const found = await tx.execute<{ id: string; email: string | null }>(
        sql`SELECT id, email FROM panel_find_or_create_manager_user(${body.name}, ${body.cpf}, ${body.email})`,
      );
      const { id: userId, email } = found.rows[0]!;
      if (email !== null && email.toLowerCase() !== body.email) {
        throw new Refusal({ status: 409, code: 'email_mismatch', maskedEmail: maskEmail(email) });
      }

      const existing = await tx
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, identity.tenantId),
            eq(memberships.userId, userId),
            inArray(memberships.role, ['manager', 'tenant_admin']),
          ),
        );
      const isAdmin = existing.some((m) => m.role === 'tenant_admin' && m.status === 'active');
      const manager = existing.find((m) => m.role === 'manager');
      if (isAdmin || manager?.status === 'active') {
        throw new Refusal({ status: 409, code: 'already_manager' });
      }
      if (manager) {
        await setManagerStatus(tx, identity, userId, 'active');
      } else {
        await tx
          .insert(memberships)
          .values({ tenantId: identity.tenantId, userId, role: 'manager', status: 'active' });
      }
      await replaceDepartments(tx, identity, userId, departmentIds);

      return (await queryManagers(tx, identity, userId))[0]!;
    }),
  );
}

const setManagerStatus = (
  tx: Transaction,
  identity: PanelIdentity,
  userId: string,
  status: 'active' | 'inactive',
) =>
  tx
    .update(memberships)
    .set({ status })
    .where(
      and(
        eq(memberships.tenantId, identity.tenantId),
        eq(memberships.userId, userId),
        eq(memberships.role, 'manager'),
      ),
    );

export function updateManager(
  db: Database,
  identity: PanelIdentity,
  userId: string,
  body: ManagerUpdateBody,
): Promise<AdminResult<ManagerRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      if (userId.toLowerCase() === identity.userId.toLowerCase())
        throw new Refusal(CANNOT_CHANGE_SELF);
      const [manager] = await queryManagers(tx, identity, userId);
      if (!manager || manager.role !== 'manager') throw new Refusal(MANAGER_NOT_FOUND);

      switch (body.action) {
        case 'update': {
          const departmentIds = await requireDepartments(tx, identity, body.departmentIds);
          if (manager.email?.toLowerCase() !== body.email) {
            await tx.execute(sql`SELECT panel_change_manager_email(${userId}, ${body.email})`);
          }
          await replaceDepartments(tx, identity, userId, departmentIds);
          break;
        }
        case 'deactivate':
          await setManagerStatus(tx, identity, userId, 'inactive');
          break;
        case 'reactivate':
          await setManagerStatus(tx, identity, userId, 'active');
          break;
      }
      return (await queryManagers(tx, identity, userId))[0]!;
    }),
  );
}

// ── Categorias ──

type CategoryQueryRow = {
  id: string;
  name: string;
  icon: string | null;
  icon_group: CategoryRow['iconGroup'];
  department_id: string;
  department_name: string;
  default_deadline_days: number;
  cluster_radius_m: number;
  active: boolean;
};

async function queryCategories(
  tx: Transaction,
  identity: PanelIdentity,
  categoryId?: string,
): Promise<CategoryRow[]> {
  const result = await tx.execute<CategoryQueryRow>(sql`
    SELECT c.id, c.name, c.icon, c.icon_group, c.department_id, d.name AS department_name,
      c.default_deadline_days, c.cluster_radius_m, c.active
    FROM categories c
    JOIN departments d ON d.tenant_id = c.tenant_id AND d.id = c.department_id
    WHERE c.tenant_id = ${identity.tenantId}
      AND ${categoryId ? sql`c.id = ${categoryId}` : sql`true`}
    ORDER BY lower(c.name), c.name, c.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    iconGroup: row.icon_group,
    departmentId: row.department_id,
    departmentName: row.department_name,
    defaultDeadlineDays: Number(row.default_deadline_days),
    clusterRadiusM: Number(row.cluster_radius_m),
    active: row.active,
  }));
}

export function loadCategories(db: Database, identity: PanelIdentity) {
  return run(db, identity, async (tx) => ({ items: await queryCategories(tx, identity) }));
}

export function createCategory(
  db: Database,
  identity: PanelIdentity,
  body: CategoryCreateBody,
): Promise<AdminResult<CategoryRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      await requireDepartments(tx, identity, [body.departmentId]);
      const [created] = await tx
        .insert(categories)
        .values({ tenantId: identity.tenantId, ...body })
        .returning({ id: categories.id });
      return (await queryCategories(tx, identity, created!.id))[0]!;
    }),
  );
}

export function updateCategory(
  db: Database,
  identity: PanelIdentity,
  categoryId: string,
  body: CategoryUpdateBody,
): Promise<AdminResult<CategoryRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      if ((await queryCategories(tx, identity, categoryId)).length === 0) {
        throw new Refusal(CATEGORY_NOT_FOUND);
      }
      if (body.departmentId) await requireDepartments(tx, identity, [body.departmentId]);
      await tx
        .update(categories)
        .set(body)
        .where(and(eq(categories.tenantId, identity.tenantId), eq(categories.id, categoryId)));
      return (await queryCategories(tx, identity, categoryId))[0]!;
    }),
  );
}

// ── Setores ──

export function createDepartment(
  db: Database,
  identity: PanelIdentity,
  body: DepartmentBody,
): Promise<AdminResult<DepartmentRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      const [created] = await tx
        .insert(departments)
        .values({ tenantId: identity.tenantId, name: body.name })
        .returning({ id: departments.id });
      return (await queryDepartments(tx, identity, created!.id))[0]!;
    }),
  );
}

export function renameDepartment(
  db: Database,
  identity: PanelIdentity,
  departmentId: string,
  body: DepartmentBody,
): Promise<AdminResult<DepartmentRow>> {
  return guard(() =>
    runAdmin(db, identity, async (tx) => {
      if ((await queryDepartments(tx, identity, departmentId)).length === 0) {
        throw new Refusal(DEPARTMENT_NOT_FOUND);
      }
      await tx
        .update(departments)
        .set({ name: body.name })
        .where(and(eq(departments.tenantId, identity.tenantId), eq(departments.id, departmentId)));
      return (await queryDepartments(tx, identity, departmentId))[0]!;
    }),
  );
}

// ── Rotas ──

const adminErrorSchema = apiErrorSchema.extend({ maskedEmail: z.string().optional() });

const sendAdminError = (
  reply: FastifyReply,
  { error }: Extract<AdminResult<unknown>, { error: unknown }>,
) =>
  reply
    .code(error.status)
    .send(
      'maskedEmail' in error
        ? { code: error.code, maskedEmail: error.maskedEmail }
        : { code: error.code },
    );

const errors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: adminErrorSchema,
  422: apiErrorSchema,
} as const;

/** Rotas do painel que só o admin da prefeitura usa: gestores, categorias e setores. */
export function registerAdminRoutes(instance: FastifyInstance, { db }: { db: Database }) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const preHandler = requireAuth(['panel']);
  const idParams = z.object({ id: z.uuid() });
  const userParams = z.object({ userId: z.uuid() });

  app.get(
    '/panel/managers',
    { preHandler, schema: { response: { 200: managersResponseSchema, ...errors } } },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      return loadManagers(db, identity);
    },
  );

  app.post(
    '/panel/managers',
    {
      preHandler,
      schema: { body: managerCreateBodySchema, response: { 201: managerRowSchema, ...errors } },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await createManager(db, identity, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return reply.code(201).send(result.ok);
    },
  );

  app.patch(
    '/panel/managers/:userId',
    {
      preHandler,
      schema: {
        params: userParams,
        body: managerUpdateBodySchema,
        response: { 200: managerRowSchema, ...errors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await updateManager(db, identity, request.params.userId, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return result.ok;
    },
  );

  app.get(
    '/panel/categories',
    { preHandler, schema: { response: { 200: categoriesResponseSchema, ...errors } } },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      return loadCategories(db, identity);
    },
  );

  app.post(
    '/panel/categories',
    {
      preHandler,
      schema: { body: categoryCreateBodySchema, response: { 201: categoryRowSchema, ...errors } },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await createCategory(db, identity, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return reply.code(201).send(result.ok);
    },
  );

  app.patch(
    '/panel/categories/:id',
    {
      preHandler,
      schema: {
        params: idParams,
        body: categoryUpdateBodySchema,
        response: { 200: categoryRowSchema, ...errors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await updateCategory(db, identity, request.params.id, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return result.ok;
    },
  );

  app.post(
    '/panel/departments',
    {
      preHandler,
      schema: { body: departmentBodySchema, response: { 201: departmentRowSchema, ...errors } },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await createDepartment(db, identity, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return reply.code(201).send(result.ok);
    },
  );

  app.patch(
    '/panel/departments/:id',
    {
      preHandler,
      schema: {
        params: idParams,
        body: departmentBodySchema,
        response: { 200: departmentRowSchema, ...errors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const result = await renameDepartment(db, identity, request.params.id, request.body);
      if ('error' in result) return sendAdminError(reply, result);
      return result.ok;
    },
  );
}
