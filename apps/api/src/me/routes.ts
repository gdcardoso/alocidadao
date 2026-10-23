import {
  changePhone,
  consumeCode,
  deleteAccount,
  schema,
  withContext,
  type Database,
  type Transaction,
} from '@alocidadao/db';
import {
  CODE_RESEND_SECONDS,
  CODE_TTL_SECONDS,
  apiErrorSchema,
  challengeResponseSchema,
  deviceUpdateBodySchema,
  meResponseSchema,
  phoneChangeStartBodySchema,
  phoneChangeVerifyBodySchema,
  updateMeBodySchema,
  type MeResponse,
} from '@alocidadao/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { codeError, usersUniqueConflict, type AuthDeps } from '../auth/app-routes.js';
import { hashCode, issueChallenge } from '../auth/codes.js';
import { requireAuth } from '../auth/plugin.js';
import { smsCodeText } from '../messaging/sms.js';

const { users, memberships, tenants, devices } = schema;

export type MeDeps = Pick<AuthDeps, 'db' | 'secret' | 'devFixedCode' | 'sms'>;

/** Conta congelada ou excluída: as rotas de perfil respondem 401. */
const INACTIVE = Symbol('inactive');

/**
 * Roda `fn` no contexto da própria conta, só se ela continua ativa. O token de acesso não
 * consulta o banco; é esta conferência que faz congelamento e exclusão valerem na hora.
 */
function asActiveUser<T>(
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

/** A própria conta e os próprios vínculos (own_memberships_select; prefeituras são públicas). */
async function loadMe(tx: Transaction, userId: string): Promise<MeResponse> {
  const [user] = await tx
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      platformRole: users.platformRole,
    })
    .from(users)
    .where(eq(users.id, userId));
  const links = await tx
    .select({
      tenantId: memberships.tenantId,
      tenantName: tenants.displayName,
      tenantStatus: tenants.status,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .orderBy(asc(tenants.displayName), asc(memberships.tenantId));

  const agentTenants = links
    .filter((l) => l.role === 'field_agent' && l.tenantStatus === 'active')
    .map(({ tenantId, tenantName }) => ({ tenantId, tenantName }));
  const panelTenants = links.flatMap(({ tenantId, tenantName, role }) =>
    role === 'manager' || role === 'tenant_admin' ? [{ tenantId, tenantName, role }] : [],
  );
  return { ...user!, agentTenants, panelTenants };
}

/** Perfil e conta: dados, aparelhos, troca de número e exclusão. Cada um só a própria. */
export function registerMeRoutes(instance: FastifyInstance, deps: MeDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, secret, devFixedCode, sms } = deps;
  const anyAudience = requireAuth(['app', 'panel']);
  const unauthorized = { code: 'unauthorized' } as const;

  app.get(
    '/me',
    {
      preHandler: anyAudience,
      schema: { response: { 200: meResponseSchema, 401: apiErrorSchema } },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const me = await asActiveUser(db, userId, (tx) => loadMe(tx, userId));
      if (me === INACTIVE) return reply.code(401).send(unauthorized);
      return me;
    },
  );

  app.patch(
    '/me',
    {
      preHandler: anyAudience,
      schema: {
        body: updateMeBodySchema,
        response: { 200: meResponseSchema, 401: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const { name, email } = request.body;
      try {
        const me = await asActiveUser(db, userId, async (tx) => {
          await tx
            .update(users)
            .set({
              ...(name !== undefined && { name }),
              ...(email !== undefined && { email: email?.trim().toLowerCase() ?? null }),
            })
            .where(eq(users.id, userId));
          return loadMe(tx, userId);
        });
        if (me === INACTIVE) return reply.code(401).send(unauthorized);
        return me;
      } catch (error) {
        if (usersUniqueConflict(error) !== 'email_in_use') throw error;
        return reply.code(409).send({ code: 'email_in_use' });
      }
    },
  );

  app.put(
    '/me/devices/:installationId',
    {
      preHandler: requireAuth(['app']),
      schema: {
        params: z.object({ installationId: z.uuid() }),
        body: deviceUpdateBodySchema,
        response: { 204: z.null(), 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const { installationId } = request.params;
      const { platform, appVersion, pushToken } = request.body;
      const result = await asActiveUser(db, userId, async (tx) => {
        await tx
          .insert(devices)
          .values({ userId, installationId, platform, appVersion, pushToken: pushToken ?? null })
          .onConflictDoUpdate({
            target: [devices.userId, devices.installationId],
            set: {
              platform,
              appVersion,
              // Sem pushToken no corpo, o token gravado continua; null apaga.
              ...(pushToken !== undefined && { pushToken }),
              lastSeenAt: sql`now()`,
            },
          });
      });
      if (result === INACTIVE) return reply.code(401).send(unauthorized);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/me/phone/start',
    {
      preHandler: anyAudience,
      schema: {
        body: phoneChangeStartBodySchema,
        response: {
          200: challengeResponseSchema,
          401: apiErrorSchema,
          429: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!sms) return reply.code(503).send({ code: 'sms_not_configured' });
      const { userId } = request.auth!;
      const { phone } = request.body;
      const active = await asActiveUser(db, userId, async () => true);
      if (active === INACTIVE) return reply.code(401).send(unauthorized);

      // Número de outra conta só é recusado no verify (409), depois de provada a posse.
      const challenge = await issueChallenge(db, {
        secret,
        devFixedCode,
        purpose: 'phone_change',
        target: phone,
        userId,
      });
      if (!challenge.issued) {
        return reply
          .code(429)
          .send({ code: 'code_rate_limited', retryAfterSeconds: challenge.retryAfterSeconds });
      }
      await sms.send(phone, smsCodeText(challenge.code));
      return {
        challengeId: challenge.challengeId,
        expiresInSeconds: CODE_TTL_SECONDS,
        resendInSeconds: CODE_RESEND_SECONDS,
      };
    },
  );

  app.post(
    '/me/phone/verify',
    {
      preHandler: anyAudience,
      schema: {
        body: phoneChangeVerifyBodySchema,
        response: {
          200: meResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const { challengeId, code } = request.body;
      const consumed = await consumeCode(db, challengeId, hashCode(secret, challengeId, code));
      if (consumed.result !== 'ok') return reply.code(400).send(codeError(consumed.result));
      // Só o código de troca de número pedido por esta mesma conta.
      if (consumed.purpose !== 'phone_change' || consumed.userId !== userId) {
        return reply.code(400).send(codeError('invalid'));
      }
      try {
        const me = await asActiveUser(db, userId, async (tx) => {
          await changePhone(tx, consumed.target);
          return loadMe(tx, userId);
        });
        if (me === INACTIVE) return reply.code(401).send(unauthorized);
        return me;
      } catch (error) {
        if (usersUniqueConflict(error) !== 'phone_in_use') throw error;
        return reply.code(409).send({ code: 'phone_in_use' });
      }
    },
  );

  app.delete(
    '/me',
    { preHandler: anyAudience, schema: { response: { 204: z.null(), 401: apiErrorSchema } } },
    async (request, reply) => {
      const { userId } = request.auth!;
      const result = await asActiveUser(db, userId, (tx) => deleteAccount(tx));
      if (result === INACTIVE) return reply.code(401).send(unauthorized);
      return reply.code(204).send(null);
    },
  );
}
