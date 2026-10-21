import pg from 'pg';
import { runMigrations } from '../migrator.js';
import { TEST_OWNER_URL } from './urls.js';

/** Recria o banco de teste do zero e aplica todas as migrações. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_OWNER_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(TEST_OWNER_URL);
}
