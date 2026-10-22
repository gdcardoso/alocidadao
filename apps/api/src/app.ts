import cors from '@fastify/cors';
import type { Database } from '@alocidadao/db';
import { healthResponseSchema } from '@alocidadao/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerDevUploads } from './dev/uploads.js';
import { registerDevWorkOrders } from './dev/work-orders.js';
import type { Storage } from './storage/s3.js';

export interface AppOptions {
  logger?: boolean;
  corsOrigin?: string;
  storage?: Storage;
  /** Banco como app_user (RLS). Opcional: as rotas que dependem dele respondem 503 sem ele. */
  database?: Database;
  /** Registra as rotas /dev/*; nunca em produção. */
  devRoutes?: boolean;
}

export async function buildApp({
  logger = false,
  corsOrigin,
  storage,
  database,
  devRoutes = false,
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

  if (devRoutes) {
    registerDevUploads(app, storage);
    registerDevWorkOrders(app, database, storage);
  }

  return app;
}
