import { z } from 'zod';
import { cpfSchema } from './cpf.js';
import { TENANT_STATUSES, type IconGroup, type TenantStatus } from './enums.js';
import { PLATFORM_ROLES, type PlatformRole } from './roles.js';

// Backoffice da equipe interna (Plano 6a): contratos de prefeituras, contrato e auditoria.

export const INCLUDED_USERS_MAX = 10000;

export const PLANS = ['essential', 'complete'] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  essential: 'Essencial',
  complete: 'Completo',
};

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  onboarding: 'Em implantação',
  active: 'Ativa',
  suspended: 'Suspensa',
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  admin: 'Admin',
  support: 'Suporte',
};

/** Ações gravadas em `staff_audit_events`. */
export const STAFF_AUDIT_ACTIONS = [
  'support.enter',
  'support.leave',
  'tenant.create',
  'tenant.activate',
  'tenant.suspend',
  'tenant.reactivate',
  'occurrence.assign',
  'occurrence.reject',
  'occurrence.merge',
  'occurrence.dismiss_suggestion',
  'occurrence.split',
  'work_order.publish',
  'work_order.rework',
  'work_order.reassign',
  'work_order.reschedule',
  'team.create',
  'team.update',
  'agent.create',
  'agent.update',
  'manager.create',
  'manager.update',
  'category.create',
  'category.update',
  'department.create',
  'department.update',
] as const;
export type StaffAuditAction = (typeof STAFF_AUDIT_ACTIONS)[number];

export const STAFF_AUDIT_ACTION_LABELS: Record<StaffAuditAction, string> = {
  'support.enter': 'Entrou no painel (suporte)',
  'support.leave': 'Saiu do painel',
  'tenant.create': 'Criou a prefeitura',
  'tenant.activate': 'Ativou a prefeitura',
  'tenant.suspend': 'Suspendeu a prefeitura',
  'tenant.reactivate': 'Reativou a prefeitura',
  'occurrence.assign': 'Atribuiu uma ocorrência',
  'occurrence.reject': 'Recusou uma ocorrência',
  'occurrence.merge': 'Juntou ocorrências',
  'occurrence.dismiss_suggestion': 'Descartou uma sugestão de junção',
  'occurrence.split': 'Separou relatos',
  'work_order.publish': 'Publicou um atendimento',
  'work_order.rework': 'Devolveu um atendimento ao agente',
  'work_order.reassign': 'Reatribuiu uma atividade',
  'work_order.reschedule': 'Reagendou uma atividade',
  'team.create': 'Criou uma equipe',
  'team.update': 'Editou uma equipe',
  'agent.create': 'Adicionou um agente',
  'agent.update': 'Alterou um agente',
  'manager.create': 'Cadastrou um gestor',
  'manager.update': 'Alterou um gestor',
  'category.create': 'Criou uma categoria',
  'category.update': 'Alterou uma categoria',
  'department.create': 'Criou um setor',
  'department.update': 'Alterou um setor',
};

/** Catálogo copiado para a prefeitura nova (os raios são os do seed de desenvolvimento). */
export const DEFAULT_CATALOG: readonly {
  name: string;
  icon: string;
  iconGroup: IconGroup;
  clusterRadiusM: number;
  defaultDeadlineDays: number;
  department: 'Obras' | 'Meio ambiente' | 'Serviços';
}[] = [
  {
    name: 'Buraco na via',
    icon: 'construction',
    iconGroup: 'infrastructure',
    clusterRadiusM: 15,
    defaultDeadlineDays: 7,
    department: 'Obras',
  },
  {
    name: 'Iluminação',
    icon: 'lightbulb',
    iconGroup: 'infrastructure',
    clusterRadiusM: 25,
    defaultDeadlineDays: 7,
    department: 'Obras',
  },
  {
    name: 'Calçada',
    icon: 'footprints',
    iconGroup: 'infrastructure',
    clusterRadiusM: 20,
    defaultDeadlineDays: 7,
    department: 'Obras',
  },
  {
    name: 'Sinalização',
    icon: 'signpost',
    iconGroup: 'infrastructure',
    clusterRadiusM: 50,
    defaultDeadlineDays: 7,
    department: 'Obras',
  },
  {
    name: 'Lixo e entulho',
    icon: 'trash-2',
    iconGroup: 'environment',
    clusterRadiusM: 30,
    defaultDeadlineDays: 7,
    department: 'Meio ambiente',
  },
  {
    name: 'Poda de árvore',
    icon: 'trees',
    iconGroup: 'environment',
    clusterRadiusM: 20,
    defaultDeadlineDays: 7,
    department: 'Meio ambiente',
  },
  {
    name: 'Esgoto',
    icon: 'droplets',
    iconGroup: 'environment',
    clusterRadiusM: 20,
    defaultDeadlineDays: 7,
    department: 'Meio ambiente',
  },
  {
    name: 'Animal',
    icon: 'paw-print',
    iconGroup: 'public_services',
    clusterRadiusM: 50,
    defaultDeadlineDays: 7,
    department: 'Serviços',
  },
  {
    name: 'Outro',
    icon: 'circle-ellipsis',
    iconGroup: 'public_services',
    clusterRadiusM: 20,
    defaultDeadlineDays: 7,
    department: 'Serviços',
  },
];

