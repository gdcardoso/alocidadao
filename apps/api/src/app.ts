import cors from '@fastify/cors';
import rateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { Database } from '@alocidadao/db';
import { healthResponseSchema } from '@alocidadao/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerAppAuthRoutes } from './auth/app-routes.js';
import { registerPanelAuthRoutes } from './auth/panel-routes.js';
import { registerAuth } from './auth/plugin.js';
import { registerDevPush, type PushSenders } from './dev/push.js';
import { registerDevUploads } from './dev/uploads.js';
import { registerDevWorkOrders } from './dev/work-orders.js';
import type { EmailSender } from './messaging/email.js';
import { createLogSmsSender, type SmsSender } from './messaging/sms.js';
import { registerMeRoutes } from './me/routes.js';
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
  /** Login sem senha. As rotas /auth/* (e /me*) só existem com `auth` e `database`. */
  auth?: AuthOptions;
}

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
  scope.setErrorHandler((error: { statusCode?: number; code?: string }, _request, reply) => {
    if (error.statusCode === 429 && error.code === 'rate_limited') {
      const { retryAfterSeconds } = error as { retryAfterSeconds?: number };
      return reply.code(429).send({ code: 'rate_limited', retryAfterSeconds });
    }
    // Os demais erros seguem para o tratamento padrão.
    return reply.send(error);
  });
}

export async function buildApp({
  logger = false,
  corsOrigin,
  storage,
  database,
  push,
  devRoutes = false,
  auth,
}: AppOptions = {}) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: corsOrigin ?? true });

  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    service: 'alocidadao-api',
    time: new Date().toISOString(),
  }));

  registerAuth(app, auth?.secret);

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
  }

  if (devRoutes) {
    registerDevUploads(app, storage);
    registerDevWorkOrders(app, database, storage);
    registerDevPush(app, push);
  }

  return app;
}
