import { schema, withContext, type Database } from '@alocidadao/db';
import { apiErrorSchema, backofficeContextSchema, type StaffAuditAction } from '@alocidadao/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import type { EmailSender } from '../messaging/email.js';
import { recordImplicitSupportLeave, recordStaffAudit } from '../panel/audit.js';
import { registerAuditRoutes } from './audit-routes.js';
import { registerCityInterestRoutes } from './city-interest.js';
import { registerCreateTenantRoutes } from './create-tenant.js';
import { registerFrozenAccountRoutes } from './frozen-accounts.js';
import { requirePlatformStaff } from './staff.js';
import { registerNeighborhoodRoutes } from './neighborhoods.js';
import { registerStaffRoutes } from './staff-routes.js';
import { registerTenantListRoutes } from './tenant-lists.js';
import { registerTenantRoutes } from './tenants.js';

const { tenants, users } = schema;

export interface BackofficeDeps {
  /** Banco como app_user (RLS). */
  db: Database;
  /** Hashes dos códigos (AUTH_SECRET), como no login. */
  secret: string;
  /** Código fixo (só desenvolvimento). */
  devFixedCode?: string;
  /** Envio do código de recuperação da conta congelada. */
  email: EmailSender;
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
export function registerBackofficeRoutes(instance: FastifyInstance, deps: BackofficeDeps) {
  const { db } = deps;
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
        // Entrada sem saída (navegador fechado, troca de prefeitura): fecha a anterior antes.
        if (path === 'enter') await recordImplicitSupportLeave(db, staff);
        await recordStaffAudit(
          db,
          { ...staff, tenantId },
          { action, targetType: 'tenant', targetId: tenantId },
        );
        return reply.code(204).send(null);
      },
    );

  registerTenantRoutes(instance, { db, preHandler });
  registerTenantListRoutes(instance, { db, preHandler });
  registerNeighborhoodRoutes(instance, { db, preHandler });
  registerCreateTenantRoutes(instance, { db, preHandler });
  registerCityInterestRoutes(instance, { db, preHandler });
  registerStaffRoutes(instance, { db, preHandler });
  registerAuditRoutes(instance, { db, preHandler });
  registerFrozenAccountRoutes(instance, { ...deps, preHandler });

  supportRoute('enter', 'support.enter');
  supportRoute('leave', 'support.leave');
}
