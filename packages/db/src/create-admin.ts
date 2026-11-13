import { parseArgs } from 'node:util';
import { createDatabase } from './client.js';
import { ensurePlatformAdmin } from './platform-admin.js';

// Cria (ou promove) o admin da plataforma. Uso:
//   node dist/create-admin.js --cpf 11144477735 --email x@y.com --name "Nome"
const { values } = parseArgs({
  options: {
    cpf: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
  },
});

if (!values.cpf || !values.email || !values.name) {
  console.error('Uso: create-admin --cpf <11 dígitos> --email <e-mail> --name "<nome>"');
  process.exit(1);
}

const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';
const { db, pool } = createDatabase(url);

try {
  const { created } = await ensurePlatformAdmin(db, {
    cpf: values.cpf,
    email: values.email,
    name: values.name,
  });
  console.log(created ? 'Admin criado' : 'Admin já existia (promovido)');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
// Encerra o pool para o processo terminar.
await pool.end();
