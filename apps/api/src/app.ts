import cors from '@fastify/cors';
import { healthResponseSchema } from '@alocidadao/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerDevUploads } from './dev/uploads.js';
import type { Storage } from './storage/s3.js';

export interface AppOptions {
  logger?: boolean;
  corsOrigin?: string;
  storage?: Storage;
  /** Registra as rotas /dev/*; nunca em produção. */
  devRoutes?: boolean;
}

export async function buildApp({
  logger = false,
  corsOrigin,
  storage,
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

  if (devRoutes) registerDevUploads(app, storage);

  return app;
}
