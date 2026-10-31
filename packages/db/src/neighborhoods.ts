import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { toMultiPolygon, validMultiPolygon, type MultiPolygonGeometry } from './municipalities.js';
import { ibgeNeighborhoods } from './schema.js';

export interface IbgeNeighborhoodRow {
  ibgeCode: string;
  code: string;
  name: string;
  geometry: MultiPolygonGeometry;
}

/** Quantos bairros vão em cada INSERT. */
const INSERT_BATCH_SIZE = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lê a malha de bairros do IBGE já convertida para GeoJSON (FeatureCollection), com as
 * propriedades `CD_MUN` (município, 7 dígitos), `CD_BAIRRO` (código do bairro) e `NM_BAIRRO`.
 * Polygon vira MultiPolygon. Recusa feição sem código ou nome.
 */
export function parseIbgeNeighborhoods(geojson: unknown): IbgeNeighborhoodRow[] {
  const features = isRecord(geojson) ? geojson.features : undefined;
  if (!Array.isArray(features)) throw new Error('A malha de bairros não é uma FeatureCollection');

  return features.map((feature, index) => {
    const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : {};
    const ibgeCode = String(properties.CD_MUN ?? '');
    const code = String(properties.CD_BAIRRO ?? '');
    const name = typeof properties.NM_BAIRRO === 'string' ? properties.NM_BAIRRO.trim() : '';
    if (!/^[0-9]{7}$/.test(ibgeCode)) {
      throw new Error(`Feição ${index} com CD_MUN inválido: ${ibgeCode}`);
    }
    if (code === '' || code === 'undefined') throw new Error(`Feição ${index} sem CD_BAIRRO`);
    if (name === '') throw new Error(`Bairro ${code} sem NM_BAIRRO`);
    return {
      ibgeCode,
      code,
      name,
      geometry: toMultiPolygon(isRecord(feature) ? feature.geometry : undefined, code),
    };
  });
}

/**
 * Substitui os bairros dos municípios presentes em `rows` (numa transação, em lotes) e recalcula
 * o bairro das ocorrências das prefeituras desses municípios. Exige a conexão do dono do banco:
 * app_user não grava em `ibge_neighborhoods`, e `refresh_occurrence_neighborhoods` só aceita o
 * admin da plataforma ou o dono do banco (`app_is_db_owner()`), que passa sem contexto.
 */
export async function upsertIbgeNeighborhoods(
  ownerDb: Database,
  rows: readonly IbgeNeighborhoodRow[],
): Promise<void> {
  const municipalities = [...new Set(rows.map((row) => row.ibgeCode))];
  if (municipalities.length === 0) return;

  await ownerDb.transaction(async (tx) => {
    await tx.execute(
      sql`delete from ibge_neighborhoods where ibge_code in (${sql.join(
        municipalities.map((code) => sql`${code}`),
        sql`, `,
      )})`,
    );
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
      await tx
        .insert(ibgeNeighborhoods)
        .values(
          batch.map((row) => ({
            ibgeCode: row.ibgeCode,
            code: row.code,
            name: row.name,
            boundary: validMultiPolygon(row.geometry),
          })),
        )
        .onConflictDoUpdate({
          target: ibgeNeighborhoods.code,
          set: {
            ibgeCode: sql`excluded.ibge_code`,
            name: sql`excluded.name`,
            boundary: sql`excluded.boundary`,
          },
        });
    }
    await tx.execute(sql`
      select refresh_occurrence_neighborhoods(t.id)
      from tenants t
      where t.ibge_code in (${sql.join(
        municipalities.map((code) => sql`${code}`),
        sql`, `,
      )})
    `);
  });
}
