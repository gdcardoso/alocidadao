import { withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  AUDIT_PAGE_SIZE,
  auditQuerySchema,
  auditResponseSchema,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requirePlatformStaff } from './staff.js';

type AuditDbRow = {
  id: string;
  created_at: Date | string;
  staff_name: string;
  tenant_id: string | null;
  tenant_name: string | null;
  action: string;
  target_type: string | null;
  target_label: string;
  total: string | number;
};

/** Rota da P7 (auditoria): só o Admin, 50 linhas por página, filtros opcionais. */
export function registerAuditRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/audit',
    {
      preHandler,
      schema: {
        querystring: auditQuerySchema,
        response: {
          200: auditResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { tenantId, staffUserId, from, to, page } = request.query;

      const load = (limit: number, offset: number) =>
        withContext(db, staff, async (tx) => {
          const { rows } = await tx.execute<AuditDbRow>(sql`
            select * from platform_audit_events(
              ${tenantId ?? null}::uuid, ${staffUserId ?? null}::uuid,
              ${from ?? null}::date, ${to ?? null}::date, ${limit}, ${offset}
            )
          `);
          return rows;
        });

      const rows = await load(AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE);
      // Página além do fim vem sem linhas e sem total: busca o total pela primeira linha da lista.
      const countRows = rows.length > 0 || page === 1 ? rows : await load(1, 0);
      const total = countRows.length > 0 ? Number(countRows[0]!.total) : 0;

      return {
        items: rows.map((row) => ({
          id: row.id,
          at: new Date(row.created_at).toISOString(),
          staffName: row.staff_name,
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          action: row.action,
          targetType: row.target_type,
          targetLabel: row.target_label,
        })),
        total,
        page,
        pageSize: AUDIT_PAGE_SIZE,
      };
    },
  );
}
