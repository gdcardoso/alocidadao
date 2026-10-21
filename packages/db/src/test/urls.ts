export const TEST_OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ??
  'postgres://alocidadao:alocidadao@localhost:5433/alocidadao_test';

/** Conexão como a API: app_user, sujeito ao RLS. */
export const TEST_APP_URL =
  process.env.TEST_DATABASE_APP_URL ?? 'postgres://app_user:app_user@localhost:5433/alocidadao_test';
