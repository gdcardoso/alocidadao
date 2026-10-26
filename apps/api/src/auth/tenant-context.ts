import { schema, withContext, type Database } from '@alocidadao/db';
import type { TENANT_ROLES, TenantStatus } from '@alocidadao/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const { memberships, tenants, users } = schema;

const tenantHeader = z.uuid();

/**
 * Confere, no banco, que a pessoa autenticada (request.auth, de requireAuth) tem vínculo ativo
 * com um dos papéis na prefeitura do cabeçalho `x-tenant-id`, que a prefeitura está num dos
 * status aceitos (`options.tenantStatuses`, padrão só `active`; o painel aceita também
 * `onboarding`) e que a conta está ativa (nem congelada nem excluída). Roda a cada chamada: vínculo
 * desativado ou conta congelada vale na hora, mesmo com o token ainda válido.
 * Sem cabeçalho (ou fora do formato UUID): 400 `tenant_required`. Sem vínculo ou com a conta
 * inativa: 403 `not_a_member`.
 * Nesses casos já responde e devolve undefined; quem chamou deve apenas retornar `reply`.
 */
export async function requireTenantMember(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  roles: readonly (typeof TENANT_ROLES)[number][],
  options: { tenantStatuses?: readonly TenantStatus[] } = {},
): Promise<{ userId: string; tenantId: string } | undefined> {
  if (!request.auth) {
    void reply.code(401).send({ code: 'unauthorized' });
    return undefined;
  }
  const { userId } = request.auth;

  const parsed = tenantHeader.safeParse(request.headers['x-tenant-id']);
  if (!parsed.success) {
    void reply.code(400).send({ code: 'tenant_required' });
    return undefined;
  }
  const tenantId = parsed.data;

  // As políticas own_memberships_select e users (cada um vê a si mesmo) bastam com userId.
  const [member] = await withContext(db, { userId }, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'active'),
          inArray(memberships.role, [...roles]),
          inArray(tenants.status, [...(options.tenantStatuses ?? ['active'])]),
          eq(users.accountStatus, 'active'),
          isNull(users.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!member) {
    void reply.code(403).send({ code: 'not_a_member' });
    return undefined;
  }
  return { userId, tenantId };
}
