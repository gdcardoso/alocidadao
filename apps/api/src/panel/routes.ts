import type { Database } from '@alocidadao/db';
import { apiErrorSchema, panelContextSchema, panelCountsSchema } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../auth/plugin.js';
import { loadPanelContext, loadPanelCounts } from './context.js';
import { requirePanelMember } from './member.js';

export interface PanelDeps {
  /** Banco como app_user (RLS). */
  db: Database;
}

/** Recusas comuns a toda rota do painel. */
const panelErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

/**
 * Rotas do painel da prefeitura (/panel/*). Todas exigem token do painel e vínculo ativo de
 * gestor ou admin na prefeitura do cabeçalho `x-tenant-id` (em implantação ou ativa).
 */
export function registerPanelRoutes(instance: FastifyInstance, deps: PanelDeps) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;
  const panelAuth = requireAuth(['panel']);

  app.get(
    '/panel/context',
    { preHandler: panelAuth, schema: { response: { 200: panelContextSchema, ...panelErrors } } },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadPanelContext(db, identity);
    },
  );

  app.get(
    '/panel/counts',
    { preHandler: panelAuth, schema: { response: { 200: panelCountsSchema, ...panelErrors } } },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadPanelCounts(db, identity);
    },
  );
}
