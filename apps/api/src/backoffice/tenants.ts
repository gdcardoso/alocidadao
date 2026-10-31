import { schema, withContext, type Database, type Transaction } from '@alocidadao/db';
import {
  apiErrorSchema,
  contractBodySchema,
  tenantDetailSchema,
  tenantListResponseSchema,
  tenantStatusBodySchema,
  type Plan,
  type StaffAuditAction,
  type TenantStatus,
} from '@alocidadao/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { insertStaffAudit } from '../panel/audit.js';
import { requirePlatformStaff } from './staff.js';

const { tenants, tenantContracts, staffAuditEvents, users, categories, teams } = schema;

const tenantParamsSchema = z.object({ id: z.uuid() });

const staffErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
} as const;

const STATUS_ORDER: Record<TenantStatus, number> = { active: 0, onboarding: 1, suspended: 2 };

/** Transições válidas: ação → [status de origem, status de destino, ação de auditoria]. */
const TRANSITIONS: Record<
  'activate' | 'suspend' | 'reactivate',
  { from: TenantStatus; to: TenantStatus; audit: StaffAuditAction }
> = {
  activate: { from: 'onboarding', to: 'active', audit: 'tenant.activate' },
  suspend: { from: 'active', to: 'suspended', audit: 'tenant.suspend' },
  reactivate: { from: 'suspended', to: 'active', audit: 'tenant.reactivate' },
};

const num = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

type SummaryRow = {
  tenant_id: string;
  citizen_count: number;
  open_count: number;
  avg_resolution_days: string | null;
  late_review_count: number;
  stale_impediment_count: number;
  active_category_count: number;
};

type OverviewRow = {
  active_tenants: number;
  onboarding_tenants: number;
  suspended_tenants: number;
  citizens: number;
  requests_this_month: number;
  requests_last_month: number;
  avg_resolution_days: string | null;
};

type DetailRow = {
  citizen_count: number;
  open_count: number;
  stale_triage_count: number;
  awaiting_review_count: number;
  late_review_count: number;
  team_count: number;
  active_agent_count: number;
  invited_agent_count: number;
  manager_count: number;
  admin_count: number;
  active_category_count: number;
  panel_user_count: number;
  avg_resolution_days: string | null;
};

/** Rotas de prefeituras do backoffice: lista (P1), detalhe (P3) e mudança de status. */
/** Detalhe da prefeitura (P3); `null` quando ela não existe. */
async function loadTenantDetail(tx: Transaction, tenantId: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return null;
  const [stats] = (
    await tx.execute<DetailRow>(sql`select * from platform_tenant_detail(${tenantId})`)
  ).rows;
  // Contrato vigente: o de `starts_on` mais recente.
  const [contract] = await tx
    .select()
    .from(tenantContracts)
    .where(eq(tenantContracts.tenantId, tenantId))
    .orderBy(desc(tenantContracts.startsOn), desc(tenantContracts.createdAt))
    .limit(1);
  const actions = await tx
    .select({
      action: staffAuditEvents.action,
      staffName: users.name,
      at: staffAuditEvents.createdAt,
    })
    .from(staffAuditEvents)
    .innerJoin(users, eq(users.id, staffAuditEvents.staffUserId))
    .where(eq(staffAuditEvents.tenantId, tenantId))
    .orderBy(desc(staffAuditEvents.createdAt))
    .limit(5);
  const detail = stats!;
  return {
    id: tenant.id,
    displayName: tenant.displayName,
    state: tenant.state,
    ibgeCode: tenant.ibgeCode,
    status: tenant.status,
    centralPhone: tenant.centralPhone,
    contract: contract
      ? {
          plan: contract.plan as Plan,
          includedPanelUsers: contract.includedPanelUsers,
          startsOn: contract.startsOn,
          endsOn: contract.endsOn,
        }
      : null,
    stats: {
      citizenCount: detail.citizen_count,
      openCount: detail.open_count,
      staleTriageCount: detail.stale_triage_count,
      awaitingReviewCount: detail.awaiting_review_count,
      lateReviewCount: detail.late_review_count,
      avgResolutionDays: num(detail.avg_resolution_days),
      teamCount: detail.team_count,
      activeAgentCount: detail.active_agent_count,
      invitedAgentCount: detail.invited_agent_count,
      managerCount: detail.manager_count,
      adminCount: detail.admin_count,
      activeCategoryCount: detail.active_category_count,
      panelUserCount: detail.panel_user_count,
    },
    recentStaffActions: actions.map((a) => ({
      action: a.action,
      staffName: a.staffName,
      at: a.at.toISOString(),
    })),
  };
}

