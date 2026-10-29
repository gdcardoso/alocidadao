import type { Database } from '@alocidadao/db';
import {
  apiErrorSchema,
  assignBodySchema,
  agentCreateBodySchema,
  agentRowSchema,
  agentUpdateBodySchema,
  agentsResponseSchema,
  assignResponseSchema,
  departmentsResponseSchema,
  dismissSuggestionBodySchema,
  mergeBodySchema,
  mergeResponseSchema,
  occurrenceDetailSchema,
  occurrenceMapQuerySchema,
  occurrenceMapResponseSchema,
  panelContextSchema,
  panelCountsSchema,
  panelSearchResponseSchema,
  impedimentDetailSchema,
  categoryOptionsResponseSchema,
  inProgressQuerySchema,
  inProgressResponseSchema,
  requestListQuerySchema,
  requestListResponseSchema,
  publishBodySchema,
  reassignBodySchema,
  rescheduleBodySchema,
  rejectBodySchema,
  reviewDetailSchema,
  reworkBodySchema,
  splitBodySchema,
  splitResponseSchema,
  teamCreateBodySchema,
  teamSummarySchema,
  teamUpdateBodySchema,
  teamsResponseSchema,
  teamOptionsResponseSchema,
  triageQuerySchema,
  triageResponseSchema,
  workOrderResultSchema,
  workQueueResponseSchema,
} from '@alocidadao/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import type { Storage } from '../storage/s3.js';
import {
  assignOccurrence,
  dismissSuggestion,
  mergeOccurrences,
  rejectOccurrence,
  splitOccurrence,
  type ActionError,
} from './actions.js';
import { registerAdminRoutes } from './admin.js';
import { loadPanelContext, loadPanelCounts } from './context.js';
import { loadCategoryOptions, loadInProgress, loadRequestList } from './lists.js';
import { requirePanelMember } from './member.js';
import {
  loadOccurrenceDetail,
  loadOccurrenceMap,
  loadTeamOptions,
  searchOccurrences,
} from './occurrences.js';
import {
  addAgent,
  createTeam,
  loadDepartments,
  loadTeamAgents,
  loadTeams,
  updateAgent,
  updateTeam,
  type TeamsResult,
} from './teams.js';
import { loadTriage } from './triage.js';
import {
  publishWorkOrder,
  reassignWorkOrder,
  requestRework,
  rescheduleWorkOrder,
} from './work-order-actions.js';
import { loadImpedimentDetail, loadReviewDetail, loadWorkQueue } from './work-orders.js';

export interface PanelDeps {
  /** Banco como app_user (RLS). */
  db: Database;
  /** Sem ele, as miniaturas dos relatos saem sem URL (`photoUrl: null`). */
  storage?: Storage;
}

const occurrenceParamsSchema = z.object({ id: z.uuid() });
const idParamsSchema = z.object({ id: z.uuid() });
const searchQuerySchema = z.object({ q: z.string().max(200).default('') });

/** Recusas comuns a toda rota do painel. */
const panelErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

/** Recusas das ações sobre ocorrência. */
const actionErrors = {
  ...panelErrors,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
} as const;

const sendActionError = (reply: FastifyReply, { error }: ActionError) =>
  reply.code(error.status).send({ code: error.code });

const teamsErrorSchema = apiErrorSchema.extend({ teamName: z.string().optional() });
const userParamsSchema = z.object({ userId: z.uuid() });

