import { randomUUID } from 'node:crypto';
import {
  clearPushForDeadSession,
  consumeCode,
  findUserByPhone,
  freezeStaleAccount,
  schema,
  sessionForRefresh,
  withContext,
  type ConsumeCodeResult,
  type Database,
} from '@alocidadao/db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_RESEND_SECONDS,
  CODE_TTL_SECONDS,
  apiErrorSchema,
  challengeResponseSchema,
  maskEmail,
  phoneStartBodySchema,
  phoneVerifyBodySchema,
  phoneVerifyResponseSchema,
  recoveryVerifyBodySchema,
  refreshBodySchema,
  refreshResponseSchema,
  sessionResponseSchema,
  signupBodySchema,
} from '@alocidadao/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { codeEmail, type EmailSender } from '../messaging/email.js';
import { smsCodeText, type SmsSender } from '../messaging/sms.js';
import { hashCode, issueChallenge } from './codes.js';
import { requireAuth } from './plugin.js';
import { startSession } from './session.js';
import { hashRefreshToken, signAccessToken, signSignupToken, verifySignupToken } from './tokens.js';

const { users, sessions, devices } = schema;

export interface AuthDeps {
  db: Database;
  secret: string;
  devFixedCode?: string;
  /** Sem envio de SMS (produção sem provedor), /auth/phone/start responde 503. */
  sms?: SmsSender;
  email: EmailSender;
}

/** Código conferido, mas recusado: a resposta é sempre 400 com o motivo. */
export function codeError(result: Exclude<ConsumeCodeResult['result'], 'ok'>) {
  return { code: `code_${result}` as const };
}

/** Recusa do cadastro dentro da transação: o throw desfaz o congelamento. */
class SignupConflict extends Error {
  constructor(readonly code: 'phone_in_use' | 'email_in_use') {
    super(code);
  }
}

/**
 * Violação de unicidade (23505) em users: o conflito que ela representa, ou undefined se o
 * erro é outro. O Drizzle embrulha o erro do Postgres em `cause`.
 */
export function usersUniqueConflict(error: unknown): 'phone_in_use' | 'email_in_use' | undefined {
  const e = error as { code?: string; constraint?: string; cause?: unknown };
  const pg = e.code === '23505' ? e : (e.cause as typeof e | undefined);
  if (pg?.code !== '23505') return undefined;
  return pg.constraint === 'users_email_lower_idx' ? 'email_in_use' : 'phone_in_use';
}

function uniqueConflict(error: unknown): SignupConflict | undefined {
  const code = usersUniqueConflict(error);
  return code ? new SignupConflict(code) : undefined;
}