export function registerTenantRoutes(
  instance: FastifyInstance,
  { db, preHandler }: { db: Database; preHandler: preHandlerHookHandler },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/backoffice/tenants',
    { preHandler, schema: { response: { 200: tenantListResponseSchema, ...staffErrors } } },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const { overview, summaries, tenantRows, contracts } = await withContext(
        db,
        staff,
        async (tx) => ({
          overview: (await tx.execute<OverviewRow>(sql`select * from platform_overview()`))
            .rows[0]!,
          summaries: (await tx.execute<SummaryRow>(sql`select * from platform_tenant_summaries()`))
            .rows,
          tenantRows: await tx
            .select({
              id: tenants.id,
              displayName: tenants.displayName,
              state: tenants.state,
              status: tenants.status,
            })
            .from(tenants),
          contracts: await tx
            .select({
              tenantId: tenantContracts.tenantId,
              plan: tenantContracts.plan,
              startsOn: tenantContracts.startsOn,
            })
            .from(tenantContracts)
            .orderBy(desc(tenantContracts.startsOn), desc(tenantContracts.createdAt)),
        }),
      );

      // Contrato mais recente: a primeira linha de cada prefeitura, já em ordem decrescente.
      const planOf = new Map<string, Plan>();
      for (const contract of contracts) {
        if (!planOf.has(contract.tenantId)) planOf.set(contract.tenantId, contract.plan as Plan);
      }
      const summaryOf = new Map(summaries.map((s) => [s.tenant_id, s]));

      const items = tenantRows
        .toSorted(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.displayName.localeCompare(b.displayName, 'pt-BR'),
        )
        .map((tenant) => {
          const s = summaryOf.get(tenant.id);
          return {
            id: tenant.id,
            displayName: tenant.displayName,
            state: tenant.state,
            status: tenant.status,
            plan: planOf.get(tenant.id) ?? null,
            citizenCount: s?.citizen_count ?? 0,
            openCount: s?.open_count ?? 0,
            avgResolutionDays: num(s?.avg_resolution_days ?? null),
            lateReviewCount: s?.late_review_count ?? 0,
            staleImpedimentCount: s?.stale_impediment_count ?? 0,
            activeCategoryCount: s?.active_category_count ?? 0,
          };
        });

      return {
        overview: {
          activeTenants: overview.active_tenants,
          onboardingTenants: overview.onboarding_tenants,
          suspendedTenants: overview.suspended_tenants,
          citizens: overview.citizens,
          requestsThisMonth: overview.requests_this_month,
          requestsLastMonth: overview.requests_last_month,
          avgResolutionDays: num(overview.avg_resolution_days),
        },
        items,
      };
    },
  );

  app.get(
    '/backoffice/tenants/:id',
    {
      preHandler,
      schema: {
        params: tenantParamsSchema,
        response: { 200: tenantDetailSchema, ...staffErrors, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const detail = await withContext(db, { ...staff, tenantId }, (tx) =>
        loadTenantDetail(tx, tenantId),
      );
      if (!detail) return reply.code(404).send({ code: 'tenant_not_found' });
      return detail;
    },
  );

  app.put(
    '/backoffice/tenants/:id/contract',
    {
      preHandler,
      schema: {
        params: tenantParamsSchema,
        body: contractBodySchema,
        response: {
          200: tenantDetailSchema,
          ...staffErrors,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const body = request.body;
      if (body.includedPanelUsers <= 0 || (body.endsOn !== null && body.endsOn < body.startsOn)) {
        return reply.code(422).send({ code: 'invalid_contract' });
      }

      const detail = await withContext(db, { ...staff, tenantId }, async (tx) => {
        const updated = await tx
          .update(tenants)
          .set({ displayName: body.displayName, centralPhone: body.centralPhone })
          .where(eq(tenants.id, tenantId))
          .returning({ id: tenants.id });
        if (updated.length === 0) return null;
        const terms = {
          plan: body.plan,
          startsOn: body.startsOn,
          endsOn: body.endsOn,
          includedPanelUsers: body.includedPanelUsers,
        };
        // Contrato vigente: o de `starts_on` mais recente; sem nenhum, cria.
        const [current] = await tx
          .select({ id: tenantContracts.id })
          .from(tenantContracts)
          .where(eq(tenantContracts.tenantId, tenantId))
          .orderBy(desc(tenantContracts.startsOn), desc(tenantContracts.createdAt))
          .limit(1);
        if (current) {
          await tx.update(tenantContracts).set(terms).where(eq(tenantContracts.id, current.id));
        } else {
          await tx.insert(tenantContracts).values({ tenantId, ...terms });
        }
        // Na mesma transação: a mudança e a auditoria valem juntas ou nenhuma vale.
        await insertStaffAudit(
          tx,
          { ...staff, tenantId },
          { action: 'tenant.contract_update', targetType: 'tenant', targetId: tenantId },
        );
        return loadTenantDetail(tx, tenantId);
      });
      if (!detail) return reply.code(404).send({ code: 'tenant_not_found' });
      return detail;
    },
  );

  app.post(
    '/backoffice/tenants/:id/status',
    {
      preHandler,
      schema: {
        params: tenantParamsSchema,
        body: tenantStatusBodySchema,
        response: {
          200: z.object({ status: z.enum(['onboarding', 'active', 'suspended']) }),
          ...staffErrors,
          404: apiErrorSchema,
          409: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const staff = await requirePlatformStaff(db, request, reply, ['admin']);
      if (!staff) return reply;
      const tenantId = request.params.id;
      const transition = TRANSITIONS[request.body.action];

      const outcome = await withContext(db, { ...staff, tenantId }, async (tx) => {
        // Trava a linha: duas mudanças simultâneas não passam pela mesma checagem.
        const [tenant] = await tx
          .select({ status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .for('update');
        if (!tenant) return 'not_found' as const;
        if (tenant.status !== transition.from) return 'conflict' as const;
        if (request.body.action === 'activate') {
          const [category] = await tx
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.tenantId, tenantId), eq(categories.active, true)))
            .limit(1);
          const [team] = await tx
            .select({ id: teams.id })
            .from(teams)
            .where(eq(teams.tenantId, tenantId))
            .limit(1);
          if (!category || !team) return 'not_ready' as const;
        }
        await tx.update(tenants).set({ status: transition.to }).where(eq(tenants.id, tenantId));
        // Na mesma transação: a mudança e a auditoria valem juntas ou nenhuma vale.
        await insertStaffAudit(
          tx,
          { ...staff, tenantId },
          { action: transition.audit, targetType: 'tenant', targetId: tenantId },
        );
        return 'ok' as const;
      });

      if (outcome === 'not_found') return reply.code(404).send({ code: 'tenant_not_found' });
      if (outcome === 'conflict') return reply.code(409).send({ code: 'tenant_status_conflict' });
      if (outcome === 'not_ready') return reply.code(422).send({ code: 'tenant_not_ready' });
      return { status: transition.to };
    },
  );
}
