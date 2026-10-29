import { withContext, type Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  cityInterestCsv,
  cityInterestResponseSchema,
  leadStatusBodySchema,
  type CityInterestRow,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isPgError } from '../db-errors.js';
import { requirePlatformStaff } from './staff.js';

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

const ibgeParamsSchema = z.object({ ibgeCode: z.string().regex(/^\d{7}$/) });

type InterestDbRow = {
  ibge_code: string;
  name: string;
  state: string;
  request_count: number;
  last_30_days: number;
  first_at: Date | string;
  commercial_status: CityInterestRow['commercialStatus'];
  is_customer: boolean;
};

/** Rotas da P5 (interesse por cidade): lista, CSV e mudança da situação comercial. */
export function registerCityInterestRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const loadRows = async (staff: { userId: string }): Promise<CityInterestRow[]> => {
    const { rows } = await withContext(db, staff, (tx) =>
      tx.execute<InterestDbRow>(sql`select * from platform_city_interest()`),
    );
    return rows.map((row) => ({
      ibgeCode: row.ibge_code,
      name: row.name,
      state: row.state,
      requestCount: row.request_count,
      last30Days: row.last_30_days,
      firstAt: new Date(row.first_at).toISOString(),
      commercialStatus: row.commercial_status,
      isCustomer: row.is_customer,
    }));
  };

  app.get(
    '/backoffice/city-interest',
    { preHandler, schema: { response: { 200: cityInterestResponseSchema, ...staffErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      return { items: await loadRows(staff) };
    },
  );

  app.get(
    '/backoffice/city-interest.csv',
    { preHandler, schema: { response: { 200: z.string(), ...staffErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="interesse-por-cidade.csv"')
        .send(cityInterestCsv(await loadRows(staff)));
    },
  );

  app.put(
    '/backoffice/city-interest/:ibgeCode/status',
    {
      preHandler,
      schema: {
        params: ibgeParamsSchema,
        body: leadStatusBodySchema,
        response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { ibgeCode } = request.params;
      const { status } = request.body;
      try {
        // A função grava a situação e a auditoria; o trigger do lead lê o app.user_id do contexto.
        await withContext(db, staff, (tx) =>
          tx.execute(
            sql`select platform_set_lead_status(${ibgeCode}, ${status}::commercial_status)`,
          ),
        );
      } catch (error) {
        if (isPgError(error, 'P0002')) {
          return reply.code(404).send({ code: 'municipality_not_found' });
        }
        throw error;
      }
      return reply.code(204).send(null);
    },
  );
}
