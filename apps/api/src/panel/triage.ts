import { withContext, type Database } from '@alocidadao/db';
import {
  CLUSTERABLE_OCCURRENCE_STATUSES,
  MAX_SUGGESTIONS,
  TRIAGE_LIMIT,
  type IconGroup,
  type TriageQuery,
  type TriageResponse,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { departmentScope, type PanelIdentity } from './member.js';
import { sqlList, statusSinceSql } from './occurrences.js';

/**
 * Fila da triagem (W5): as ocorrências em triagem no alcance, da mais antiga para a mais nova
 * pelo `statusSince`, até `TRIAGE_LIMIT` linhas, com o total real. Protocolo e endereço são os
 * da solicitação não cancelada mais antiga. `suggestionCount` conta as sugestões de junção como
 * `findMergeSuggestions` (mesma categoria, no raio, agrupável, com relato, sem par descartado),
 * até `MAX_SUGGESTIONS`, o que o painel do ponto mostra.
 */
export async function loadTriage(
  db: Database,
  identity: PanelIdentity,
  query: TriageQuery,
): Promise<TriageResponse> {
  const { userId, tenantId } = identity;
  // O total sai da janela, contada antes do LIMIT. As tabelas `occurrences` e `categories` ficam sem apelido: departmentScope e
  // statusSinceSql se referem a elas pelo nome.
  const result = await withContext(db, { tenantId, userId }, (tx) =>
    tx.execute<{
      occurrence_id: string;
      protocol: string;
      category_id: string;
      category_name: string;
      icon: string | null;
      icon_group: IconGroup;
      address: string | null;
      department_name: string;
      request_count: number;
      suggestion_count: number;
      status_since_ms: number;
      total: string;
    }>(sql`
      SELECT triage.*, count(*) OVER () AS total FROM (
        SELECT
          occurrences.id AS occurrence_id,
          oldest.protocol,
          categories.id AS category_id,
          categories.name AS category_name,
          categories.icon,
          categories.icon_group,
          oldest.address,
          d.name AS department_name,
          oldest.request_count,
          nearby.n AS suggestion_count,
          (extract(epoch FROM ${statusSinceSql()}) * 1000)::float8 AS status_since_ms
        FROM occurrences
        JOIN categories
          ON categories.tenant_id = occurrences.tenant_id
          AND categories.id = occurrences.category_id
        JOIN departments d ON d.tenant_id = categories.tenant_id AND d.id = categories.department_id
        CROSS JOIN LATERAL (
          SELECT r.protocol, r.address, count(*) OVER ()::int AS request_count
          FROM requests r
          WHERE r.tenant_id = occurrences.tenant_id
            AND r.occurrence_id = occurrences.id
            AND r.status <> 'cancelled'
          ORDER BY r.created_at, r.id
          LIMIT 1
        ) oldest
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS n
          FROM (
            SELECT 1
            FROM occurrences o
            WHERE o.tenant_id = occurrences.tenant_id
              AND o.category_id = occurrences.category_id
              AND o.id <> occurrences.id
              AND o.status IN (${sqlList(CLUSTERABLE_OCCURRENCE_STATUSES)})
              AND ST_DWithin(
                o.location::geography,
                occurrences.location::geography,
                categories.cluster_radius_m
              )
              AND EXISTS (
                SELECT 1 FROM requests r
                WHERE r.tenant_id = o.tenant_id AND r.occurrence_id = o.id
                  AND r.status <> 'cancelled'
              )
              AND NOT EXISTS (
                SELECT 1 FROM occurrence_separations s
                WHERE s.tenant_id = occurrences.tenant_id
                  AND s.occurrence_a_id = least(occurrences.id, o.id)
                  AND s.occurrence_b_id = greatest(occurrences.id, o.id)
              )
            LIMIT ${MAX_SUGGESTIONS}
          ) found
        ) nearby
        WHERE occurrences.tenant_id = ${tenantId}
          AND occurrences.status = 'triage'
          AND ${query.categoryId ? sql`occurrences.category_id = ${query.categoryId}` : sql`true`}
          AND ${departmentScope(identity) ?? sql`true`}
          AND ${query.onlySuggestions ? sql`nearby.n > 0` : sql`true`}
      ) triage
      ORDER BY status_since_ms, occurrence_id
      LIMIT ${TRIAGE_LIMIT}
    `),
  );
  const rows = result.rows;
  return {
    total: rows.length === 0 ? 0 : Number(rows[0]!.total),
    items: rows.map((row) => ({
      occurrenceId: row.occurrence_id,
      protocol: row.protocol,
      categoryId: row.category_id,
      categoryName: row.category_name,
      icon: row.icon,
      iconGroup: row.icon_group,
      address: row.address,
      departmentName: row.department_name,
      requestCount: row.request_count,
      suggestionCount: row.suggestion_count,
      statusSince: new Date(row.status_since_ms).toISOString(),
    })),
  };
}
