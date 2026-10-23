import type { IconGroup, RequestStatus } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import type { Transaction } from './client.js';

/** Cartão da lista "Minhas solicitações". */
export interface OwnRequestRow {
  id: string;
  tenantId: string;
  protocol: string;
  status: RequestStatus;
  categoryName: string;
  icon: string | null;
  iconGroup: IconGroup;
  address: string | null;
  createdAt: Date;
  statusChangedAt: Date;
}

interface RawOwnRequestRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  protocol: string;
  status: RequestStatus;
  category_name: string;
  icon: string | null;
  icon_group: IconGroup;
  address: string | null;
  created_at: Date | string;
  status_changed_at: Date | string;
}

/**
 * Solicitações do usuário do contexto, de todas as prefeituras, nos status pedidos.
 * As que aguardam confirmação vêm primeiro; depois, da mudança de status mais recente.
 * Deve rodar em `withContext({ userId })`: sem usuário, não devolve nada.
 */
export async function listOwnRequests(
  tx: Transaction,
  statuses: readonly RequestStatus[],
): Promise<OwnRequestRow[]> {
  // O drizzle expande array em lista de parâmetros; ARRAY[...] monta o text[] da função.
  const list = sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  );
  const result = await tx.execute<RawOwnRequestRow>(
    sql`select * from citizen_list_requests(ARRAY[${list}]::text[])`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    protocol: row.protocol,
    status: row.status,
    categoryName: row.category_name,
    icon: row.icon,
    iconGroup: row.icon_group,
    address: row.address,
    createdAt: new Date(row.created_at),
    statusChangedAt: new Date(row.status_changed_at),
  }));
}

/**
 * Prefeitura da solicitação, só se ela é do usuário do contexto; senão, nulo.
 * Deve rodar em `withContext({ userId })`.
 */
export async function ownRequestTenant(tx: Transaction, requestId: string): Promise<string | null> {
  const result = await tx.execute<{ tenant_id: string | null }>(
    sql`select citizen_request_tenant(${requestId}::uuid) as tenant_id`,
  );
  return result.rows[0]?.tenant_id ?? null;
}
