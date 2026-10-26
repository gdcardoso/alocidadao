import { withContext, type Database } from '@alocidadao/db';
import { startSession } from '../auth/session.js';
import { TEST_AUTH_SECRET } from './session.js';

/**
 * Abre uma sessão do painel para a conta e devolve o cabeçalho Authorization e, com
 * `tenantId`, o `x-tenant-id`.
 */
export async function panelAuthHeader(
  db: Database,
  userId: string,
  tenantId?: string,
): Promise<{ authorization: string; 'x-tenant-id'?: string }> {
  const session = await withContext(db, { userId }, (tx) =>
    startSession(tx, { secret: TEST_AUTH_SECRET, userId, audience: 'panel' }),
  );
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
  };
}

/**
 * Abre uma sessão do painel para alguém da equipe interna e devolve o cabeçalho Authorization
 * (para o backoffice). No modo suporte, use `panelAuthHeader` com a prefeitura escolhida.
 */
export async function staffAuthHeader(
  db: Database,
  userId: string,
): Promise<{ authorization: string }> {
  return panelAuthHeader(db, userId) as Promise<{ authorization: string }>;
}
