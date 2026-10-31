import { readFileSync } from 'node:fs';
import { createDatabase } from './client.js';
import { parseIbgeNeighborhoods, upsertIbgeNeighborhoods } from './neighborhoods.js';

// Carrega a malha de bairros do IBGE em `ibge_neighborhoods`. Roda à mão, com o dono do banco
// (DATABASE_OWNER_URL), nunca app_user; repetir só atualiza e recalcula o bairro das ocorrências.
//
// Conversão do arquivo:
//   1. Baixar a "Malha de Bairros 2022" (por UF ou Brasil) no site de malhas do IBGE.
//   2. npx mapshaper BR_bairros_CD2022.shp -proj wgs84 -o format=geojson BR_bairros.geojson
//   3. pnpm --filter @alocidadao/db import:neighborhoods -- ./BR_bairros.geojson
const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

const path = process.argv.slice(2).find((arg) => arg !== '--');
if (!path) {
  console.error('Uso: pnpm --filter @alocidadao/db import:neighborhoods -- ./BR_bairros.geojson');
  process.exit(1);
}

const startedAt = Date.now();
console.log(`Lendo ${path}...`);
const rows = parseIbgeNeighborhoods(JSON.parse(readFileSync(path, 'utf8')));
console.log(`${rows.length} bairros lidos; gravando...`);

const { db, pool } = createDatabase(url);
try {
  await upsertIbgeNeighborhoods(db, rows);
} finally {
  await pool.end();
}
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`${rows.length} bairros gravados em ${seconds} s.`);
