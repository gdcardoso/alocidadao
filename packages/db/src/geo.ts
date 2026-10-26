import {
  CLUSTERABLE_OCCURRENCE_STATUSES,
  type GeoPoint,
  type OccurrenceStatus,
} from '@alocidadao/shared';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { geoPoint, type Transaction } from './client.js';
import { categories, municipalities, occurrences, requests, tenants } from './schema.js';

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
 * Município do IBGE cujo limite contém o ponto, com ou sem prefeitura cliente. Funciona sem
 * contexto, porque `municipalities` tem leitura livre. Sem a tabela carregada, devolve undefined.
 * Se mais de um limite contém o ponto, devolve o menor.
 */
export async function findMunicipalityAt(
  tx: Transaction,
  point: GeoPoint,
): Promise<{ ibgeCode: string; name: string; state: string } | undefined> {
  const [municipality] = await tx
    .select({
      ibgeCode: municipalities.ibgeCode,
      name: municipalities.name,
      state: municipalities.state,
    })
    .from(municipalities)
    .where(sql`ST_Contains(${municipalities.boundary}, ${geoPoint(point)})`)
    // Limites do IBGE não se sobrepõem, mas os inventados da demo ficam dentro de São Paulo:
    // vale o menor limite que contém o ponto.
    .orderBy(sql`ST_Area(${municipalities.boundary})`)
    .limit(1);
  return municipality;
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
      // Solicitação cancelada pelo cidadão não conta como relato.
      and(
        eq(requests.tenantId, occurrences.tenantId),
        eq(requests.occurrenceId, occurrences.id),
        ne(requests.status, 'cancelled'),
      ),
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

const DEFAULT_MERGE_SUGGESTION_LIMIT = 3;

export interface MergeSuggestion {
  occurrenceId: string;
  /** Protocolo da solicitação não cancelada mais antiga da ocorrência sugerida. */
  protocol: string;
  categoryName: string;
  /** Observação da mesma solicitação; nula quando o cidadão não escreveu. */
  description: string | null;
  distanceM: number;
  requestCount: number;
}

/** Par de ids em ordem (menor, maior), a forma gravada em `occurrence_separations`. */
export function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Ocorrências que o gestor pode juntar à `occurrenceId`: da mesma categoria, dentro do raio de
 * agrupamento da categoria, ainda agrupáveis, da mais perto para a mais longe. Fora a própria
 * ocorrência e os pares marcados como "é outro problema". Deve rodar no contexto da prefeitura
 * (RLS). Não devolve nada que identifique cidadão.
 */
export async function findMergeSuggestions(
  tx: Transaction,
  input: { occurrenceId: string; limit?: number },
): Promise<MergeSuggestion[]> {
  const statuses = sql.join(
    CLUSTERABLE_OCCURRENCE_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  // O cast para geography casa com o índice occurrences_location_geog_idx.
  const result = await tx.execute<{
    occurrence_id: string;
    protocol: string;
    category_name: string;
    description: string | null;
    distance_m: number;
    request_count: number;
  }>(sql`
    SELECT
      o.id AS occurrence_id,
      oldest.protocol,
      c.name AS category_name,
      oldest.description,
      round(ST_Distance(o.location::geography, origin.location::geography))::int AS distance_m,
      oldest.request_count
    FROM occurrences origin
    JOIN categories c ON c.tenant_id = origin.tenant_id AND c.id = origin.category_id
    JOIN occurrences o
      ON o.tenant_id = origin.tenant_id
      AND o.category_id = origin.category_id
      AND o.id <> origin.id
      AND o.status IN (${statuses})
      AND ST_DWithin(o.location::geography, origin.location::geography, c.cluster_radius_m)
    -- Solicitação cancelada pelo cidadão não conta como relato.
    CROSS JOIN LATERAL (
      SELECT
        r.protocol,
        r.description,
        count(*) OVER ()::int AS request_count
      FROM requests r
      WHERE r.tenant_id = o.tenant_id AND r.occurrence_id = o.id AND r.status <> 'cancelled'
      ORDER BY r.created_at, r.id
      LIMIT 1
    ) oldest
    WHERE origin.id = ${input.occurrenceId}
      AND NOT EXISTS (
        SELECT 1 FROM occurrence_separations s
        WHERE s.tenant_id = origin.tenant_id
          AND s.occurrence_a_id = least(origin.id, o.id)
          AND s.occurrence_b_id = greatest(origin.id, o.id)
      )
    ORDER BY distance_m, o.id
    LIMIT ${input.limit ?? DEFAULT_MERGE_SUGGESTION_LIMIT}
  `);
  return result.rows.map((row) => ({
    occurrenceId: row.occurrence_id,
    protocol: row.protocol,
    categoryName: row.category_name,
    description: row.description,
    distanceM: row.distance_m,
    requestCount: row.request_count,
  }));
}
