import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    // Migrações rodam com o dono do banco, nunca com app_user.
    url: process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao',
  },
});
