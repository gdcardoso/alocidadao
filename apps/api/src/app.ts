import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { Database } from '@alocidadao/db';
import { healthResponseSchema } from '@alocidadao/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerAgentRoutes } from './agent/routes.js';
import { registerAppAuthRoutes } from './auth/app-routes.js';
import { registerPanelAuthRoutes } from './auth/panel-routes.js';
import { registerAuth } from './auth/plugin.js';
import { registerBackofficeRoutes } from './backoffice/routes.js';
import { registerCitizenRoutes } from './citizen/routes.js';
import { registerDevManagerActions } from './dev/manager-actions.js';
import { registerDevPush, type PushSenders } from './dev/push.js';
import { registerDevWorkOrders } from './dev/work-orders.js';
import type { EmailSender } from './messaging/email.js';
import type { InviteLinks } from './messaging/invites.js';
import { createLogSmsSender, type SmsSender } from './messaging/sms.js';
import { registerMeRoutes } from './me/routes.js';
import { startScheduler, type Scheduler } from './notifications/scheduler.js';
import { registerPanelAudit } from './panel/audit.js';
import { registerPanelRoutes } from './panel/routes.js';
import type { Storage } from './storage/s3.js';

export interface AuthOptions {
  /** Assina os tokens e os hashes dos códigos (AUTH_SECRET). */
  secret: string;
  /** Código fixo aceito no login (só desenvolvimento). */
  devFixedCode?: string;
  /** Sem ele: fora de produção o SMS sai no log; em produção, 503 sms_not_configured. */
  sms?: SmsSender;
  email: EmailSender;
  /** Limite por IP em /auth/*. Padrão: 20 por minuto. */
  rateLimit?: { max: number; timeWindowMs: number };
  /** Limite por conta em POST /me/phone/start (cada SMS custa). Padrão: 5 por hora. */
  phoneChangeRateLimit?: { max: number; timeWindowMs: number };
  /**
   * Portão dos termos: conta sem aceite recebe 403 terms_required nas rotas autenticadas (menos
   * /me, o aceite, a saída e o registro do aparelho). Padrão: desligado; precisa de `database`.
   */
  termsGate?: boolean;
}

export interface AppOptions {
  logger?: boolean;
  corsOrigin?: string;
  storage?: Storage;
  /** Banco como app_user (RLS). Opcional: as rotas que dependem dele respondem 503 sem ele. */
  database?: Database;
  /** Envio de push por plataforma. Opcional: /dev/push responde 503 sem o envio pedido. */
  push?: PushSenders;
  /** Registra as rotas /dev/*; nunca em produção. */
  devRoutes?: boolean;
  /**
   * Agendador dos avisos (envio da fila, confirmação automática e limpeza). Desligado por padrão
   * (testes chamam o envio direto); precisa de `database`, `auth` (o e-mail) e dos dois senders
   * de `push`. Começa com o servidor pronto e para no preClose, antes dos onClose.
   */
  notifications?: { scheduler: boolean };
  /**
   * Login sem senha. As rotas /auth/*, /me*, /panel/*, /backoffice/* e /citizen/* só existem com `auth` e `database`;
   * as /agent/*, só com `auth`.
   */
  auth?: AuthOptions;
  /** Endereços dos botões do e-mail de convite. Padrão: o painel local, sem lojas. */
  invites?: InviteLinks;
}

const LOCAL_INVITE_LINKS: InviteLinks = {
  panelUrl: 'http://localhost:5173',
  playStoreUrl: null,
  appStoreUrl: null,
};

/**
 * Registra o @fastify/rate-limit no escopo, com a resposta 429
 * `{ code: 'rate_limited', retryAfterSeconds }`.
 */
async function registerRateLimit(scope: FastifyInstance, options: RateLimitPluginOptions) {
  await scope.register(rateLimit, {
    ...options,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      code: 'rate_limited',
      retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
    }),
  });
  scope.setErrorHandler((error: { statusCode?: number; code?: string }, request, reply) => {
    if (error.statusCode === 429 && error.code === 'rate_limited') {
      const { retryAfterSeconds } = error as { retryAfterSeconds?: number };
      return reply.code(429).send({ code: 'rate_limited', retryAfterSeconds });
    }
    return handleError(error, request, reply);
  });
}

