import { schema, withContext, type Database } from '@alocidadao/db';
import { PANEL_ROLES, type PanelRole } from '@alocidadao/shared';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireTenantMember } from '../auth/tenant-context.js';

const { memberships, departmentManagers, categories } = schema;

/**
 * Quem usa o painel, na prefeitura do cabeçalho. `departmentIds` é o alcance: `null` para o
 * admin da prefeitura (todos os setores) ou a lista dos setores do gestor, que pode ser vazia.
 */
export type PanelIdentity = {
  userId: string;
  tenantId: string;
  role: PanelRole;
  departmentIds: string[] | null;
};

/**
 * Exige vínculo ativo de gestor ou admin na prefeitura do cabeçalho, com a prefeitura em
 * implantação ou ativa, e devolve o papel e o alcance. Quem tem os dois papéis conta como admin.
 * Como requireTenantMember: nas recusas já responde e devolve undefined.
 */
export async function requirePanelMember(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PanelIdentity | undefined> {
  const member = await requireTenantMember(db, request, reply, PANEL_ROLES, {
    tenantStatuses: ['onboarding', 'active'],
  });
  if (!member) return undefined;
  const { userId, tenantId } = member;

  return withContext(db, { tenantId, userId }, async (tx) => {
    const roles = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'active'),
          eq(memberships.role, 'tenant_admin'),
        ),
      )
      .limit(1);
    if (roles.length > 0) {
      return { userId, tenantId, role: 'tenant_admin' as const, departmentIds: null };
    }
    const departments = await tx
      .select({ id: departmentManagers.departmentId })
      .from(departmentManagers)
      .where(and(eq(departmentManagers.userId, userId), eq(departmentManagers.tenantId, tenantId)));
    return {
      userId,
      tenantId,
      role: 'manager' as const,
      departmentIds: departments.map((d) => d.id),
    };
  });
}

/**
 * Filtro do alcance sobre `categories.department_id` (a consulta precisa juntar categories):
 * undefined para o admin; para o gestor, só os setores dele (lista vazia não vê nada).
 */
export function departmentScope({ departmentIds }: PanelIdentity): SQL | undefined {
  return departmentIds === null ? undefined : inArray(categories.departmentId, departmentIds);
}

/**
 * Como requirePanelMember, mas só o admin da prefeitura passa: o gestor recebe 403 `admin_only`
 * antes de qualquer leitura do que ele pediu.
 */
export async function requirePanelAdmin(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PanelIdentity | undefined> {
  const identity = await requirePanelMember(db, request, reply);
  if (!identity) return undefined;
  if (identity.role !== 'tenant_admin') {
    void reply.code(403).send({ code: 'admin_only' });
    return undefined;
  }
  return identity;
}
