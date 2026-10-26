import type { Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  occurrenceDetailSchema,
  occurrenceMapQuerySchema,
  occurrenceMapResponseSchema,
  panelContextSchema,
  panelCountsSchema,
  panelSearchResponseSchema,
  teamOptionsResponseSchema,
  triageQuerySchema,
  triageResponseSchema,
} from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import type { Storage } from '../storage/s3.js';
import { loadPanelContext, loadPanelCounts } from './context.js';
import { requirePanelMember } from './member.js';
import {
  loadOccurrenceDetail,
  loadOccurrenceMap,
  loadTeamOptions,
  searchOccurrences,
} from './occurrences.js';
import { loadTriage } from './triage.js';

export interface PanelDeps {
  /** Banco como app_user (RLS). */
  db: Database;
  /** Sem ele, as miniaturas dos relatos saem sem URL (`photoUrl: null`). */
  storage?: Storage;
}

const occurrenceParamsSchema = z.object({ id: z.uuid() });
const searchQuerySchema = z.object({ q: z.string().max(200).default('') });

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
  const { db, storage } = deps;
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

  app.get(
    '/panel/occurrences',
    {
      preHandler: panelAuth,
      schema: {
        querystring: occurrenceMapQuerySchema,
        response: { 200: occurrenceMapResponseSchema, ...panelErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadOccurrenceMap(db, identity, request.query);
    },
  );

  app.get(
    '/panel/search',
    {
      preHandler: panelAuth,
      schema: {
        querystring: searchQuerySchema,
        response: { 200: panelSearchResponseSchema, ...panelErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return searchOccurrences(db, identity, request.query.q);
    },
  );

  app.get(
    '/panel/occurrences/:id',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        response: { 200: occurrenceDetailSchema, ...panelErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const detail = await loadOccurrenceDetail(db, storage, identity, request.params.id);
      if (!detail) return reply.code(404).send({ code: 'occurrence_not_found' });
      return detail;
    },
  );

  app.get(
    '/panel/occurrences/:id/teams',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        response: { 200: teamOptionsResponseSchema, ...panelErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const options = await loadTeamOptions(db, identity, request.params.id);
      if (!options) return reply.code(404).send({ code: 'occurrence_not_found' });
      return options;
    },
  );

  app.get(
    '/panel/triage',
    {
      preHandler: panelAuth,
      schema: {
        querystring: triageQuerySchema,
        response: { 200: triageResponseSchema, ...panelErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadTriage(db, identity, request.query);
    },
  );
}
