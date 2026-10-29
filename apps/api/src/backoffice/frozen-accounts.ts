import { consumeCode, schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  CODE_RESEND_SECONDS,
  apiErrorSchema,
  frozenAccountCodeBodySchema,
  frozenAccountCodeResponseSchema,
  frozenAccountRecoverBodySchema,
  frozenAccountReleaseBodySchema,
  maskEmail,
} from '@alocidadao/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashCode, issueChallenge } from '../auth/codes.js';
import {
  isPgError,
  isUniqueViolation,
  USER_EMAIL_CONSTRAINT,
  violatedConstraint,
} from '../db-errors.js';
import { codeEmail, type EmailSender } from '../messaging/email.js';
import { requirePlatformStaff } from './staff.js';

const { tenants, users } = schema;

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

type TenantRefusal = 'tenant_not_found' | 'support_tenant_mismatch';

/**
 * A prefeitura do evento de auditoria (nula vale: P2 e P6) existe e é a do modo suporte aberto de
 * quem chama; senão, o código da recusa (404 e 403).
 */
async function checkAuditTenant(
  tx: Transaction,
  tenantId: string | null,
): Promise<TenantRefusal | null> {
  if (tenantId === null) return null;
  const [tenant] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) return 'tenant_not_found';
  const { rows } = await tx.execute<{ tenant_id: string | null }>(
    sql`select platform_open_support_tenant() as tenant_id`,
  );
  return rows[0]?.tenant_id === tenantId ? null : 'support_tenant_mismatch';
}

const TENANT_REFUSAL_STATUS = { tenant_not_found: 404, support_tenant_mismatch: 403 } as const;

/** Conta congelada de alguém da equipe interna: só o admin recupera ou libera. */
const isAdminOnly = (error: unknown) => isPgError(error, '42501', 'admin_only');

/** Recusa da recuperação dentro da transação: o throw desfaz o consumo do código. */
class EmailInUse extends Error {}

/** Conta deixou de estar congelada entre a conferência e a recuperação (outra chamada). */
const isNotFrozenAnymore = (error: unknown) => isPgError(error, 'P0002');

/**
 * Conta congelada com o CPF preso (P2, P6 e painel em modo suporte), para admin e suporte.
 * A conta antiga só volta com o código enviado ao e-mail gravado nela (nunca a um e-mail digitado);
 * sem esse e-mail, o caminho é liberar o CPF, e a conta antiga continua congelada.
 * `tenantId` é só a prefeitura do evento de auditoria: a do modo suporte aberto de quem chama
 * (outra é 403 `support_tenant_mismatch`), nulo fora dele.
 */
