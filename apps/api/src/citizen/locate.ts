import {
  findActiveTenantAt,
  findMunicipalityAt,
  findSimilarOccurrences,
  schema,
  type Transaction,
} from '@alocidadao/db';
import {
  apiErrorSchema,
  cityInterestBodySchema,
  locateQuerySchema,
  locateResponseSchema,
  similarOccurrenceSchema,
  similarQuerySchema,
  type CategoryOption,
  type LocateResponse,
} from '@alocidadao/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { asActiveUser, enterTenant, INACTIVE } from '../auth/active-user.js';
import { requireAuth } from '../auth/plugin.js';
import type { CitizenDeps } from './routes.js';

const { tenants, categories, municipalities, cityInterest } = schema;

/** Ponto sem prefeitura ativa: 422 em /citizen/similar. */
const NOT_SERVED = Symbol('not_served');
/** Código IBGE fora de `municipalities`: 404 em /citizen/city-interest. */
const UNKNOWN_MUNICIPALITY = Symbol('unknown_municipality');

/** Categorias ativas da prefeitura do contexto, em ordem de nome. */
function activeCategories(tx: Transaction): Promise<CategoryOption[]> {
  return tx
    .select({
      id: categories.id,
      name: categories.name,
      icon: categories.icon,
      iconGroup: categories.iconGroup,
    })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.name), asc(categories.id));
}

/** Quem atende o ponto: a prefeitura ativa e as categorias dela, ou o município sem adesão. */
async function locate(
  tx: Transaction,
  point: { lat: number; lng: number },
): Promise<LocateResponse> {
  const found = await findActiveTenantAt(tx, point);
  if (!found) {
    const municipality = await findMunicipalityAt(tx, point);
    return { status: 'not_served', municipality: municipality ?? null };
  }
  const [tenant] = await tx
    .select({
      id: tenants.id,
      displayName: tenants.displayName,
      city: tenants.city,
      state: tenants.state,
      centralPhone: tenants.centralPhone,
    })
    .from(tenants)
    .where(eq(tenants.id, found.id));
  await enterTenant(tx, found.id);
  return { status: 'served', tenant: tenant!, categories: await activeCategories(tx) };
}

/**
 * Localização, ocorrências parecidas e interesse por cidade. A prefeitura sai sempre do ponto,
 * nunca de um id mandado pelo aparelho.
 */
export function registerLocateRoutes(instance: FastifyInstance, { db }: CitizenDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const appOnly = requireAuth(['app']);
  const unauthorized = { code: 'unauthorized' } as const;

  app.get(
    '/citizen/locate',
    {
      preHandler: appOnly,
      schema: {
        querystring: locateQuerySchema,
        response: { 200: locateResponseSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const result = await asActiveUser(db, userId, (tx) => locate(tx, request.query));
      if (result === INACTIVE) return reply.code(401).send(unauthorized);
      return result;
    },
  );

  app.get(
    '/citizen/similar',
    {
      preHandler: appOnly,
      schema: {
        querystring: similarQuerySchema,
        response: {
          200: z.array(similarOccurrenceSchema),
          401: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const { lat, lng, categoryId } = request.query;
      const point = { lat, lng };
      const result = await asActiveUser(db, userId, async (tx) => {
        const tenant = await findActiveTenantAt(tx, point);
        if (!tenant) return NOT_SERVED;
        await enterTenant(tx, tenant.id);
        // Categoria de outra prefeitura não aparece (RLS): a lista sai vazia.
        const [category] = await tx
          .select({ name: categories.name, icon: categories.icon, iconGroup: categories.iconGroup })
          .from(categories)
          .where(and(eq(categories.tenantId, tenant.id), eq(categories.id, categoryId)));
        if (!category) return [];
        const rows = await findSimilarOccurrences(tx, { categoryId, point });
        // Só o que o cidadão pode ver: nada de quem relatou, nomes ou fotos.
        return rows.map((row) => ({
          occurrenceId: row.id,
          categoryName: category.name,
          icon: category.icon,
          iconGroup: category.iconGroup,
          distanceM: row.distanceM,
          reportCount: row.requestCount,
          status: row.status as 'triage' | 'in_progress',
        }));
      });
      if (result === INACTIVE) return reply.code(401).send(unauthorized);
      if (result === NOT_SERVED) return reply.code(422).send({ code: 'municipality_not_served' });
      return result;
    },
  );

  app.post(
    '/citizen/city-interest',
    {
      preHandler: appOnly,
      schema: {
        body: cityInterestBodySchema,
        response: { 204: z.null(), 401: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const { ibgeCode } = request.body;
      const result = await asActiveUser(db, userId, async (tx) => {
        const [municipality] = await tx
          .select({ ibgeCode: municipalities.ibgeCode })
          .from(municipalities)
          .where(eq(municipalities.ibgeCode, ibgeCode));
        if (!municipality) return UNKNOWN_MUNICIPALITY;
        // Pedir de novo a mesma cidade não é erro: o primeiro registro vale.
        await tx.insert(cityInterest).values({ ibgeCode, userId }).onConflictDoNothing();
        return true;
      });
      if (result === INACTIVE) return reply.code(401).send(unauthorized);
      if (result === UNKNOWN_MUNICIPALITY) {
        return reply.code(404).send({ code: 'municipality_not_found' });
      }
      return reply.code(204).send(null);
    },
  );
}
