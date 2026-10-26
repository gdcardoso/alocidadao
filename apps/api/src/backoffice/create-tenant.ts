import { randomUUID } from 'node:crypto';
import { schema, withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  DEFAULT_CATALOG,
  maskEmail,
  municipalitySearchResponseSchema,
  tenantCreateBodySchema,
  tenantCreateResponseSchema,
  type TenantCreateBody,
} from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  isPgError,
  isUniqueViolation,
  TENANT_IBGE_CONSTRAINT,
  USER_CPF_CONSTRAINT,
  USER_EMAIL_CONSTRAINT,
  violatedConstraint,
} from '../db-errors.js';
import { Refusal } from '../panel/actions.js';
import { insertStaffAudit } from '../panel/audit.js';
import { requirePlatformStaff } from './staff.js';

const { tenants, tenantContracts, memberships, departments, categories } = schema;

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

type CreateRefusal =
  | {
      status: 409;
      code: 'tenant_exists' | 'email_in_use' | 'cpf_unavailable' | 'staff_account_not_allowed';
    }
  | { status: 409; code: 'email_mismatch'; maskedEmail: string }
  | { status: 422; code: 'municipality_not_found' };

const REFUSE_TENANT_EXISTS = { status: 409, code: 'tenant_exists' } as const;

/** Sem a extensão `unaccent` no banco: minúsculas e sem acento por `translate`, dos dois lados. */
const ACCENTED = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn';

const foldJs = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Escapa `%`, `_` e `\` para o LIKE. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Erros do banco que viram recusa: índices únicos e a conta da equipe interna no CPF. */
function translateDbError(error: unknown): CreateRefusal | undefined {
  if (isPgError(error, '23514', 'staff_account_not_allowed')) {
    return { status: 409, code: 'staff_account_not_allowed' };
  }
  if (!isUniqueViolation(error)) return undefined;
  switch (violatedConstraint(error)) {
    case TENANT_IBGE_CONSTRAINT:
      return REFUSE_TENANT_EXISTS;
    case USER_EMAIL_CONSTRAINT:
      return { status: 409, code: 'email_in_use' };
    case USER_CPF_CONSTRAINT:
      return { status: 409, code: 'cpf_unavailable' };
    default:
      return undefined;
  }
}

/** Rotas da P2: busca de município e criação da prefeitura. */
export function registerCreateTenantRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/municipalities',
    {
      preHandler,
      schema: {
        querystring: z.object({ q: z.string().trim().max(80).default('') }),
        response: { 200: municipalitySearchResponseSchema, ...staffErrors },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { q } = request.query;

      let match: ReturnType<typeof sql> | null = null;
      if (/^\d{1,7}$/.test(q)) {
        match = sql`m.ibge_code like ${`${q}%`}`;
      } else if (q.replace(/[^\p{L}]/gu, '').length >= 2) {
        const pattern = `%${escapeLike(foldJs(q))}%`;
        match = sql`lower(translate(m.name, ${ACCENTED}, ${PLAIN})) like ${pattern}`;
      }
      if (!match) return { items: [] };

      const rows = await withContext(db, staff, async (tx) => {
        const result = await tx.execute<{
          ibge_code: string;
          name: string;
          state: string;
          taken: boolean;
        }>(sql`
          select m.ibge_code, m.name, m.state,
            exists (select 1 from tenants t where t.ibge_code = m.ibge_code) as taken
          from municipalities m
          where ${match}
          order by lower(translate(m.name, ${ACCENTED}, ${PLAIN})), m.ibge_code
          limit 10
        `);
        return result.rows;
      });
      return {
        items: rows.map((r) => ({
          ibgeCode: r.ibge_code,
          name: r.name,
          state: r.state,
          taken: r.taken,
        })),
      };
    },
  );

  app.post(
    '/backoffice/tenants',
    {
      preHandler,
      schema: {
        body: tenantCreateBodySchema,
        response: {
          201: tenantCreateResponseSchema,
          ...staffErrors,
          409: z.object({ code: z.string(), maskedEmail: z.string().optional() }),
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const body = request.body;
      const tenantId = randomUUID();

      try {
        await withContext(db, { ...staff, tenantId }, (tx) =>
          createTenant(tx, staff, tenantId, body),
        );
      } catch (error) {
        const refusal =
          error instanceof Refusal ? (error.refusal as CreateRefusal) : translateDbError(error);
        if (!refusal) throw error;
        const { status, ...payload } = refusal;
        return reply.code(status).send(payload);
      }
      return reply.code(201).send({ id: tenantId });
    },
  );
}

async function createTenant(
  tx: Parameters<Parameters<typeof withContext>[2]>[0],
  staff: { userId: string; platformRole: 'admin' | 'support' },
  tenantId: string,
  body: TenantCreateBody,
) {
  const found = await tx.execute<{ name: string; state: string }>(
    sql`select name, state from municipalities where ibge_code = ${body.ibgeCode}`,
  );
  const municipality = found.rows[0];
  if (!municipality) {
    throw new Refusal<CreateRefusal>({ status: 422, code: 'municipality_not_found' });
  }
  const [existing] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ibgeCode, body.ibgeCode));
  if (existing) throw new Refusal<CreateRefusal>(REFUSE_TENANT_EXISTS);

  // Limite copiado no próprio banco: a geometria não passa pela API.
  await tx.execute(sql`
    insert into tenants (id, name, display_name, city, state, ibge_code, boundary, status, central_phone)
    select ${tenantId}, m.name, ${body.displayName}, m.name, m.state, m.ibge_code, m.boundary,
      'onboarding', ${body.centralPhone}
    from municipalities m
    where m.ibge_code = ${body.ibgeCode}
  `);

  await tx.insert(tenantContracts).values({
    tenantId,
    plan: body.contract.plan,
    includedPanelUsers: body.contract.includedPanelUsers,
    startsOn: body.contract.startsOn,
    endsOn: body.contract.endsOn,
  });

  const account = await tx.execute<{ id: string; email: string | null }>(
    sql`select id, email from platform_find_or_create_tenant_admin(${body.admin.name}, ${body.admin.cpf}, ${body.admin.email})`,
  );
  const { id: userId, email } = account.rows[0]!;
  if (email !== null && email.toLowerCase() !== body.admin.email) {
    throw new Refusal<CreateRefusal>({
      status: 409,
      code: 'email_mismatch',
      maskedEmail: maskEmail(email),
    });
  }
  await tx.insert(memberships).values({ tenantId, userId, role: 'tenant_admin', status: 'active' });

  if (body.copyDefaultCatalog) {
    const names = [...new Set(DEFAULT_CATALOG.map((c) => c.department))];
    const created = await tx
      .insert(departments)
      .values(names.map((name) => ({ tenantId, name })))
      .returning({ id: departments.id, name: departments.name });
    const deptId = new Map(created.map((d) => [d.name, d.id]));
    await tx.insert(categories).values(
      DEFAULT_CATALOG.map((c) => ({
        tenantId,
        departmentId: deptId.get(c.department)!,
        name: c.name,
        icon: c.icon,
        iconGroup: c.iconGroup,
        clusterRadiusM: c.clusterRadiusM,
        defaultDeadlineDays: c.defaultDeadlineDays,
      })),
    );
  }

  await insertStaffAudit(
    tx,
    { ...staff, tenantId },
    { action: 'tenant.create', targetType: 'tenant', targetId: tenantId },
  );
}
