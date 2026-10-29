import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import type { PlatformRole, StaffAuditAction } from '@alocidadao/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const { staffAuditEvents } = schema;

type AuditTarget = { targetType: string | null; targetId: string | null };

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Alvo da auditoria definido pela própria rota, quando não sai dos parâmetros da url (ex.: o
     * agente criado em `POST /panel/teams/:id/agents`, cujo id só existe na resposta).
     */
    auditTarget: AuditTarget | null;
  }
}

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
export function auditTarget(url: string, params: unknown): AuditTarget {
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

type AuditContext = { tenantId: string; userId: string; platformRole: PlatformRole };
type AuditEvent = {
  action: StaffAuditAction;
  targetType: string | null;
  targetId: string | null;
  details?: { route: string } | null;
};

/**
 * Insere um evento de `staff_audit_events` na transação dada, que já deve ter o contexto da equipe
 * (a política de inserção exige o papel interno, a própria conta e a prefeitura do contexto).
 */
export async function insertStaffAudit(
  tx: Transaction,
  context: AuditContext,
  event: AuditEvent,
): Promise<void> {
  await tx.insert(staffAuditEvents).values({
    tenantId: context.tenantId,
    staffUserId: context.userId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    details: event.details ?? null,
  });
}

/**
 * Grava um evento de `staff_audit_events` numa transação própria, no contexto de quem é da equipe.
 * `details` nunca leva dado pessoal: a gestão da prefeitura lê esta tabela.
 */
export async function recordStaffAudit(
  db: Database,
  context: AuditContext,
  event: AuditEvent,
): Promise<void> {
  await withContext(db, context, (tx) => insertStaffAudit(tx, context, event));
}

/**
 * Gancho `onResponse` do escopo `/panel`: com a equipe interna no modo suporte, toda chamada que
 * altera dados (método diferente de GET, resposta 2xx) grava a ação da rota, depois da resposta.
 * Gestor e admin da prefeitura não gravam nada. Falha ao gravar só vai para o log de erro.
 */
export function registerPanelAudit(app: FastifyInstance, db: Database): void {
  app.decorateRequest('panelIdentity', null);
  app.decorateRequest('auditTarget', null);
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
          ...(request.auditTarget ?? auditTarget(request.routeOptions.url ?? '', request.params)),
          details: { route },
        },
      );
    } catch (error) {
      request.log.error({ err: error, route }, 'falha ao gravar a auditoria do modo suporte');
    }
  });
}

/**
 * Saída implícita do modo suporte: se o último evento `support.*` de quem é da equipe for
 * `support.enter`, grava um `support.leave` naquela prefeitura com `details: { reason: 'implicit' }`.
 * Chamada ao entrar no modo suporte (antes da nova entrada) e no login do painel. Transação
 * própria, antes da ação seguinte: as duas linhas não ficam com o mesmo `created_at`.
 */
export async function recordImplicitSupportLeave(
  db: Database,
  staff: { userId: string; platformRole: PlatformRole },
): Promise<void> {
  await withContext(db, staff, (tx) => tx.execute(sql`select platform_close_open_support()`));
}
