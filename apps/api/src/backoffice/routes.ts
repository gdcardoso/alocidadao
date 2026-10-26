import { schema, withContext, type Database } from '@alocidadao/db';
import { apiErrorSchema, backofficeContextSchema, type StaffAuditAction } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { recordStaffAudit } from '../panel/audit.js';
import { requirePlatformStaff } from './staff.js';

const { tenants, users } = schema;

export interface BackofficeDeps {
  /** Banco como app_user (RLS). */
  db: Database;
}

const tenantParamsSchema = z.object({ id: z.uuid() });

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

/**
 * Rotas do backoffice da equipe interna (/backoffice/*). Todas exigem token do painel e
 * `users.platform_role` conferido no banco (requirePlatformStaff). O token do app passa pelo
 * requireAuth só para receber o 403 `not_platform_staff`.
 */
export function registerBackofficeRoutes(instance: FastifyInstance, { db }: BackofficeDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const preHandler = requireAuth(['app', 'panel']);

  app.get(
    '/backoffice/context',
    { preHandler, schema: { response: { 200: backofficeContextSchema, ...staffErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const [user] = await withContext(db, staff, (tx) =>
        tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, staff.userId)),
      );
      return { user: user!, platformRole: staff.platformRole };
    },
  );

  /** Entrar e sair do modo suporte: grava a ação no contexto da prefeitura. */
  const supportRoute = (path: 'enter' | 'leave', action: StaffAuditAction) =>
    app.post(
      `/backoffice/tenants/:id/support/${path}`,
      {
        preHandler,
        schema: {
          params: tenantParamsSchema,
          response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (request, reply) => {
        const staff = await requirePlatformStaff(db, request, reply);
        if (!staff) return reply;
        const tenantId = request.params.id;
        const [tenant] = await withContext(db, staff, (tx) =>
          tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)),
        );
        if (!tenant) return reply.code(404).send({ code: 'tenant_not_found' });
        // Sair vale sempre; entrar, só em prefeitura em implantação ou ativa.
        if (path === 'enter' && tenant.status === 'suspended') {
          return reply.code(409).send({ code: 'tenant_suspended' });
        }
        await recordStaffAudit(
          db,
          { ...staff, tenantId },
          { action, targetType: 'tenant', targetId: tenantId },
        );
        return reply.code(204).send(null);
      },
    );

  supportRoute('enter', 'support.enter');
  supportRoute('leave', 'support.leave');
}
