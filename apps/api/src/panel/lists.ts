import { withContext, type Database } from '@alocidadao/db';
import {
  ACTIVE_WORK_ORDER_STATUSES,
  IN_PROGRESS_LIMIT,
  REQUESTS_PAGE_SIZE,
  type CategoryOptionsResponse,
  type IconGroup,
  type InProgressQuery,
  type InProgressResponse,
  type RequestListQuery,
  type RequestListResponse,
  type RequestStatus,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { departmentScope, panelDbContext, type PanelIdentity } from './member.js';
import { neighborhoodCondition, searchCondition, sqlList, statusSinceSql } from './occurrences.js';

/**
 * Lista "Em atendimento" (W5): uma linha por ocorrência `in_progress` no alcance, com a atividade
 * ativa mais recente, pelo prazo da atividade (sem prazo por último) e, no empate, pela mais
 * antiga no status. Protocolo e endereço são os da solicitação não cancelada mais antiga. Até
 * `IN_PROGRESS_LIMIT` linhas, com o total real. Sem dados de cidadão.
 */
export async function loadInProgress(
  db: Database,
  identity: PanelIdentity,
  query: InProgressQuery,
): Promise<InProgressResponse> {
  const { tenantId } = identity;
  // As tabelas `occurrences` e `categories` ficam sem apelido: departmentScope e statusSinceSql
  // se referem a elas pelo nome.
  const result = await withContext(db, panelDbContext(identity), (tx) =>
    tx.execute<{
      occurrence_id: string;
      protocol: string;
      category_id: string;
      category_name: string;
      icon: string | null;
      icon_group: IconGroup;
      address: string | null;
      team_name: string;
      work_order_status: WorkOrderStatus;
      due_at_ms: number | null;
      status_since_ms: number;
      total: string;
    }>(sql`
      SELECT list.*, count(*) OVER () AS total FROM (
        SELECT
          occurrences.id AS occurrence_id,
          oldest.protocol,
          categories.id AS category_id,
          categories.name AS category_name,
          categories.icon,
          categories.icon_group,
          oldest.address,
          t.name AS team_name,
          wo.status AS work_order_status,
          (extract(epoch FROM wo.due_at) * 1000)::float8 AS due_at_ms,
          (extract(epoch FROM ${statusSinceSql()}) * 1000)::float8 AS status_since_ms
        FROM occurrences
        JOIN categories
          ON categories.tenant_id = occurrences.tenant_id
          AND categories.id = occurrences.category_id
        CROSS JOIN LATERAL (
          SELECT r.protocol, r.address
          FROM requests r
          WHERE r.tenant_id = occurrences.tenant_id
            AND r.occurrence_id = occurrences.id
            AND r.status <> 'cancelled'
          ORDER BY r.created_at, r.id
          LIMIT 1
        ) oldest
        CROSS JOIN LATERAL (
          SELECT w.team_id, w.status, w.due_at
          FROM work_orders w
          WHERE w.tenant_id = occurrences.tenant_id
            AND w.occurrence_id = occurrences.id
            AND w.status IN (${sqlList(ACTIVE_WORK_ORDER_STATUSES)})
          ORDER BY w.created_at DESC, w.id
          LIMIT 1
        ) wo
        JOIN teams t ON t.tenant_id = occurrences.tenant_id AND t.id = wo.team_id
        WHERE occurrences.tenant_id = ${tenantId}
          AND occurrences.status = 'in_progress'
          AND ${query.categoryId ? sql`occurrences.category_id = ${query.categoryId}` : sql`true`}
          AND ${neighborhoodCondition(query.neighborhood) ?? sql`true`}
          AND ${query.workOrderStatus ? sql`wo.status = ${query.workOrderStatus}` : sql`true`}
          AND ${departmentScope(identity) ?? sql`true`}
      ) list
      ORDER BY due_at_ms ASC NULLS LAST, status_since_ms, occurrence_id
      LIMIT ${IN_PROGRESS_LIMIT}
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
      teamName: row.team_name,
      workOrderStatus: row.work_order_status,
      dueAt: row.due_at_ms === null ? null : new Date(row.due_at_ms).toISOString(),
      statusSince: new Date(row.status_since_ms).toISOString(),
    })),
  };
}

/**
 * Lista "Todas as solicitações" (W5): uma linha por solicitação no alcance, da mais nova para a
 * mais antiga, `REQUESTS_PAGE_SIZE` por página. O período conta pela criação da solicitação; a
 * busca de texto usa a regra da busca do mapa (texto curto demais não filtra). Sem dados de
 * cidadão.
 */
export async function loadRequestList(
  db: Database,
  identity: PanelIdentity,
  query: RequestListQuery,
): Promise<RequestListResponse> {
  const { tenantId } = identity;
  const text = searchCondition(query.q);
  // A tabela `requests` fica sem apelido: searchCondition se refere a ela pelo nome.
  const from = sql`
    FROM requests
    JOIN occurrences
      ON occurrences.tenant_id = requests.tenant_id AND occurrences.id = requests.occurrence_id
    JOIN categories
      ON categories.tenant_id = occurrences.tenant_id AND categories.id = occurrences.category_id
    WHERE requests.tenant_id = ${tenantId}
      AND ${query.status ? sql`requests.status = ${query.status}` : sql`true`}
      AND ${query.categoryId ? sql`occurrences.category_id = ${query.categoryId}` : sql`true`}
      AND ${neighborhoodCondition(query.neighborhood) ?? sql`true`}
      AND ${
        query.days === null
          ? sql`true`
          : sql`requests.created_at >= now() - make_interval(days => ${query.days})`
      }
      AND ${text ?? sql`true`}
      AND ${departmentScope(identity) ?? sql`true`}
  `;
  const { rows, total } = await withContext(db, panelDbContext(identity), async (tx) => {
    const counted = await tx.execute<{ total: string }>(sql`SELECT count(*) AS total ${from}`);
    const page = await tx.execute<{
      request_id: string;
      occurrence_id: string;
      protocol: string;
      category_id: string;
      category_name: string;
      icon: string | null;
      icon_group: IconGroup;
      address: string | null;
      status: RequestStatus;
      created_at_ms: number;
    }>(sql`
      SELECT
        requests.id AS request_id,
        requests.occurrence_id,
        requests.protocol,
        categories.id AS category_id,
        categories.name AS category_name,
        categories.icon,
        categories.icon_group,
        requests.address,
        requests.status,
        (extract(epoch FROM requests.created_at) * 1000)::float8 AS created_at_ms
      ${from}
      ORDER BY requests.created_at DESC, requests.id
      LIMIT ${REQUESTS_PAGE_SIZE} OFFSET ${(query.page - 1) * REQUESTS_PAGE_SIZE}
    `);
    return { rows: page.rows, total: Number(counted.rows[0]!.total) };
  });
  return {
    total,
    page: query.page,
    pageSize: REQUESTS_PAGE_SIZE,
    items: rows.map((row) => ({
      requestId: row.request_id,
      occurrenceId: row.occurrence_id,
      protocol: row.protocol,
      categoryId: row.category_id,
      categoryName: row.category_name,
      icon: row.icon,
      iconGroup: row.icon_group,
      address: row.address,
      status: row.status,
      createdAt: new Date(row.created_at_ms).toISOString(),
    })),
  };
}

/**
 * Categorias do alcance (ativas e inativas) em ordem de nome, para o filtro das listas.
 * O gestor vê as dos seus setores; o admin, todas.
 */
export async function loadCategoryOptions(
  db: Database,
  identity: PanelIdentity,
): Promise<CategoryOptionsResponse> {
  const { tenantId } = identity;
  const result = await withContext(db, panelDbContext(identity), (tx) =>
    tx.execute<{ id: string; name: string }>(sql`
      SELECT categories.id, categories.name
      FROM categories
      WHERE categories.tenant_id = ${tenantId}
        AND ${departmentScope(identity) ?? sql`true`}
      ORDER BY lower(categories.name), categories.id
    `),
  );
  return { items: result.rows.map((row) => ({ id: row.id, name: row.name })) };
}
