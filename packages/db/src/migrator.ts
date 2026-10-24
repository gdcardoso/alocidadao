import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/** Pasta das migrações do pacote. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Aplica as migrações pendentes. Use a conexão do dono do banco, não a de app_user.
 * `migrationsFolder` só muda nos testes que aplicam as migrações em etapas.
 */
export async function runMigrations(
  ownerConnectionString: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, pool } = createDatabase(ownerConnectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
