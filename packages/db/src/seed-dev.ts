import { createDatabase } from './client.js';
import { seedDev } from './seed-dev-data.js';

const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

const { db, pool } = createDatabase(url);
try {
  const result = await seedDev(db);
  console.log(
    JSON.stringify(
      {
        ...result,
        env: {
          EXPO_PUBLIC_DEV_TENANT_ID: result.tenantId,
          EXPO_PUBLIC_DEV_USER_ID: result.agentId,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
