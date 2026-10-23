import { createDatabase } from './client.js';
import {
  ADMIN_CPF,
  ADMIN_EMAIL,
  AGENT_PHONE,
  CITIZEN_PHONE,
  MANAGER_CPF,
  MANAGER_EMAIL,
  seedDev,
} from './seed-dev-data.js';

// seedDev exige o dono do banco (superusuário), nunca app_user.
const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

const { db, pool } = createDatabase(url);
try {
  const result = await seedDev(db);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    [
      '',
      'Login de desenvolvimento (código: o valor de AUTH_DEV_FIXED_CODE na API)',
      `  App, agente:   ${AGENT_PHONE}`,
      `  App, cidadão:  ${CITIZEN_PHONE}`,
      `  Painel, gestor: CPF ${MANAGER_CPF} (${MANAGER_EMAIL})`,
      `  Painel, admin:  CPF ${ADMIN_CPF} (${ADMIN_EMAIL})`,
    ].join('\n'),
  );
} finally {
  await pool.end();
}
