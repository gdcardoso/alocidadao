import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from './migrator.js';
import { TEST_OWNER_URL } from './test/urls.js';
import { resetTestDatabase } from './testing.js';

// Banco próprio: aplica as migrações até a 0017, grava fotos no formato antigo e só então
// aplica o resto, como acontece num banco que já tinha dados.

const LAST_BEFORE_PURPOSE = '0017_citizen_functions';

function databaseUrl(name: string): string {
  const url = new URL(TEST_OWNER_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

const url = databaseUrl('alocidadao_photo_purpose_test');
let folder: string | undefined;

/** Cópia da pasta de migrações com o journal cortado em `lastTag`. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'alocidadao-migrations-'));
  await cp(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (last < 0) throw new Error(`Migração ${lastTag} não encontrada`);
  journal.entries = journal.entries.slice(0, last + 1);
  await writeFile(journalPath, JSON.stringify(journal));
  return dir;
}

afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

describe('migração do propósito das fotos', () => {
  it('migração preenche o propósito das fotos existentes', async () => {
    folder = await migrationsUpTo(LAST_BEFORE_PURPOSE);
    await resetTestDatabase(url, folder);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    let requestPhotoId: string;
    let workOrderPhotoId: string;
    try {
      await client.query('BEGIN');
      const tenant = await client.query<{ id: string }>(
        `insert into tenants (name, display_name, city, state, ibge_code, status)
         values ('Município Fotos', 'Prefeitura Fotos', 'Fotos', 'SP', '0000031', 'active')
         returning id`,
      );
      const tenantId = tenant.rows[0]!.id;
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const user = await client.query<{ id: string }>(
        `insert into users (name, phone) values ('Cidadão Fotos', '+5511931000001') returning id`,
      );
      const userId = user.rows[0]!.id;
      const department = await client.query<{ id: string }>(
        `insert into departments (tenant_id, name) values ($1, 'Obras') returning id`,
        [tenantId],
      );
      const team = await client.query<{ id: string }>(
        `insert into teams (tenant_id, department_id, name) values ($1, $2, 'Equipe') returning id`,
        [tenantId, department.rows[0]!.id],
      );
      const category = await client.query<{ id: string }>(
        `insert into categories (tenant_id, department_id, name) values ($1, $2, 'Buraco') returning id`,
        [tenantId, department.rows[0]!.id],
      );
      const point = `ST_SetSRID(ST_MakePoint(-46.63, -23.55), 4326)`;
      const occurrence = await client.query<{ id: string }>(
        `insert into occurrences (tenant_id, category_id, location)
         values ($1, $2, ${point}) returning id`,
        [tenantId, category.rows[0]!.id],
      );
      const request = await client.query<{ id: string }>(
        `insert into requests (tenant_id, citizen_id, category_id, occurrence_id, description, location, gps_location)
         values ($1, $2, $3, $4, 'Buraco', ${point}, ${point}) returning id`,
        [tenantId, userId, category.rows[0]!.id, occurrence.rows[0]!.id],
      );
      const order = await client.query<{ id: string }>(
        `insert into work_orders (tenant_id, occurrence_id, team_id) values ($1, $2, $3) returning id`,
        [tenantId, occurrence.rows[0]!.id, team.rows[0]!.id],
      );
      const requestPhoto = await client.query<{ id: string }>(
        `insert into photos (tenant_id, request_id, storage_key, uploaded_by)
         values ($1, $2, 'fotos/relato.jpg', $3) returning id`,
        [tenantId, request.rows[0]!.id, userId],
      );
      const workOrderPhoto = await client.query<{ id: string }>(
        `insert into photos (tenant_id, work_order_id, storage_key, uploaded_by, review)
         values ($1, $2, 'fotos/conclusao.jpg', $3, 'pending') returning id`,
        [tenantId, order.rows[0]!.id, userId],
      );
      requestPhotoId = requestPhoto.rows[0]!.id;
      workOrderPhotoId = workOrderPhoto.rows[0]!.id;
      await client.query('COMMIT');
    } finally {
      await client.end();
    }

    await runMigrations(url);

    const after = new pg.Client({ connectionString: url });
    await after.connect();
    try {
      const rows = await after.query<{ id: string; purpose: string }>(
        'select id, purpose::text as purpose from photos',
      );
      expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.purpose]))).toEqual({
        [requestPhotoId]: 'report',
        [workOrderPhotoId]: 'completion',
      });
    } finally {
      await after.end();
    }
  });
});
