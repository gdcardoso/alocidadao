import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { findMunicipalityAt } from './geo.js';
import { parseIbgeMunicipalities, upsertMunicipalities } from './municipalities.js';
import { TEST_APP_URL, TEST_OWNER_URL } from './test/urls.js';

// O dono grava os municípios; a leitura roda como app_user, a mesma conexão da API.

const owner = createDatabase(TEST_OWNER_URL);
const app = createDatabase(TEST_APP_URL);

const geojson: unknown = JSON.parse(
  readFileSync(new URL('./test/fixtures/municipios.geojson', import.meta.url), 'utf8'),
);

// Formato da API de localidades: o primeiro traz a UF pela microrregião; o segundo, sem
// microrregião, pela região imediata.
const names: unknown = [
  {
    id: 9999801,
    nome: 'Vila Teste',
    microrregiao: { mesorregiao: { UF: { sigla: 'MG' } } },
  },
  {
    id: 9999802,
    nome: 'Serra Inventada',
    microrregiao: null,
    'regiao-imediata': { 'regiao-intermediaria': { UF: { sigla: 'BA' } } },
  },
];

describe('parseIbgeMunicipalities', () => {
  it('parseIbgeMunicipalities junta malha e nomes', () => {
    const rows = parseIbgeMunicipalities(geojson, names);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ibgeCode: '9999801', name: 'Vila Teste', state: 'MG' });
    expect(rows[1]).toMatchObject({ ibgeCode: '9999802', name: 'Serra Inventada', state: 'BA' });
    for (const row of rows) expect(row.geometry.type).toBe('MultiPolygon');
    // O Polygon vira MultiPolygon com um polígono só.
    expect(rows[0]!.geometry.coordinates).toHaveLength(1);
    expect(rows[1]!.geometry.coordinates).toHaveLength(2);
  });

  it('recusa município da malha sem nome na API de localidades', () => {
    expect(() => parseIbgeMunicipalities(geojson, [])).toThrow(/9999801/);
  });
});

describe('findMunicipalityAt', () => {
  beforeAll(async () => {
    await upsertMunicipalities(owner.db, parseIbgeMunicipalities(geojson, names));
  });

  it('findMunicipalityAt acha o município do ponto e nada fora dele', async () => {
    const inFirst = await app.db.transaction((tx) =>
      findMunicipalityAt(tx, { lat: -39.5, lng: 40.5 }),
    );
    expect(inFirst).toEqual({ ibgeCode: '9999801', name: 'Vila Teste', state: 'MG' });
    // Segundo polígono do MultiPolygon.
    const inSecond = await app.db.transaction((tx) =>
      findMunicipalityAt(tx, { lat: -39.5, lng: 43.5 }),
    );
    expect(inSecond?.ibgeCode).toBe('9999802');
    const outside = await app.db.transaction((tx) =>
      findMunicipalityAt(tx, { lat: -39.5, lng: 42.5 }),
    );
    expect(outside).toBeUndefined();
  });

  it('com limites sobrepostos, fica o menor que contém o ponto', async () => {
    // Como a "Cidade Demo" do seed, que fica dentro do limite real de São Paulo.
    await upsertMunicipalities(owner.db, [
      {
        ibgeCode: '9999803',
        name: 'Bairro Dentro',
        state: 'MG',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [40.1, -39.9],
                [40.2, -39.9],
                [40.2, -39.8],
                [40.1, -39.8],
                [40.1, -39.9],
              ],
            ],
          ],
        },
      },
    ]);
    const found = await app.db.transaction((tx) =>
      findMunicipalityAt(tx, { lat: -39.85, lng: 40.15 }),
    );
    expect(found?.ibgeCode).toBe('9999803');
  });

  it('corrige geometria inválida ao gravar', async () => {
    // Laço em "gravata borboleta": anel que cruza a si mesmo, como um município da malha real.
    await upsertMunicipalities(owner.db, [
      {
        ibgeCode: '9999804',
        name: 'Gravata',
        state: 'MG',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [45, -40],
                [46, -39],
                [46, -40],
                [45, -39],
                [45, -40],
              ],
            ],
          ],
        },
      },
    ]);
    const result = await owner.db.execute<{ valid: boolean }>(
      sql`select ST_IsValid(boundary) as valid from municipalities where ibge_code = '9999804'`,
    );
    expect(result.rows[0]).toEqual({ valid: true });
  });

  it('gravar de novo atualiza em vez de duplicar', async () => {
    const rows = parseIbgeMunicipalities(geojson, names).map((row) => ({
      ...row,
      name: `${row.name} (novo)`,
    }));
    await upsertMunicipalities(owner.db, rows);
    const result = await owner.db.execute<{ total: number; name: string }>(
      sql`select count(*)::int as total, min(name) as name from municipalities where ibge_code = '9999801'`,
    );
    expect(result.rows[0]).toEqual({ total: 1, name: 'Vila Teste (novo)' });
  });
});
