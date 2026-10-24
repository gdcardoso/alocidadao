import pg from 'pg';
import { runMigrations } from './migrator.js';

/** Troca o nome do banco na URL de conexão. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Aspas de identificador do Postgres. */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Recria do zero o banco da URL (dono do banco) e aplica todas as migrações.
 * Cria o banco se ele não existir, conectando ao banco `postgres` do mesmo servidor.
 * A extensão PostGIS vem da migração 0000; o papel app_user é do cluster (init.sql).
 * `migrationsFolder` só muda nos testes que aplicam as migrações em etapas.
 */
export async function resetTestDatabase(
  ownerUrl: string,
  migrationsFolder?: string,
): Promise<void> {
  const database = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  if (!database) throw new Error('A URL de conexão não informa o nome do banco');
  // Trava de segurança: esta função apaga o schema public, então só vale para bancos de teste.
  if (!database.endsWith('_test')) {
    throw new Error(
      `resetTestDatabase recusou o banco "${database}": só bancos cujo nome termina em "_test" podem ser recriados`,
    );
  }

  const admin = new pg.Client({ connectionString: withDatabase(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (found.rowCount === 0) {
      const owner = decodeURIComponent(new URL(ownerUrl).username);
      await admin.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(owner)}`);
    }
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(ownerUrl, migrationsFolder);
}
