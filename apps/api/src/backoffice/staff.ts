import { schema, withContext, type Database } from '@alocidadao/db';
import { PLATFORM_ROLES, type PlatformRole } from '@alocidadao/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

const { users } = schema;

/**
 * Papel da conta na equipe interna, lido no banco a cada chamada (o token não carrega o papel):
 * `null` sem papel, com a conta congelada ou excluída. A política de users deixa cada um ler a
 * própria linha.
 */
export async function loadPlatformRole(db: Database, userId: string): Promise<PlatformRole | null> {
  const [row] = await withContext(db, { userId }, (tx) =>
    tx
      .select({ platformRole: users.platformRole })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.accountStatus, 'active'), isNull(users.deletedAt)))
      .limit(1),
  );
  return row?.platformRole ?? null;
}

/**
 * Exige alguém da equipe interna: token do painel (o do app nunca vale) e `users.platform_role`
 * num dos `roles`, com a conta ativa e não excluída. Senão responde 403 `not_platform_staff`, ou
 * `admin_only` quando só o admin passa e quem chamou é do suporte. Nas recusas já responde e
 * devolve undefined; quem chamou deve apenas retornar `reply`.
 */
export async function requirePlatformStaff(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  roles: readonly PlatformRole[] = PLATFORM_ROLES,
): Promise<{ userId: string; platformRole: PlatformRole } | undefined> {
  if (!request.auth) {
    void reply.code(401).send({ code: 'unauthorized' });
    return undefined;
  }
  const { userId, audience } = request.auth;
  const platformRole = audience === 'panel' ? await loadPlatformRole(db, userId) : null;
  if (!platformRole) {
    void reply.code(403).send({ code: 'not_platform_staff' });
    return undefined;
  }
  if (!roles.includes(platformRole)) {
    const adminOnly = roles.length === 1 && roles[0] === 'admin';
    void reply.code(403).send({ code: adminOnly ? 'admin_only' : 'not_platform_staff' });
    return undefined;
  }
  return { userId, platformRole };
}
