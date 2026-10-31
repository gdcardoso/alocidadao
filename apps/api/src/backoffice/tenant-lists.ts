import { schema, withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  categoriesResponseSchema,
  maskCpfForStaff,
  maskEmail,
  staffManagersResponseSchema,
  teamsResponseSchema,
  type PlatformRole,
} from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadCategories, loadManagers } from '../panel/admin.js';
import type { PanelIdentity } from '../panel/member.js';
import { loadTeams } from '../panel/teams.js';
import { requirePlatformStaff } from './staff.js';

const { tenants } = schema;

const tenantParamsSchema = z.object({ id: z.uuid() });

const errors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
} as const;

/**
 * Identidade do painel para a equipe interna lendo uma prefeitura: admin da prefeitura, sem
 * restrição de setor, com o papel interno (o RLS libera a leitura pelo `platformRole`).
 */
export function staffPanelIdentity(
  staff: { userId: string; platformRole: PlatformRole },
  tenantId: string,
): PanelIdentity {
  return {
    userId: staff.userId,
    tenantId,
    role: 'tenant_admin',
    departmentIds: null,
    platformRole: staff.platformRole,
  };
}

/** Listas só leitura da P3 (equipes, gestores e categorias); Admin e Suporte, sem auditoria. */
export function registerTenantListRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  /** Staff + prefeitura existente; nas recusas já responde e devolve undefined. */
  async function resolve(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const staff = await requirePlatformStaff(db, request, reply);
    if (!staff) return undefined;
    const tenantId = request.params.id;
    const [tenant] = await withContext(db, { ...staff, tenantId }, (tx) =>
      tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)),
    );
    if (!tenant) {
      void reply.code(404).send({ code: 'tenant_not_found' });
      return undefined;
    }
    return staffPanelIdentity(staff, tenantId);
  }

  const options = <T extends z.ZodType>(response: T) => ({
    preHandler,
    schema: { params: tenantParamsSchema, response: { 200: response, ...errors } },
  });

  app.get('/backoffice/tenants/:id/teams', options(teamsResponseSchema), async (request, reply) => {
    const identity = await resolve(request, reply);
    if (!identity) return reply;
    return { items: await loadTeams(db, identity) };
  });

  app.get(
    '/backoffice/tenants/:id/managers',
    options(staffManagersResponseSchema),
    async (request, reply) => {
      const identity = await resolve(request, reply);
      if (!identity) return reply;
      const { items } = await loadManagers(db, identity);
      // Dado pessoal mascarado aqui, antes do schema de resposta: a equipe nunca recebe o completo.
      return {
        items: items.map(({ cpf, email, ...row }) => ({
          ...row,
          cpfMasked: cpf ? maskCpfForStaff(cpf) : null,
          emailMasked: email ? maskEmail(email) : null,
        })),
      };
    },
  );

  app.get(
    '/backoffice/tenants/:id/categories',
    options(categoriesResponseSchema),
    async (request, reply) => {
      const identity = await resolve(request, reply);
      if (!identity) return reply;
      return loadCategories(db, identity);
    },
  );
}
