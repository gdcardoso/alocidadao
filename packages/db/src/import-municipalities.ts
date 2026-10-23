import { createDatabase } from './client.js';
import {
  IBGE_MUNICIPALITIES_GEOJSON_URL,
  IBGE_MUNICIPALITIES_NAMES_URL,
  parseIbgeMunicipalities,
  upsertMunicipalities,
} from './municipalities.js';

// Baixa a malha e os nomes dos municípios do IBGE e grava em `municipalities`.
// Roda à mão, uma vez por banco; repetir só atualiza. Exige o dono do banco, nunca app_user.
const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

async function fetchJson(address: string): Promise<unknown> {
  const response = await fetch(address, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`O IBGE respondeu ${response.status} para ${address}`);
  }
  return response.json();
}

const startedAt = Date.now();
console.log('Baixando a malha e os nomes dos municípios do IBGE...');
const [geojson, names] = await Promise.all([
  fetchJson(IBGE_MUNICIPALITIES_GEOJSON_URL),
  fetchJson(IBGE_MUNICIPALITIES_NAMES_URL),
]);
const rows = parseIbgeMunicipalities(geojson, names);
console.log(`${rows.length} municípios lidos; gravando...`);

const { db, pool } = createDatabase(url);
try {
  await upsertMunicipalities(db, rows);
} finally {
  await pool.end();
}
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`${rows.length} municípios gravados em ${seconds} s.`);
