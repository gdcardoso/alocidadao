import { consumeCode, findUserByCpf, schema, sessionForRefresh, withContext } from '@alocidadao/db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_RESEND_SECONDS,
  CODE_TTL_SECONDS,
  apiErrorSchema,
  maskEmail,
  panelChallengeResponseSchema,
  panelRefreshResponseSchema,
  panelSessionResponseSchema,
  panelStartBodySchema,
  panelVerifyBodySchema,
} from '@alocidadao/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadPlatformRole } from '../backoffice/staff.js';
import { codeEmail } from '../messaging/email.js';
import { recordImplicitSupportLeave } from '../panel/audit.js';
import { codeError, type AuthDeps } from './app-routes.js';
import { hashCode, issueChallenge } from './codes.js';
import { PANEL_IDLE_TIMEOUT_SECONDS, startSession } from './session.js';
import { hashRefreshToken, signAccessToken } from './tokens.js';

const { sessions } = schema;

/** Cookie com o token de renovação do painel; o navegador guarda o token de acesso só na memória. */
export const PANEL_REFRESH_COOKIE = 'ac_panel_refresh';

/** Cabeçalho exigido na renovação e na saída do painel (proteção contra CSRF). */
export const PANEL_CSRF_HEADER = 'x-requested-with';
export const PANEL_CSRF_VALUE = 'alocidadao-panel';

const PANEL_COOKIE_PATH = '/auth/panel';

function setRefreshCookie(reply: FastifyReply, token: string) {
  void reply.setCookie(PANEL_REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: PANEL_COOKIE_PATH,
    maxAge: PANEL_IDLE_TIMEOUT_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}

function clearRefreshCookie(reply: FastifyReply) {
  void reply.clearCookie(PANEL_REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    path: PANEL_COOKIE_PATH,
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Renovar e sair têm limite próprio por IP, fora dos 20/min do login: a prefeitura sai por um
 * só IP (NAT) e um 429 aqui não pode derrubar os gestores. As duas rotas só funcionam com o
 * cookie, então não servem para força bruta.
 */
export const PANEL_SESSION_RATE_LIMIT = { max: 600, timeWindow: 60_000 } as const;

const hasCsrfHeader = (request: FastifyRequest) =>
  request.headers[PANEL_CSRF_HEADER] === PANEL_CSRF_VALUE;

/**
 * Login do painel: CPF e código enviado ao e-mail da conta. Só entra quem tem e-mail e
 * papel interno ou vínculo ativo de gestor ou administrador da prefeitura.
 * O token de renovação fica no cookie `ac_panel_refresh` (HttpOnly, só em /auth/panel); a
 * renovação e a saída leem o cookie e exigem `x-requested-with: alocidadao-panel`.
 * Exige o @fastify/cookie registrado no escopo.
 */
export function registerPanelAuthRoutes(instance: FastifyInstance, deps: AuthDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, secret, devFixedCode, email } = deps;

  app.post(
    '/auth/panel/start',
    {
      schema: {
        body: panelStartBodySchema,
        response: {
          200: panelChallengeResponseSchema,
          404: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { cpf } = request.body;
      const user = await findUserByCpf(db, cpf);
      if (!user?.email || !user.hasPanelAccess) {
        return reply.code(404).send({ code: 'panel_access_not_found' });
      }
      // O destino do código é o CPF: o limite de envio vale por CPF, e o verify acha a
      // conta por ele.
      const challenge = await issueChallenge(db, {
        secret,
        devFixedCode,
        purpose: 'panel_login',
        target: cpf,
        userId: user.id,
      });
      if (!challenge.issued) {
        return reply
          .code(429)
          .send({ code: 'code_rate_limited', retryAfterSeconds: challenge.retryAfterSeconds });
      }
      await email.send(codeEmail(user.email.toLowerCase(), challenge.code));
      return {
        challengeId: challenge.challengeId,
        expiresInSeconds: CODE_TTL_SECONDS,
        resendInSeconds: CODE_RESEND_SECONDS,
        maskedEmail: maskEmail(user.email),
      };
    },
  );

  app.post(
    '/auth/panel/verify',
    {
      schema: {
        body: panelVerifyBodySchema,
        response: { 200: panelSessionResponseSchema, 400: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { challengeId, code } = request.body;
      const consumed = await consumeCode(db, challengeId, hashCode(secret, challengeId, code));
      if (consumed.result !== 'ok') return reply.code(400).send(codeError(consumed.result));
      if (consumed.purpose !== 'panel_login') return reply.code(400).send(codeError('invalid'));

      // A conta pode ter perdido o acesso (ou sido congelada) depois do envio do código.
      const user = await findUserByCpf(db, consumed.target);
      if (!user?.hasPanelAccess || user.id !== consumed.userId) {
        return reply.code(400).send(codeError('invalid'));
      }

      // Quem é da equipe e deixou o modo suporte aberto (navegador fechado): fecha a entrada
      // anterior. O papel vem do banco, como no requirePlatformStaff.
      const platformRole = await loadPlatformRole(db, user.id);
      if (platformRole) await recordImplicitSupportLeave(db, { userId: user.id, platformRole });

      const session = await withContext(db, { userId: user.id }, (tx) =>
        startSession(tx, { secret, userId: user.id, audience: 'panel' }),
      );
      // O token de renovação vai só no cookie; o corpo leva o token de acesso.
      setRefreshCookie(reply, session.refreshToken);
      return {
        session: {
          accessToken: session.accessToken,
          accessExpiresInSeconds: session.accessExpiresInSeconds,
        },
      };
    },
  );

  app.post(
    '/auth/panel/refresh',
    {
      config: { rateLimit: PANEL_SESSION_RATE_LIMIT },
      schema: {
        response: { 200: panelRefreshResponseSchema, 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!hasCsrfHeader(request)) return reply.code(403).send({ code: 'csrf_required' });
      const token = request.cookies[PANEL_REFRESH_COOKIE];
      const found = token ? await sessionForRefresh(db, hashRefreshToken(token)) : null;
      // Sessão do app não renova o painel.
      if (!token || !found || found.audience !== 'panel') {
        clearRefreshCookie(reply);
        return reply.code(401).send({ code: 'session_expired' });
      }
      const accessToken = await signAccessToken(secret, {
        userId: found.userId,
        sessionId: found.sessionId,
        audience: 'panel',
      });
      // Mesmo token, prazo do cookie renovado junto com o da sessão.
      setRefreshCookie(reply, token);
      return { accessToken, accessExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
    },
  );

  app.post(
    '/auth/panel/logout',
    {
      config: { rateLimit: PANEL_SESSION_RATE_LIMIT },
      schema: { response: { 204: z.null(), 403: apiErrorSchema } },
    },
    async (request, reply) => {
      if (!hasCsrfHeader(request)) return reply.code(403).send({ code: 'csrf_required' });
      const token = request.cookies[PANEL_REFRESH_COOKIE];
      // A sessão só é achada pelo token (sem o token de acesso); vencida ou revogada, nada a fazer.
      const found = token ? await sessionForRefresh(db, hashRefreshToken(token)) : null;
      if (found?.audience === 'panel') {
        await withContext(db, { userId: found.userId }, (tx) =>
          tx
            .update(sessions)
            .set({ revokedAt: sql`now()` })
            .where(and(eq(sessions.id, found.sessionId), isNull(sessions.revokedAt))),
        );
      }
      clearRefreshCookie(reply);
      return reply.code(204).send(null);
    },
  );
}
