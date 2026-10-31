import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { municipalities } from './schema.js';

/** Endereços do IBGE usados pelo import (malha de qualidade mínima e nomes). */
export const IBGE_MUNICIPALITIES_GEOJSON_URL =
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json';
export const IBGE_MUNICIPALITIES_NAMES_URL =
  'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';

/** MultiPolygon do GeoJSON (RFC 7946), em WGS84. */
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export interface MunicipalityRow {
  ibgeCode: string;
  name: string;
  state: string;
  geometry: MultiPolygonGeometry;
}

/** Quantos municípios vão em cada INSERT: a malha inteira não cabe num comando só. */
const UPSERT_BATCH_SIZE = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lê um caminho de chaves num objeto desconhecido; undefined se algo faltar. */
function pick(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function toMultiPolygon(geometry: unknown, ibgeCode: string): MultiPolygonGeometry {
  const type = pick(geometry, ['type']);
  const coordinates = pick(geometry, ['coordinates']);
  if (!Array.isArray(coordinates)) {
    throw new Error(`Município ${ibgeCode} sem coordenadas na malha`);
  }
  if (type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: coordinates as number[][][][] };
  }
  if (type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [coordinates as number[][][]] };
  }
  throw new Error(`Município ${ibgeCode} com geometria ${String(type)} na malha`);
}

/** UF do município: pela microrregião ou, quando ela falta, pela região imediata. */
function stateOf(entry: unknown): unknown {
  return (
    pick(entry, ['microrregiao', 'mesorregiao', 'UF', 'sigla']) ??
    pick(entry, ['regiao-imediata', 'regiao-intermediaria', 'UF', 'sigla'])
  );
}

/**
 * Junta a malha do IBGE (FeatureCollection com `properties.codarea`) com a API de localidades
 * (`id`, `nome` e a UF). Polygon vira MultiPolygon. Recusa município da malha sem nome ou sem UF.
 */
export function parseIbgeMunicipalities(geojson: unknown, names: unknown): MunicipalityRow[] {
  const features = pick(geojson, ['features']);
  if (!Array.isArray(features)) throw new Error('A malha do IBGE não é uma FeatureCollection');
  if (!Array.isArray(names)) throw new Error('A API de localidades não devolveu uma lista');

  const byCode = new Map<string, { name: string; state: string }>();
  for (const entry of names) {
    const id = pick(entry, ['id']);
    const name = pick(entry, ['nome']);
    const state = stateOf(entry);
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof name !== 'string') continue;
    if (typeof state !== 'string') continue;
    byCode.set(String(id), { name, state });
  }

  return features.map((feature) => {
    const code = pick(feature, ['properties', 'codarea']);
    const ibgeCode = String(code);
    if (!/^[0-9]{7}$/.test(ibgeCode)) {
      throw new Error(`Código IBGE inválido na malha: ${ibgeCode}`);
    }
    const info = byCode.get(ibgeCode);
    if (!info) throw new Error(`Município ${ibgeCode} sem nome ou UF na API de localidades`);
    return {
      ibgeCode,
      name: info.name,
      state: info.state,
      geometry: toMultiPolygon(pick(feature, ['geometry']), ibgeCode),
    };
  });
}

/**
 * GeoJSON para MultiPolygon 4326 válido. A malha do IBGE traz anéis que cruzam a si mesmos;
 * ST_MakeValid os corrige e ST_CollectionExtract(..., 3) descarta linhas e pontos que sobrem.
 */
export function validMultiPolygon(geometry: MultiPolygonGeometry) {
  const raw = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`;
  return sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(${raw}), 3))`;
}

/**
 * Grava (ou atualiza) os municípios em lotes, numa transação. Exige a conexão do dono do banco:
 * app_user não grava em `municipalities`.
 */
export async function upsertMunicipalities(
  ownerDb: Database,
  rows: readonly MunicipalityRow[],
): Promise<void> {
  await ownerDb.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(start, start + UPSERT_BATCH_SIZE);
      await tx
        .insert(municipalities)
        .values(
          batch.map((row) => ({
            ibgeCode: row.ibgeCode,
            name: row.name,
            state: row.state,
            boundary: validMultiPolygon(row.geometry),
          })),
        )
        .onConflictDoUpdate({
          target: municipalities.ibgeCode,
          set: {
            name: sql`excluded.name`,
            state: sql`excluded.state`,
            boundary: sql`excluded.boundary`,
          },
        });
    }
  });
}