/** Rotas de login do app: celular e código, cadastro, número reaproveitado e sessões. */
export function registerAppAuthRoutes(instance: FastifyInstance, deps: AuthDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, secret, devFixedCode, sms, email } = deps;

  app.post(
    '/auth/phone/start',
    {
      schema: {
        body: phoneStartBodySchema,
        response: { 200: challengeResponseSchema, 429: apiErrorSchema, 503: apiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!sms) return reply.code(503).send({ code: 'sms_not_configured' });
      const { phone } = request.body;
      // Não procura a conta aqui: a resposta é a mesma para número com e sem conta.
      const challenge = await issueChallenge(db, {
        secret,
        devFixedCode,
        purpose: 'phone_login',
        target: phone,
        userId: null,
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
    '/auth/phone/verify',
    {
      schema: {
        body: phoneVerifyBodySchema,
        response: { 200: phoneVerifyResponseSchema, 400: apiErrorSchema, 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { challengeId, code, device } = request.body;
      const consumed = await consumeCode(db, challengeId, hashCode(secret, challengeId, code));
      if (consumed.result !== 'ok') return reply.code(400).send(codeError(consumed.result));
      if (consumed.purpose !== 'phone_login') return reply.code(400).send(codeError('invalid'));
      const phone = consumed.target;

      const user = await findUserByPhone(db, phone, device.installationId);
      if (!user) {
        const signupToken = await signSignupToken(secret, { phone, device, freezeUserId: null });
        return { status: 'needs_profile' as const, signupToken };
      }

      // Conta em uso, ou parada mas vista deste aparelho antes: entra direto.
      if (!user.stale || user.knownDevice) {
        const session = await withContext(db, { userId: user.id }, (tx) =>
          startSession(tx, { secret, userId: user.id, audience: 'app', device }),
        );
        return { status: 'signed_in' as const, session };
      }

      // Número possivelmente reaproveitado: nunca entra na conta antiga só com o SMS.
      const signupToken = await signSignupToken(secret, { phone, device, freezeUserId: user.id });
      if (!user.email) return { status: 'needs_profile' as const, signupToken };

      const recovery = await issueChallenge(db, {
        secret,
        devFixedCode,
        purpose: 'account_recovery',
        target: user.email,
        userId: user.id,
      });
      // Sem novo código por e-mail agora: o do celular já foi gasto, então a pessoa segue
      // para o cadastro (o token congela a conta parada) em vez de ficar presa num 429.
      if (!recovery.issued) return { status: 'needs_profile' as const, signupToken };
      await email.send(codeEmail(user.email.toLowerCase(), recovery.code));
      return {
        status: 'email_check' as const,
        recoveryChallengeId: recovery.challengeId,
        maskedEmail: maskEmail(user.email),
        signupToken,
      };
    },
  );

  app.post(
    '/auth/signup',
    {
      schema: {
        body: signupBodySchema,
        response: { 201: sessionResponseSchema, 401: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { signupToken, name, email: userEmail, acceptedTermsVersion } = request.body;
      const claims = await verifySignupToken(secret, signupToken);
      if (!claims) return reply.code(401).send({ code: 'signup_token_invalid' });

      const userId = randomUUID();
      // Como no PATCH /me: e-mail gravado sem espaços e em minúsculas.
      const normalizedEmail = userEmail?.trim().toLowerCase() ?? null;
      try {
        const session = await withContext(db, { userId }, async (tx) => {
          // Congela antes de inserir: o índice de telefone ativo recusaria a conta nova.
          if (claims.freezeUserId) {
            const frozen = await freezeStaleAccount(tx, claims.freezeUserId, claims.phone);
            if (!frozen) throw new SignupConflict('phone_in_use');
          }
          // SQL direto: o insert do Drizzle lista todas as colunas (com `default`), e o
          // app_user só tem INSERT nestas.
          await tx.execute(sql`
            insert into users (id, name, email, phone, terms_version, terms_accepted_at)
            values (
              ${userId}, ${name}, ${normalizedEmail}, ${claims.phone},
              ${acceptedTermsVersion}, now()
            )
          `);
          return startSession(tx, { secret, userId, audience: 'app', device: claims.device });
        });
        return reply.code(201).send({ session });
      } catch (error) {
        const conflict = error instanceof SignupConflict ? error : uniqueConflict(error);
        if (!conflict) throw error;
        return reply.code(409).send({ code: conflict.code });
      }
    },
  );

  app.post(
    '/auth/recovery/verify',
    {
      schema: {
        body: recoveryVerifyBodySchema,
        response: { 200: sessionResponseSchema, 400: apiErrorSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { challengeId, code, signupToken } = request.body;
      const claims = await verifySignupToken(secret, signupToken);
      if (!claims?.freezeUserId) return reply.code(401).send({ code: 'signup_token_invalid' });
      const userId = claims.freezeUserId;

      const consumed = await consumeCode(db, challengeId, hashCode(secret, challengeId, code));
      if (consumed.result !== 'ok') return reply.code(400).send(codeError(consumed.result));
      if (consumed.purpose !== 'account_recovery' || consumed.userId !== userId) {
        return reply.code(400).send(codeError('invalid'));
      }

      const session = await withContext(db, { userId }, async (tx) => {
        // A conta pode ter sido congelada (cadastro novo) depois do envio do código.
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
        if (!active) return null;
        return startSession(tx, { secret, userId, audience: 'app', device: claims.device });
      });
      if (!session) return reply.code(400).send(codeError('invalid'));
      return { session };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        body: refreshBodySchema,
        response: { 200: refreshResponseSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const tokenHash = hashRefreshToken(request.body.refreshToken);
      const found = await sessionForRefresh(db, tokenHash);
      if (!found) {
        // Sessão revogada ou expirada no servidor: o aparelho deixa de receber push. Falha ao
        // apagar não muda a resposta.
        try {
          await clearPushForDeadSession(db, tokenHash);
        } catch (error) {
          request.log.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'Renovação recusada sem apagar o token de push do aparelho',
          );
        }
        return reply.code(401).send({ code: 'session_expired' });
      }
      const accessToken = await signAccessToken(secret, {
        userId: found.userId,
        sessionId: found.sessionId,
        audience: found.audience,
      });
      return { accessToken, accessExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
    },
  );

  app.post(
    '/auth/logout',
    { preHandler: requireAuth(['app', 'panel'], { allowWithoutTerms: true }) },
    async (request, reply) => {
      const { userId, sessionId } = request.auth!;
      await withContext(db, { userId }, async (tx) => {
        const [session] = await tx
          .update(sessions)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(sessions.id, sessionId), sql`${sessions.revokedAt} is null`))
          .returning({ installationId: sessions.installationId });
        // Quem sai do app não recebe mais push neste aparelho (a sessão do painel não tem aparelho).
        // Num savepoint: falha ao apagar o token não impede a saída.
        const installationId = session?.installationId;
        if (installationId) {
          try {
            await tx.transaction((sp) =>
              sp
                .update(devices)
                .set({ pushToken: null })
                .where(and(eq(devices.userId, userId), eq(devices.installationId, installationId))),
            );
          } catch (error) {
            request.log.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'Saída sem apagar o token de push do aparelho',
            );
          }
        }
      });
      return reply.code(204).send();
    },
  );
}
