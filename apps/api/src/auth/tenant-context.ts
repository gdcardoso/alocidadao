import { schema, withContext, type Database } from '@alocidadao/db';
import type { TENANT_ROLES } from '@alocidadao/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const { memberships, tenants } = schema;

const tenantHeader = z.uuid();

/**
 * Confere, no banco, que a pessoa autenticada (request.auth, de requireAuth) tem vínculo ativo
 * com um dos papéis na prefeitura do cabeçalho `x-tenant-id`, e que a prefeitura está ativa.
 * Roda a cada chamada: vínculo desativado vale na hora, mesmo com o token ainda válido.
 * Sem cabeçalho (ou fora do formato UUID): 400 `tenant_required`. Sem vínculo: 403 `not_a_member`.
 * Nesses casos já responde e devolve undefined; quem chamou deve apenas retornar `reply`.
 */
export async function requireTenantMember(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  roles: readonly (typeof TENANT_ROLES)[number][],
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

  // A política own_memberships_select deixa a pessoa ler os próprios vínculos só com userId.
  const [member] = await withContext(db, { userId }, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'active'),
          inArray(memberships.role, [...roles]),
          eq(tenants.status, 'active'),
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
