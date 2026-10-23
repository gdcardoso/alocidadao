import type { GeoPoint, PlatformRole } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db: Database = drizzle({ client: pool, schema });
  return { db, pool };
}

/** Quem está agindo. Vira configuração da transação e é lido pelas políticas RLS. */
export interface DbContext {
  tenantId?: string;
  userId?: string;
  /** Papel na equipe interna, conferido pela API em users.platform_role antes de chegar aqui. */
  platformRole?: PlatformRole;
}

/**
 * Executa `fn` numa transação com o contexto aplicado via set_config(..., true),
 * que vale só até o fim da transação: a conexão volta limpa para o pool.
 * Toda consulta da API a dados da prefeitura deve passar por aqui.
 */
export function withContext<T>(
  db: Database,
  context: DbContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
        set_config('app.user_id', ${context.userId ?? ''}, true),
        set_config('app.platform_role', ${context.platformRole ?? ''}, true)
    `);
    return fn(tx);
  });
}

/** Ponto WGS84 (SRID 4326) para colunas geometry. */
export function geoPoint({ lat, lng }: GeoPoint) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
}
