import { resetTestDatabase } from '@alocidadao/db/testing';
import { API_TEST_OWNER_URL } from './urls.js';

/** Recria o banco de teste da API do zero e aplica todas as migrações. */
export default async function setup() {
  await resetTestDatabase(API_TEST_OWNER_URL);
}