/**
 * Erro inesperado (sem statusCode ou 5xx) vira `500 { code: 'internal_error' }`, sem a mensagem
 * interna, e vai ao log do servidor. Erros 4xx (validação, corpo inválido, 413) seguem o tratamento
 * padrão do Fastify.
 */
function handleError(
  error: { statusCode?: number; code?: string },
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error.statusCode === undefined || error.statusCode >= 500) {
    request.log.error({ err: error }, 'Erro inesperado');
    return reply.code(500).send({ code: 'internal_error' });
  }
  return reply.send(error);
}

export async function buildApp({
  logger = false,
  corsOrigin,
  storage,
  database,
  push,
  devRoutes = false,
  auth,
  notifications,
  invites = LOCAL_INVITE_LINKS,
}: AppOptions = {}) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);

  await app.register(cors, { origin: corsOrigin ?? true });

  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    service: 'alocidadao-api',
    time: new Date().toISOString(),
  }));

  registerAuth(app, auth?.secret, {
    termsGateDb: auth?.termsGate ? database : undefined,
  });

  if (auth && database) {
    const sms =
      auth.sms ?? (process.env.NODE_ENV === 'production' ? undefined : createLogSmsSender(app.log));
    const deps = {
      db: database,
      secret: auth.secret,
      devFixedCode: auth.devFixedCode,
      sms,
      email: auth.email,
    };
    // Escopo próprio: o limite por IP vale só para /auth/*.
    await app.register(async (scope) => {
      await registerRateLimit(scope, {
        max: auth.rateLimit?.max ?? 20,
        timeWindow: auth.rateLimit?.timeWindowMs ?? 60_000,
      });
      // Cookie do token de renovação do painel.
      await scope.register(cookie);
      registerAppAuthRoutes(scope, deps);
      registerPanelAuthRoutes(scope, deps);
    });
    // Perfil: sem limite por IP; só a troca de número tem limite próprio, por conta.
    await app.register(async (scope) => {
      await registerRateLimit(scope, { global: false });
      registerMeRoutes(scope, {
        ...deps,
        phoneChangeRateLimit: {
          max: auth.phoneChangeRateLimit?.max ?? 5,
          timeWindowMs: auth.phoneChangeRateLimit?.timeWindowMs ?? 60 * 60_000,
        },
      });
    });
    // Painel da prefeitura: escopo próprio, sem limite por IP. A auditoria do modo suporte
    // vem antes das rotas, para o gancho valer em todas.
    await app.register(async (scope) => {
      registerPanelAudit(scope, database);
      registerPanelRoutes(scope, { db: database, storage, email: auth.email, invites });
    });
    // Backoffice da equipe interna: escopo próprio, sem limite por IP.
    await app.register(async (scope) => {
      registerBackofficeRoutes(scope, {
        db: database,
        secret: auth.secret,
        devFixedCode: auth.devFixedCode,
        email: auth.email,
        invites,
      });
    });
    // Cidadão: escopo próprio, sem o limite por IP do /auth/*.
    await app.register(async (scope) => {
      registerCitizenRoutes(scope, { db: database, storage, secret: auth.secret });
    });
  }

  if (auth) {
    // Agente: só depende da sessão; sem banco, as rotas respondem 503 database_not_configured.
    await app.register(async (scope) => {
      registerAgentRoutes(scope, { db: database, storage });
    });
  }

  if (devRoutes) {
    // As decisões simuladas do gestor dependem da sessão; sem `auth` só o /dev/push existe.
    if (auth) {
      registerDevWorkOrders(app, database);
      registerDevManagerActions(app, database);
    }
    registerDevPush(app, push);
  }

  if (notifications?.scheduler) {
    const android = push?.android;
    const ios = push?.ios;
    if (!database || !auth || !android || !ios) {
      app.log.warn('Agendador dos avisos desligado: falta banco, login ou envio de push');
    } else {
      let scheduler: Scheduler | undefined;
      app.addHook('onReady', async () => {
        scheduler = startScheduler({
          db: database,
          push: { android, ios },
          email: auth.email,
          log: app.log,
        });
      });
      // preClose roda antes de todo onClose (o pool do banco fecha num onClose do server.ts):
      // a rodada em andamento termina com o banco ainda aberto.
      app.addHook('preClose', async () => {
        await scheduler?.stop();
      });
    }
  }

  return app;
}
