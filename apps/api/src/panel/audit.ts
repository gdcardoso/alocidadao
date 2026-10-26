import { schema, withContext, type Database } from '@alocidadao/db';
import type { PlatformRole, StaffAuditAction } from '@alocidadao/shared';
import type { FastifyInstance } from 'fastify';

const { staffAuditEvents } = schema;

/**
 * Ação de auditoria de cada rota do painel que altera dados, pela chave `MÉTODO url` (a url como
 * registrada, com os parâmetros). O teste confere que toda rota não-GET do `/panel` está aqui.
 */
export const PANEL_AUDIT_ACTIONS: Record<string, StaffAuditAction> = {
  'POST /panel/occurrences/:id/assign': 'occurrence.assign',
  'POST /panel/occurrences/:id/reject': 'occurrence.reject',
  'POST /panel/occurrences/:id/merge': 'occurrence.merge',
  'POST /panel/occurrences/:id/dismiss-suggestion': 'occurrence.dismiss_suggestion',
  'POST /panel/occurrences/:id/split': 'occurrence.split',
  'POST /panel/work-orders/:id/publish': 'work_order.publish',
  'POST /panel/work-orders/:id/rework': 'work_order.rework',
  'POST /panel/work-orders/:id/reassign': 'work_order.reassign',
  'POST /panel/work-orders/:id/reschedule': 'work_order.reschedule',
  'POST /panel/teams': 'team.create',
  'PATCH /panel/teams/:id': 'team.update',
  'POST /panel/teams/:id/agents': 'agent.create',
  'PATCH /panel/agents/:userId': 'agent.update',
  'POST /panel/managers': 'manager.create',
  'PATCH /panel/managers/:userId': 'manager.update',
  'POST /panel/categories': 'category.create',
  'PATCH /panel/categories/:id': 'category.update',
  'POST /panel/departments': 'department.create',
  'PATCH /panel/departments/:id': 'department.update',
};

/** Tipo do alvo pelo trecho da url antes do parâmetro (`/panel/teams/:id/agents` → equipe). */
const TARGET_TYPES: Record<string, string> = {
  occurrences: 'occurrence',
  'work-orders': 'work_order',
  teams: 'team',
  agents: 'agent',
  managers: 'manager',
  categories: 'category',
  departments: 'department',
};

const TARGET_PARAMS = ['id', 'userId', 'occurrenceId'] as const;

/** Alvo da rota: o parâmetro `:id`, `:userId` ou `:occurrenceId` e o tipo do trecho anterior. */
export function auditTarget(
  url: string,
  params: unknown,
): { targetType: string | null; targetId: string | null } {
  const segments = url.split('/');
  const values = (params ?? {}) as Record<string, unknown>;
  for (const name of TARGET_PARAMS) {
    const index = segments.indexOf(`:${name}`);
    const value = values[name];
    if (index > 0 && typeof value === 'string') {
      return { targetType: TARGET_TYPES[segments[index - 1]!] ?? null, targetId: value };
    }
  }
  return { targetType: null, targetId: null };
}

/**
 * Grava um evento de `staff_audit_events` numa transação própria, no contexto de quem é da equipe
 * (a política de inserção exige o papel interno, a própria conta e a prefeitura do contexto).
 * `details` nunca leva dado pessoal: a gestão da prefeitura lê esta tabela.
 */
export async function recordStaffAudit(
  db: Database,
  context: { tenantId: string; userId: string; platformRole: PlatformRole },
  event: {
    action: StaffAuditAction;
    targetType: string | null;
    targetId: string | null;
    details?: { route: string } | null;
  },
): Promise<void> {
  await withContext(db, context, (tx) =>
    tx.insert(staffAuditEvents).values({
      tenantId: context.tenantId,
      staffUserId: context.userId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      details: event.details ?? null,
    }),
  );
}

/**
 * Gancho `onResponse` do escopo `/panel`: com a equipe interna no modo suporte, toda chamada que
 * altera dados (método diferente de GET, resposta 2xx) grava a ação da rota, depois da resposta.
 * Gestor e admin da prefeitura não gravam nada. Falha ao gravar só vai para o log de erro.
 */
export function registerPanelAudit(app: FastifyInstance, db: Database): void {
  app.decorateRequest('panelIdentity', null);
  app.addHook('onResponse', async (request, reply) => {
    const identity = request.panelIdentity;
    if (!identity?.platformRole) return;
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;

    const route = `${request.method} ${request.routeOptions.url}`;
    const action = PANEL_AUDIT_ACTIONS[route];
    if (!action) {
      request.log.error({ route }, 'rota do painel sem ação de auditoria');
      return;
    }
    const { tenantId, userId, platformRole } = identity;
    try {
      await recordStaffAudit(
        db,
        { tenantId, userId, platformRole },
        {
          action,
          ...auditTarget(request.routeOptions.url ?? '', request.params),
          details: { route },
        },
      );
    } catch (error) {
      request.log.error({ err: error, route }, 'falha ao gravar a auditoria do modo suporte');
    }
  });
}