const sendTeamsError = (
  reply: FastifyReply,
  { error }: Extract<TeamsResult<unknown>, { error: unknown }>,
) =>
  reply
    .code(error.status)
    .send(
      'teamName' in error ? { code: error.code, teamName: error.teamName } : { code: error.code },
    );

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
    '/panel/in-progress',
    {
      preHandler: panelAuth,
      schema: {
        querystring: inProgressQuerySchema,
        response: { 200: inProgressResponseSchema, ...panelErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadInProgress(db, identity, request.query);
    },
  );

  app.get(
    '/panel/category-options',
    {
      preHandler: panelAuth,
      schema: { response: { 200: categoryOptionsResponseSchema, ...panelErrors } },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadCategoryOptions(db, identity);
    },
  );

  app.get(
    '/panel/requests',
    {
      preHandler: panelAuth,
      schema: {
        querystring: requestListQuerySchema,
        response: { 200: requestListResponseSchema, ...panelErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadRequestList(db, identity, request.query);
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

  app.post(
    '/panel/occurrences/:id/assign',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        body: assignBodySchema,
        response: { 200: assignResponseSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await assignOccurrence(db, identity, request.params.id, request.body);
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.post(
    '/panel/occurrences/:id/reject',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        body: rejectBodySchema,
        response: { 204: z.null(), ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await rejectOccurrence(db, identity, request.params.id, request.body.reason);
      if ('error' in result) return sendActionError(reply, result);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/panel/occurrences/:id/merge',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        body: mergeBodySchema,
        response: { 200: mergeResponseSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await mergeOccurrences(
        db,
        identity,
        request.params.id,
        request.body.otherOccurrenceId,
      );
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.post(
    '/panel/occurrences/:id/dismiss-suggestion',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        body: dismissSuggestionBodySchema,
        response: {
          204: z.null(),
          ...panelErrors,
          404: apiErrorSchema,
          409: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await dismissSuggestion(
        db,
        identity,
        request.params.id,
        request.body.otherOccurrenceId,
      );
      if ('error' in result) return sendActionError(reply, result);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/panel/occurrences/:id/split',
    {
      preHandler: panelAuth,
      schema: {
        params: occurrenceParamsSchema,
        body: splitBodySchema,
        response: { 200: splitResponseSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await splitOccurrence(
        db,
        identity,
        request.params.id,
        request.body.requestIds,
      );
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.get(
    '/panel/reviews',
    {
      preHandler: panelAuth,
      schema: { response: { 200: workQueueResponseSchema, ...panelErrors } },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadWorkQueue(db, identity, 'awaiting_review');
    },
  );

  app.get(
    '/panel/reviews/:id',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        response: { 200: reviewDetailSchema, ...panelErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const detail = await loadReviewDetail(db, identity, request.params.id, storage);
      if (!detail) return reply.code(404).send({ code: 'work_order_not_found' });
      return detail;
    },
  );

  app.post(
    '/panel/work-orders/:id/publish',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: publishBodySchema,
        response: { 200: workOrderResultSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await publishWorkOrder(db, identity, request.params.id, request.body);
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.post(
    '/panel/work-orders/:id/rework',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: reworkBodySchema,
        response: { 200: workOrderResultSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await requestRework(db, identity, request.params.id, request.body);
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.get(
    '/panel/impediments',
    {
      preHandler: panelAuth,
      schema: { response: { 200: workQueueResponseSchema, ...panelErrors } },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadWorkQueue(db, identity, 'impeded');
    },
  );

  app.get(
    '/panel/impediments/:id',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        response: { 200: impedimentDetailSchema, ...panelErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const detail = await loadImpedimentDetail(db, identity, request.params.id, storage);
      if (!detail) return reply.code(404).send({ code: 'work_order_not_found' });
      return detail;
    },
  );

  app.post(
    '/panel/work-orders/:id/reassign',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: reassignBodySchema,
        response: { 200: workOrderResultSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await reassignWorkOrder(db, identity, request.params.id, request.body);
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  app.post(
    '/panel/work-orders/:id/reschedule',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: rescheduleBodySchema,
        response: { 200: workOrderResultSchema, ...actionErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await rescheduleWorkOrder(db, identity, request.params.id, request.body);
      if ('error' in result) return sendActionError(reply, result);
      return result.ok;
    },
  );

  const teamErrors = {
    ...panelErrors,
    404: apiErrorSchema,
    409: teamsErrorSchema,
    422: apiErrorSchema,
  } as const;

  app.get(
    '/panel/teams',
    { preHandler: panelAuth, schema: { response: { 200: teamsResponseSchema, ...panelErrors } } },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return { items: await loadTeams(db, identity) };
    },
  );

  app.post(
    '/panel/teams',
    {
      preHandler: panelAuth,
      schema: { body: teamCreateBodySchema, response: { 201: teamSummarySchema, ...teamErrors } },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await createTeam(db, identity, request.body);
      if ('error' in result) return sendTeamsError(reply, result);
      return reply.code(201).send(result.ok);
    },
  );

  app.patch(
    '/panel/teams/:id',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: teamUpdateBodySchema,
        response: { 200: teamSummarySchema, ...teamErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await updateTeam(db, identity, request.params.id, request.body);
      if ('error' in result) return sendTeamsError(reply, result);
      return result.ok;
    },
  );

  app.get(
    '/panel/teams/:id/agents',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        response: { 200: agentsResponseSchema, ...panelErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const agents = await loadTeamAgents(db, identity, request.params.id);
      if (!agents) return reply.code(404).send({ code: 'team_not_found' });
      return agents;
    },
  );

  app.post(
    '/panel/teams/:id/agents',
    {
      preHandler: panelAuth,
      schema: {
        params: idParamsSchema,
        body: agentCreateBodySchema,
        response: { 201: agentRowSchema, ...teamErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await addAgent(db, identity, request.params.id, request.body);
      if ('error' in result) return sendTeamsError(reply, result);
      // No modo suporte, a auditoria aponta o agente criado ou vinculado, não a equipe da url.
      request.auditTarget = { targetType: 'agent', targetId: result.ok.userId };
      return reply.code(201).send(result.ok);
    },
  );

  app.patch(
    '/panel/agents/:userId',
    {
      preHandler: panelAuth,
      schema: {
        params: userParamsSchema,
        body: agentUpdateBodySchema,
        response: { 200: agentRowSchema, ...teamErrors },
      },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      const result = await updateAgent(db, identity, request.params.userId, request.body);
      if ('error' in result) return sendTeamsError(reply, result);
      return result.ok;
    },
  );

  app.get(
    '/panel/departments',
    {
      preHandler: panelAuth,
      schema: { response: { 200: departmentsResponseSchema, ...panelErrors } },
    },
    async (request, reply) => {
      const identity = await requirePanelMember(db, request, reply);
      if (!identity) return reply;
      return loadDepartments(db, identity);
    },
  );

  registerAdminRoutes(instance, { db });
}
