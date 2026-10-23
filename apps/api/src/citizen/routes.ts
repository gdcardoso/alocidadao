import type { Database } from '@alocidadao/db';
import { apiErrorSchema, uploadResponseSchema } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { asActiveUser, INACTIVE } from '../auth/active-user.js';
import { requireAuth } from '../auth/plugin.js';
import { newRequestPhotoKey, type Storage } from '../storage/s3.js';
import { registerCreateRequestRoutes } from './create-request.js';
import { registerLocateRoutes } from './locate.js';

export interface CitizenDeps {
  /** Banco como app_user (RLS). */
  db: Database;
  /** Sem ele, o envio de foto responde 503 storage_not_configured. */
  storage?: Storage;
}

/**
 * Rotas do app do cidadão (/citizen/*). Todas exigem token do app e conta ativa; token do
 * painel recebe 401.
 */
export function registerCitizenRoutes(instance: FastifyInstance, deps: CitizenDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, storage } = deps;

  registerLocateRoutes(instance, deps);
  registerCreateRequestRoutes(instance, deps);

  app.post(
    '/citizen/uploads',
    {
      preHandler: requireAuth(['app']),
      schema: {
        response: { 200: uploadResponseSchema, 401: apiErrorSchema, 503: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { userId } = request.auth!;
      const active = await asActiveUser(db, userId, async () => true);
      if (active === INACTIVE) return reply.code(401).send({ code: 'unauthorized' });
      if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });
      // A foto fica no prefixo do cidadão, que identifica de quem ela é.
      const key = newRequestPhotoKey(userId);
      const { url, headers } = await storage.presignUpload(key);
      return { key, url, headers };
    },
  );
}
