import { schema, withContext, type Database, type DbContext } from '@alocidadao/db';
import { PANEL_ROLES, type PanelRole, type PlatformRole } from '@alocidadao/shared';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireTenantHeader, requireTenantMember } from '../auth/tenant-context.js';
import { loadPlatformRole } from '../backoffice/staff.js';

const { memberships, departmentManagers, categories, tenants } = schema;

declare module 'fastify' {
  interface FastifyRequest {
    /** Quem passou por requirePanelMember; o gancho da auditoria lê daqui. */
    panelIdentity: PanelIdentity | null;
  }
}

/**
 * Quem usa o painel, na prefeitura do cabeçalho. `departmentIds` é o alcance: `null` para o
 * admin da prefeitura (todos os setores) ou a lista dos setores do gestor, que pode ser vazia.
 */
export type PanelIdentity = {
  userId: string;
  tenantId: string;
  role: PanelRole;
  departmentIds: string[] | null;
  /** Papel na equipe interna (modo suporte); `null` para gestor e admin da prefeitura. */
  platformRole: PlatformRole | null;
};

/** Contexto do banco de toda chamada do painel: a prefeitura, a pessoa e o papel interno. */
export function panelDbContext({ tenantId, userId, platformRole }: PanelIdentity): DbContext {
  return platformRole ? { tenantId, userId, platformRole } : { tenantId, userId };
}

/**
 * Exige vínculo ativo de gestor ou admin na prefeitura do cabeçalho, com a prefeitura em
 * implantação ou ativa, e devolve o papel e o alcance. Quem tem os dois papéis conta como admin.
 * A equipe interna (modo suporte), com token do painel e `users.platform_role` conferido no
 * banco, entra em qualquer prefeitura em implantação ou ativa sem vínculo, como admin; a
 * suspensa responde 403 `not_a_member`, como para o gestor.
 * Como requireTenantMember: nas recusas já responde e devolve undefined.
 */
export async function requirePanelMember(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PanelIdentity | undefined> {
  const identity = await resolvePanelIdentity(db, request, reply);
  if (identity) request.panelIdentity = identity;
  return identity;
}

async function resolvePanelIdentity(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PanelIdentity | undefined> {
  if (request.auth?.audience === 'panel') {
    const platformRole = await loadPlatformRole(db, request.auth.userId);
    if (platformRole) return requireSupportTenant(db, request, reply, platformRole);
  }

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
      return {
        userId,
        tenantId,
        role: 'tenant_admin' as const,
        departmentIds: null,
        platformRole: null,
      };
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
      platformRole: null,
    };
  });
}

/** Modo suporte: a prefeitura do cabeçalho precisa existir e estar em implantação ou ativa. */
async function requireSupportTenant(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  platformRole: PlatformRole,
): Promise<PanelIdentity | undefined> {
  const tenantId = requireTenantHeader(request, reply);
  if (!tenantId) return undefined;
  const userId = request.auth!.userId;
  // A política de tenants deixa qualquer um ler a prefeitura.
  const [tenant] = await withContext(db, { userId }, (tx) =>
    tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), inArray(tenants.status, ['onboarding', 'active'])))
      .limit(1),
  );
  if (!tenant) {
    void reply.code(403).send({ code: 'not_a_member' });
    return undefined;
  }
  return { userId, tenantId, role: 'tenant_admin', departmentIds: null, platformRole };
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
