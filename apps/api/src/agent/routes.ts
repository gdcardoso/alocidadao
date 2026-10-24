import type { Database } from '@alocidadao/db';
import { apiErrorSchema, uploadResponseSchema } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../auth/plugin.js';
import { requireTenantMember } from '../auth/tenant-context.js';
import { newPhotoKey, type Storage } from '../storage/s3.js';
import { registerAgentWorkOrderRoutes } from './work-orders.js';

export interface AgentDeps {
  /** Banco como app_user (RLS). Sem ele, as rotas respondem 503 database_not_configured. */
  db?: Database;
  /** Sem ele, o detalhe e o envio de foto respondem 503 storage_not_configured. */
  storage?: Storage;
}

/**
 * Rotas do app do agente (/agent/*). Todas exigem token do app e vínculo ativo de agente na
 * prefeitura do cabeçalho `x-tenant-id`.
 */
export function registerAgentRoutes(instance: FastifyInstance, deps: AgentDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db, storage } = deps;

  registerAgentWorkOrderRoutes(instance, deps);

  app.post(
    '/agent/uploads',
    {
      preHandler: requireAuth(['app']),
      schema: {
        response: {
          200: uploadResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.code(503).send({ code: 'database_not_configured' });
      const member = await requireTenantMember(db, request, reply, ['field_agent']);
      if (!member) return reply;
      if (!storage) return reply.code(503).send({ code: 'storage_not_configured' });
      // A foto fica no prefixo da prefeitura.
      const key = newPhotoKey(member.tenantId);
      const { url, headers } = await storage.presignUpload(key);
      return { key, url, headers };
    },
  );
}
