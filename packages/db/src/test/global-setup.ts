import { resetTestDatabase } from '../testing.js';
import { TEST_OWNER_URL } from './urls.js';

/** Recria o banco de teste do zero e aplica todas as migrações. */
export default async function setup() {
  await resetTestDatabase(TEST_OWNER_URL);
}
