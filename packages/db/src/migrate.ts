import { runMigrations } from './migrator.js';

const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

await runMigrations(url);
console.log('Migrações aplicadas.');
