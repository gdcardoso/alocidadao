// Banco próprio da API (o pacote db usa alocidadao_test), para os dois rodarem em paralelo.
export const API_TEST_OWNER_URL =
  process.env.API_TEST_DATABASE_OWNER_URL ??
  'postgres://alocidadao:alocidadao@localhost:5433/alocidadao_api_test';

/** Conexão como a API: app_user, sujeito ao RLS. */
export const API_TEST_APP_URL =
  process.env.API_TEST_DATABASE_APP_URL ??
  'postgres://app_user:app_user@localhost:5433/alocidadao_api_test';
