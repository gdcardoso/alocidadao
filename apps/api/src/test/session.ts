import { withContext, type Database } from '@alocidadao/db';
import { startSession } from '../auth/session.js';

export const TEST_AUTH_SECRET = 'segredo-de-teste-da-api-com-mais-de-32-caracteres';

/** Opções de `auth` para os testes: limite alto e e-mail descartado. */
export const testAuthOptions = {
  secret: TEST_AUTH_SECRET,
  email: { send: async () => {} },
  rateLimit: { max: 1000, timeWindowMs: 60_000 },
};

/** Abre uma sessão do app para a conta e devolve o cabeçalho Authorization. */
export async function appAuthHeader(db: Database, userId: string) {
  const session = await withContext(db, { userId }, (tx) =>
    startSession(tx, { secret: TEST_AUTH_SECRET, userId, audience: 'app' }),
  );
  return { authorization: `Bearer ${session.accessToken}` };
}
