import { schema, withContext, type Database, type DbContext } from '@alocidadao/db';
import { apiErrorSchema, inviteResendResponseSchema } from '@alocidadao/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import { requirePlatformStaff } from '../backoffice/staff.js';
import { staffPanelIdentity } from '../backoffice/tenant-lists.js';
import type { EmailSender } from '../messaging/email.js';
import type { InviteLinks } from '../messaging/invites.js';
import { loadManagerInvite } from '../panel/admin.js';
import { recordStaffAudit } from '../panel/audit.js';
import { panelDbContext, requirePanelAdmin, requirePanelMember } from '../panel/member.js';
import { loadAgentInvite } from '../panel/teams.js';
import { resendInvite, type InviteTarget } from './send.js';

const { tenants, users } = schema;

export interface InviteRouteDeps {
  db: Database;
  email: EmailSender;
  invites: InviteLinks;
}

const userParamsSchema = z.object({ userId: z.uuid() });
const tenantUserParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });

const responses = {
  200: inviteResendResponseSchema,
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  429: z.object({ code: z.literal('rate_limited'), retryAfterSeconds: z.number().int() }),
} as const;

/** Recusa de quem monta o convite (404 ou 409 com o código). */
type Refusal = { status: number; code: string };

/**
 * Reenvia e responde: 200 com o e-mail mascarado, ou 429 dentro do intervalo. `onSent` roda só
 * depois do envio (a auditoria do backoffice).
 */
async function resend(
  deps: InviteRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: DbContext,
  loaded: { ok: InviteTarget } | { error: Refusal },
  onSent?: () => Promise<void>,
) {
  if ('error' in loaded) {
    return reply.code(loaded.error.status as 404 | 409).send({ code: loaded.error.code });
  }
  const result = await resendInvite(
    { db: deps.db, email: deps.email, links: deps.invites, log: request.log },
    ctx,
    loaded.ok,
  );
  if ('retryAfterSeconds' in result) {
    return reply
      .code(429)
      .send({ code: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
  }
  await onSent?.();
  return reply.code(200).send(result);
}

/**
 * "Reenviar convite" no painel: gestor (só o admin da prefeitura pede) e agente (admin ou gestor
 * no alcance, com a prefeitura ativa). No modo suporte, o gancho do painel grava `invite.resend`.
 */
export function registerPanelInviteRoutes(instance: FastifyInstance, deps: InviteRouteDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;
  const preHandler = requireAuth(['panel']);

  app.post(
    '/panel/managers/:userId/invite',
    { preHandler, schema: { params: userParamsSchema, response: responses } },
    async (request, reply) => {
      const identity = await requirePanelAdmin(db, request, reply);
      if (!identity) return reply;
      const loaded = await loadManagerInvite(db, identity, request.params.userId, {
        allowAdmin: false,
      });
      return resend(deps, request, reply, panelDbContext(identity), loaded);
    },
  );

  app.post(
    '/panel/agents/:userId/invite',
    { preHandler, schema: { params: userParamsSchema, response: responses } },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const loaded = await loadAgentInvite(db, identity, request.params.userId);
      return resend(deps, request, reply, panelDbContext(identity), loaded);
    },
  );
}

/**
 * "Reenviar convite" no backoffice: equipe Alô Cidadão (P6, só o Admin) e gestores e admin da
 * prefeitura (P3, Admin e Suporte). Cada reenvio grava `invite.resend` na auditoria.
 */
export function registerBackofficeInviteRoutes(
  instance: FastifyInstance,
  deps: InviteRouteDeps & { preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, preHandler } = deps;

  app.post(
    '/backoffice/staff/:userId/invite',
    { preHandler, schema: { params: userParamsSchema, response: responses } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const { userId } = request.params;
      const [person] = await withContext(db, staff, (tx) =>
        tx
          .select({
            name: users.name,
            email: users.email,
            platformRole: users.platformRole,
            accountStatus: users.accountStatus,
          })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.platformRole), isNull(users.deletedAt))),
      );
      let loaded: { ok: InviteTarget } | { error: Refusal };
      if (!person?.platformRole) loaded = { error: { status: 404, code: 'staff_not_found' } };
      else if (person.accountStatus !== 'active')
        loaded = { error: { status: 409, code: 'invite_not_allowed' } };
      else if (person.email === null) loaded = { error: { status: 409, code: 'email_missing' } };
      else
        loaded = {
          ok: {
            kind: 'staff',
            userId,
            to: person.email,
            name: person.name,
            platformRole: person.platformRole,
          },
        };
      return resend(deps, request, reply, staff, loaded, () =>
        recordStaffAudit(
          db,
          { ...staff, tenantId: null },
          { action: 'invite.resend', targetType: 'staff', targetId: userId },
        ),
      );
    },
  );

  app.post(
    '/backoffice/tenants/:id/managers/:userId/invite',
    { preHandler, schema: { params: tenantUserParamsSchema, response: responses } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { id: tenantId, userId } = request.params;
      const ctx = { ...staff, tenantId };
      const [tenant] = await withContext(db, ctx, (tx) =>
        tx
          .select({ id: tenants.id, status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, tenantId)),
      );
      if (!tenant) return reply.code(404).send({ code: 'tenant_not_found' });
      // Em implantação os gestores já trabalham; só a prefeitura suspensa fica sem convite.
      if (tenant.status === 'suspended') {
        return reply.code(409).send({ code: 'invite_not_allowed' });
      }
      const loaded = await loadManagerInvite(db, staffPanelIdentity(staff, tenantId), userId, {
        allowAdmin: true,
      });
      return resend(deps, request, reply, ctx, loaded, () =>
        recordStaffAudit(db, ctx, {
          action: 'invite.resend',
          targetType: 'manager',
          targetId: userId,
        }),
      );
    },
  );
}
