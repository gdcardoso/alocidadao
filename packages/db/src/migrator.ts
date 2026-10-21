import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Aplica as migrações pendentes. Use a conexão do dono do banco, não a de app_user. */
export async function runMigrations(ownerConnectionString: string): Promise<void> {
  const { db, pool } = createDatabase(ownerConnectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