export function registerFrozenAccountRoutes(
  instance: FastifyInstance,
  {
    db,
    secret,
    devFixedCode,
    email,
    preHandler,
  }: {
    db: Database;
    secret: string;
    devFixedCode?: string;
    email: EmailSender;
    preHandler: preHandlerHookHandler;
  },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/backoffice/frozen-accounts/recovery-code',
    {
      preHandler,
      schema: {
        body: frozenAccountCodeBodySchema,
        response: {
          200: frozenAccountCodeResponseSchema,
          ...staffErrors,
          404: apiErrorSchema,
          409: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { cpf, tenantId } = request.body;

      const found = await withContext(db, staff, async (tx) => {
        const refusal = await checkAuditTenant(tx, tenantId);
        if (refusal) return refusal;
        const { rows } = await tx.execute<{ user_id: string; email: string | null }>(
          sql`select user_id, email from platform_frozen_account_by_cpf(${cpf})`,
        );
        return rows[0] ?? ('frozen_account_not_found' as const);
      });
      if (found === 'support_tenant_mismatch') return reply.code(403).send({ code: found });
      if (typeof found === 'string') return reply.code(404).send({ code: found });
      if (!found.email) return reply.code(409).send({ code: 'frozen_account_without_email' });

      // O destino é o e-mail da conta congelada; o desafio fica preso a ela (user_id).
      const challenge = await issueChallenge(db, {
        secret,
        devFixedCode,
        purpose: 'account_recovery',
        target: found.email,
        userId: found.user_id,
      });
      if (!challenge.issued) {
        return reply
          .code(429)
          .send({ code: 'code_rate_limited', retryAfterSeconds: challenge.retryAfterSeconds });
      }
      await email.send(codeEmail(found.email.toLowerCase(), challenge.code));
      return {
        challengeId: challenge.challengeId,
        maskedEmail: maskEmail(found.email),
        retryAfterSeconds: CODE_RESEND_SECONDS,
      };
    },
  );

  app.post(
    '/backoffice/frozen-accounts/recover',
    {
      preHandler,
      schema: {
        body: frozenAccountRecoverBodySchema,
        response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { challengeId, code, email: newEmail, tenantId } = request.body;

      let outcome: 'ok' | 'invalid_code' | TenantRefusal;
      try {
        // Uma transação só: o código é consumido junto com a recuperação. Código errado devolve
        // normalmente (a tentativa conta); a recusa da recuperação desfaz também o consumo.
        outcome = await withContext(db, staff, (tx) =>
          recoverInTransaction(tx, { secret, challengeId, code, newEmail, tenantId }),
        );
      } catch (error) {
        if (error instanceof EmailInUse) return reply.code(409).send({ code: 'email_in_use' });
        if (isNotFrozenAnymore(error)) return reply.code(400).send({ code: 'invalid_code' });
        if (isAdminOnly(error)) return reply.code(403).send({ code: 'admin_only' });
        throw error;
      }
      if (outcome === 'invalid_code') return reply.code(400).send({ code: outcome });
      if (outcome !== 'ok') {
        return reply.code(TENANT_REFUSAL_STATUS[outcome]).send({ code: outcome });
      }
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/backoffice/frozen-accounts/release-cpf',
    {
      preHandler,
      schema: {
        body: frozenAccountReleaseBodySchema,
        response: { 204: z.null(), ...staffErrors, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { cpf, tenantId } = request.body;
      try {
        const outcome = await withContext(db, staff, async (tx) => {
          const refusal = await checkAuditTenant(tx, tenantId);
          if (refusal) return refusal;
          // Só tira o CPF: a conta antiga continua congelada, e ninguém ganha acesso a ela.
          await tx.execute(sql`select platform_release_frozen_cpf(${cpf}, ${tenantId}::uuid)`);
          return 'ok' as const;
        });
        if (outcome !== 'ok') {
          return reply.code(TENANT_REFUSAL_STATUS[outcome]).send({ code: outcome });
        }
      } catch (error) {
        if (isPgError(error, 'P0002')) {
          return reply.code(404).send({ code: 'frozen_account_not_found' });
        }
        if (isAdminOnly(error)) return reply.code(403).send({ code: 'admin_only' });
        // Conta congelada sem número: sem o CPF, ela ficaria sem CPF e sem número.
        if (isPgError(error, '23514', 'frozen_account_without_phone')) {
          return reply.code(409).send({ code: 'frozen_account_without_phone' });
        }
        throw error;
      }
      return reply.code(204).send(null);
    },
  );
}

/**
 * Confere o código e recupera a conta, na transação do contexto da equipe. A conta é a do desafio
 * (`user_id`), nunca escolhida pelo corpo: o código tem de ser de recuperação, emitido para o e-mail
 * que a conta congelada ainda tem, e ela tem de continuar congelada.
 */
async function recoverInTransaction(
  tx: Transaction,
  input: {
    secret: string;
    challengeId: string;
    code: string;
    newEmail: string;
    tenantId: string | null;
  },
): Promise<'ok' | 'invalid_code' | TenantRefusal> {
  const refusal = await checkAuditTenant(tx, input.tenantId);
  if (refusal) return refusal;

  const consumed = await consumeCode(
    tx,
    input.challengeId,
    hashCode(input.secret, input.challengeId, input.code),
  );
  if (consumed.result !== 'ok') return 'invalid_code';
  if (consumed.purpose !== 'account_recovery' || !consumed.userId) return 'invalid_code';

  // A função de recuperação trava a linha e confere de novo que ela segue congelada.
  const [frozen] = await tx
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, consumed.userId),
        eq(users.accountStatus, 'frozen'),
        isNull(users.deletedAt),
      ),
    );
  if (!frozen?.email || frozen.email.toLowerCase() !== consumed.target) return 'invalid_code';

  try {
    // A função revoga as sessões antigas e grava `account.recover` (alvo `user`).
    await tx.execute(
      sql`select platform_recover_frozen_account(${consumed.userId}::uuid, ${input.newEmail}, ${input.tenantId}::uuid)`,
    );
  } catch (error) {
    if (isUniqueViolation(error) && violatedConstraint(error) === USER_EMAIL_CONSTRAINT) {
      throw new EmailInUse();
    }
    throw error;
  }
  return 'ok';
}
