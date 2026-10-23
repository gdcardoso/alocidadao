import {
  CLUSTERABLE_OCCURRENCE_STATUSES,
  type GeoPoint,
  type OccurrenceStatus,
} from '@alocidadao/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { geoPoint, type Transaction } from './client.js';
import { categories, occurrences, requests, tenants } from './schema.js';

const DEFAULT_SIMILAR_LIMIT = 5;

/**
 * Prefeitura ativa cujo limite contém o ponto. Funciona sem contexto de prefeitura,
 * porque `tenants` tem leitura livre.
 */
export async function findActiveTenantAt(
  tx: Transaction,
  point: GeoPoint,
): Promise<{ id: string; displayName: string } | undefined> {
  const [tenant] = await tx
    .select({ id: tenants.id, displayName: tenants.displayName })
    .from(tenants)
    .where(
      and(eq(tenants.status, 'active'), sql`ST_Contains(${tenants.boundary}, ${geoPoint(point)})`),
    )
    .limit(1);
  return tenant;
}

/**
 * Ocorrências abertas da mesma categoria dentro do raio de agrupamento da categoria, da mais
 * perto para a mais longe. Deve rodar no contexto da prefeitura (RLS). Não devolve nada que
 * identifique cidadão.
 */
export async function findSimilarOccurrences(
  tx: Transaction,
  input: { categoryId: string; point: GeoPoint; limit?: number },
): Promise<
  Array<{ id: string; status: OccurrenceStatus; distanceM: number; requestCount: number }>
> {
  // O cast para geography casa com o índice occurrences_location_geog_idx.
  const origin = sql`${geoPoint(input.point)}::geography`;
  const location = sql`${occurrences.location}::geography`;
  const distance = sql<number>`round(ST_Distance(${location}, ${origin}))::int`;

  const rows = await tx
    .select({
      id: occurrences.id,
      status: occurrences.status,
      distanceM: distance,
      requestCount: count(requests.id),
    })
    .from(occurrences)
    .innerJoin(
      categories,
      and(eq(categories.tenantId, occurrences.tenantId), eq(categories.id, occurrences.categoryId)),
    )
    .leftJoin(
      requests,
      and(eq(requests.tenantId, occurrences.tenantId), eq(requests.occurrenceId, occurrences.id)),
    )
    .where(
      and(
        eq(occurrences.categoryId, input.categoryId),
        inArray(occurrences.status, [...CLUSTERABLE_OCCURRENCE_STATUSES]),
        sql`ST_DWithin(${location}, ${origin}, ${categories.clusterRadiusM})`,
      ),
    )
    .groupBy(occurrences.id, categories.id)
    .orderBy(asc(distance), asc(occurrences.id))
    .limit(input.limit ?? DEFAULT_SIMILAR_LIMIT);
  return rows;
}
