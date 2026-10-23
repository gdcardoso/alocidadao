import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import { and, eq, sql } from 'drizzle-orm';

const { users } = schema;

/** Conta congelada ou excluída: as rotas de perfil e do cidadão respondem 401. */
export const INACTIVE = Symbol('inactive');

/**
 * Roda `fn` no contexto da própria conta, só se ela continua ativa. O token de acesso não
 * consulta o banco; é esta conferência que faz congelamento e exclusão valerem na hora.
 */
export function asActiveUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T | typeof INACTIVE> {
  return withContext(db, { userId }, async (tx) => {
    const [active] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.accountStatus, 'active'),
          sql`${users.deletedAt} is null`,
        ),
      );
    return active ? fn(tx) : INACTIVE;
  });
}

/**
 * Passa a transação para o contexto da prefeitura, mantendo o usuário. Vale até o fim da
 * transação, como o `withContext`. Serve quando a prefeitura só se descobre dentro dela
 * (pelo ponto, por exemplo).
 */
export async function enterTenant(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}