/** Variação percentual arredondada; `null` sem base de comparação. */
export function formatChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const planSchema = z.enum(PLANS);
const tenantStatusSchema = z.enum(TENANT_STATUSES);
const platformRoleSchema = z.enum(PLATFORM_ROLES);
const count = z.number().int();
const avgDays = z.number().nullable();

// Leitura

export const backofficeContextSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string() }),
  platformRole: platformRoleSchema,
});
export type BackofficeContext = z.infer<typeof backofficeContextSchema>;

export const platformOverviewSchema = z.object({
  activeTenants: count,
  onboardingTenants: count,
  suspendedTenants: count,
  citizens: count,
  requestsThisMonth: count,
  requestsLastMonth: count,
  avgResolutionDays: avgDays,
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

export const tenantSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  state: z.string(),
  status: tenantStatusSchema,
  plan: planSchema.nullable(),
  citizenCount: count,
  openCount: count,
  avgResolutionDays: avgDays,
  lateReviewCount: count,
  staleImpedimentCount: count,
  activeCategoryCount: count,
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const tenantListResponseSchema = z.object({
  overview: platformOverviewSchema,
  items: z.array(tenantSummarySchema),
});
export type TenantListResponse = z.infer<typeof tenantListResponseSchema>;

export const municipalityOptionSchema = z.object({
  ibgeCode: z.string(),
  name: z.string(),
  state: z.string(),
  taken: z.boolean(),
});
export type MunicipalityOption = z.infer<typeof municipalityOptionSchema>;

export const municipalitySearchResponseSchema = z.object({
  items: z.array(municipalityOptionSchema),
});
export type MunicipalitySearchResponse = z.infer<typeof municipalitySearchResponseSchema>;

// Criar prefeitura

export const tenantCreateBodySchema = z
  .object({
    ibgeCode: z.string().regex(/^\d{7}$/),
    displayName: z.string().trim().min(2).max(120),
    centralPhone: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .transform((value) => (value ? value : null)),
    admin: z.object({
      name: z.string().trim().min(2).max(80),
      cpf: cpfSchema,
      email: z.email().transform((value) => value.toLowerCase()),
    }),
    contract: z.object({
      plan: planSchema,
      includedPanelUsers: z.number().int().min(1).max(INCLUDED_USERS_MAX),
      startsOn: z.iso.date(),
      endsOn: z.iso.date().nullable(),
    }),
    copyDefaultCatalog: z.boolean(),
  })
  .refine(({ contract }) => contract.endsOn === null || contract.endsOn >= contract.startsOn, {
    message: 'O fim da vigência não pode ser antes do início.',
    path: ['contract', 'endsOn'],
  });
export type TenantCreateBody = z.infer<typeof tenantCreateBodySchema>;

export const tenantCreateResponseSchema = z.object({ id: z.uuid() });
export type TenantCreateResponse = z.infer<typeof tenantCreateResponseSchema>;

// Detalhe

export const tenantDetailSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  state: z.string(),
  ibgeCode: z.string(),
  status: tenantStatusSchema,
  centralPhone: z.string().nullable(),
  contract: z
    .object({
      plan: planSchema,
      includedPanelUsers: count,
      startsOn: z.string(),
      endsOn: z.string().nullable(),
    })
    .nullable(),
  stats: z.object({
    citizenCount: count,
    openCount: count,
    staleTriageCount: count,
    awaitingReviewCount: count,
    lateReviewCount: count,
    avgResolutionDays: avgDays,
    teamCount: count,
    activeAgentCount: count,
    invitedAgentCount: count,
    managerCount: count,
    adminCount: count,
    activeCategoryCount: count,
    panelUserCount: count,
  }),
  recentStaffActions: z.array(
    z.object({ action: z.string(), staffName: z.string(), at: z.iso.datetime() }),
  ),
});
export type TenantDetail = z.infer<typeof tenantDetailSchema>;

export const tenantStatusBodySchema = z.object({
  action: z.enum(['activate', 'suspend', 'reactivate']),
});
export type TenantStatusBody = z.infer<typeof tenantStatusBodySchema>;
