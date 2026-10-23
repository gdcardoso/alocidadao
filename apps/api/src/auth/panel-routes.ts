import { consumeCode, findUserByCpf, withContext } from '@alocidadao/db';
import {
  CODE_RESEND_SECONDS,
  CODE_TTL_SECONDS,
  apiErrorSchema,
  maskEmail,
  panelChallengeResponseSchema,
  panelStartBodySchema,
  panelVerifyBodySchema,
  sessionResponseSchema,
} from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { codeEmail } from '../messaging/email.js';
import { codeError, type AuthDeps } from './app-routes.js';
import { hashCode, issueChallenge } from './codes.js';
import { startSession } from './session.js';

/**
 * Login do painel: CPF e código enviado ao e-mail da conta. Só entra quem tem e-mail e
 * papel interno ou vínculo ativo de gestor ou administrador da prefeitura.
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
        response: { 200: sessionResponseSchema, 400: apiErrorSchema },
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

      const session = await withContext(db, { userId: user.id }, (tx) =>
        startSession(tx, { secret, userId: user.id, audience: 'panel' }),
      );
      return { session };
    },
  );
}
