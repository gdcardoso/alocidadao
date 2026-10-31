import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  apiErrorSchema,
  neighborhoodFeatureName,
  neighborhoodsSummarySchema,
  neighborhoodsUploadSchema,
  type NeighborhoodsSummary,
} from '@alocidadao/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isPgError } from '../db-errors.js';
import { insertStaffAudit } from '../panel/audit.js';
import { requirePlatformStaff } from './staff.js';

const { tenants } = schema;

const tenantParamsSchema = z.object({ id: z.uuid() });

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

/** Arquivo GeoJSON de bairros: até 10 MB. */
const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024;

/** Camada vigente da prefeitura (a própria ou a do IBGE); só vale dentro do contexto dela. */
async function layerSummary(tx: Transaction, tenantId: string): Promise<NeighborhoodsSummary> {
  const { rows } = await tx.execute<{ count: number; source: 'ibge' | 'tenant' | null }>(
    sql`select count(*)::int as count, min(source) as source from effective_neighborhoods(${tenantId}::uuid)`,
  );
  return { count: rows[0]!.count, source: rows[0]!.source };
}

async function tenantExists(tx: Transaction, tenantId: string) {
  const [tenant] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return tenant !== undefined;
}

/** Rotas dos bairros de uma prefeitura no backoffice: consulta, carga e volta para o IBGE. */
export function registerNeighborhoodRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const path = '/backoffice/tenants/:id/neighborhoods';

  app.get(
    path,
    {
      preHandler,
      schema: {
        params: tenantParamsSchema,
        response: { 200: neighborhoodsSummarySchema, ...staffErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const summary = await withContext(db, { ...staff, tenantId }, async (tx) =>
        (await tenantExists(tx, tenantId)) ? layerSummary(tx, tenantId) : null,
      );
      if (!summary) return reply.code(404).send({ code: 'tenant_not_found' });
      return summary;
    },
  );

  app.put(
    path,
    {
      preHandler,
      bodyLimit: UPLOAD_BODY_LIMIT,
      // Sem `body` no schema: a falha de validação precisa ser 422 invalid_neighborhoods, não 400.
      schema: {
        params: tenantParamsSchema,
        response: {
          200: neighborhoodsSummarySchema,
          ...staffErrors,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const parsed = neighborhoodsUploadSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ code: 'invalid_neighborhoods' });

      const features = parsed.data.features.map((feature) => ({
        name: neighborhoodFeatureName(feature.properties)!,
        geometry: feature.geometry,
      }));
      let summary: NeighborhoodsSummary | null;
      try {
        summary = await withContext(db, { ...staff, tenantId }, async (tx) => {
          if (!(await tenantExists(tx, tenantId))) return null;
          await tx.execute(
            sql`select replace_tenant_neighborhoods(${tenantId}::uuid, ${JSON.stringify(features)}::jsonb)`,
          );
          // Na mesma transação: a carga e a auditoria valem juntas ou nenhuma vale.
          await insertStaffAudit(
            tx,
            { ...staff, tenantId },
            {
              action: 'tenant.neighborhoods_replace',
              targetType: 'tenant',
              targetId: tenantId,
            },
          );
          return layerSummary(tx, tenantId);
        });
      } catch (error) {
        // A função do banco recusa geometria vazia (polígono sem área) com 22023; a transação
        // inteira volta e a camada anterior fica.
        if (isPgError(error, '22023'))
          return reply.code(422).send({ code: 'invalid_neighborhoods' });
        throw error;
      }
      if (!summary) return reply.code(404).send({ code: 'tenant_not_found' });
      return summary;
    },
  );

  app.delete(
    path,
    {
      preHandler,
      schema: {
        params: tenantParamsSchema,
        response: { 200: neighborhoodsSummarySchema, ...staffErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const summary = await withContext(db, { ...staff, tenantId }, async (tx) => {
        if (!(await tenantExists(tx, tenantId))) return null;
        await tx.execute(sql`select clear_tenant_neighborhoods(${tenantId}::uuid)`);
        await insertStaffAudit(
          tx,
          { ...staff, tenantId },
          { action: 'tenant.neighborhoods_reset', targetType: 'tenant', targetId: tenantId },
        );
        return layerSummary(tx, tenantId);
      });
      if (!summary) return reply.code(404).send({ code: 'tenant_not_found' });
      return summary;
    },
  );
}
