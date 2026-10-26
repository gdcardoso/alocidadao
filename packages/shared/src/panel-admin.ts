import { z } from 'zod';
import { phoneSchema } from './auth.js';
import { cpfSchema } from './cpf.js';
import { ICON_GROUPS, MEMBERSHIP_STATUSES, type IconGroup } from './enums.js';
import { geoPointSchema } from './geo.js';
import { PANEL_ROLES } from './panel.js';

export const NAME_MIN = 2;
export const TEAM_NAME_MAX = 80;
export const PERSON_NAME_MAX = 80;
export const CATEGORY_NAME_MAX = 60;
export const DEPARTMENT_NAME_MAX = 60;
export const BASE_ADDRESS_MAX = 200;
export const DEADLINE_DAYS_MAX = 365;
/** Limite do banco para o raio de agrupamento. */
export const CLUSTER_RADIUS_MAX_M = 500;

/** Os ícones do seed, com o nome em português para o select. */
export const CATEGORY_ICON_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'construction', label: 'Obra' },
  { key: 'lightbulb', label: 'Lâmpada' },
  { key: 'trash-2', label: 'Lixo' },
  { key: 'trees', label: 'Árvore' },
  { key: 'droplets', label: 'Água' },
  { key: 'footprints', label: 'Calçada' },
  { key: 'signpost', label: 'Placa' },
  { key: 'paw-print', label: 'Animal' },
  { key: 'circle-ellipsis', label: 'Outro' },
];

export const ICON_GROUP_LABELS: Record<IconGroup, string> = {
  infrastructure: 'Azul · infraestrutura',
  environment: 'Verde · meio ambiente',
  public_services: 'Amarelo · serviços públicos',
};

const iconGroupSchema = z.enum(ICON_GROUPS);
const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
const panelRoleSchema = z.enum(PANEL_ROLES);

const nameSchema = (max: number) => z.string().trim().min(NAME_MIN).max(max);

// Equipes

export const teamSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  baseAddress: z.string().nullable(),
  baseLocation: geoPointSchema.nullable(),
  agentCount: z.number().int(),
  activeAgentCount: z.number().int(),
  openWorkOrderCount: z.number().int(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamsResponseSchema = z.object({ items: z.array(teamSummarySchema) });
export type TeamsResponse = z.infer<typeof teamsResponseSchema>;

export const teamCreateBodySchema = z.object({
  name: nameSchema(TEAM_NAME_MAX),
  departmentId: z.uuid(),
  baseAddress: z
    .string()
    .trim()
    .max(BASE_ADDRESS_MAX)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value)),
  baseLocation: geoPointSchema.nullable(),
});
export type TeamCreateBody = z.infer<typeof teamCreateBodySchema>;

export const teamUpdateBodySchema = teamCreateBodySchema.omit({ departmentId: true });
export type TeamUpdateBody = z.infer<typeof teamUpdateBodySchema>;

// Agentes

export const agentRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  status: membershipStatusSchema,
  lastActiveAt: z.iso.datetime().nullable(),
});
export type AgentRow = z.infer<typeof agentRowSchema>;

export const agentsResponseSchema = z.object({ items: z.array(agentRowSchema) });
export type AgentsResponse = z.infer<typeof agentsResponseSchema>;

export const agentCreateBodySchema = z.object({
  name: nameSchema(PERSON_NAME_MAX),
  phone: phoneSchema,
});
export type AgentCreateBody = z.infer<typeof agentCreateBodySchema>;

export const agentUpdateBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('change_phone'), phone: phoneSchema }),
  z.object({ action: z.literal('move'), teamId: z.uuid() }),
  z.object({ action: z.literal('deactivate') }),
  z.object({ action: z.literal('reactivate') }),
]);
export type AgentUpdateBody = z.infer<typeof agentUpdateBodySchema>;

// Gestores

export const managerRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  /** 11 dígitos; a tela mascara com `maskCpf`. */
  cpf: z.string().nullable(),
  email: z.string().nullable(),
  role: panelRoleSchema,
  status: membershipStatusSchema,
  departments: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type ManagerRow = z.infer<typeof managerRowSchema>;

export const managersResponseSchema = z.object({ items: z.array(managerRowSchema) });
export type ManagersResponse = z.infer<typeof managersResponseSchema>;

const managerEmailSchema = z.email().transform((value) => value.toLowerCase());
const departmentIdsSchema = z.array(z.uuid()).min(1);

export const managerCreateBodySchema = z.object({
  name: nameSchema(PERSON_NAME_MAX),
  cpf: cpfSchema,
  email: managerEmailSchema,
  departmentIds: departmentIdsSchema,
});
export type ManagerCreateBody = z.infer<typeof managerCreateBodySchema>;

export const managerUpdateBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    email: managerEmailSchema,
    departmentIds: departmentIdsSchema,
  }),
  z.object({ action: z.literal('deactivate') }),
  z.object({ action: z.literal('reactivate') }),
]);
export type ManagerUpdateBody = z.infer<typeof managerUpdateBodySchema>;

// Categorias

export const categoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  departmentId: z.uuid(),
  departmentName: z.string(),
  defaultDeadlineDays: z.number().int(),
  clusterRadiusM: z.number(),
  active: z.boolean(),
});
export type CategoryRow = z.infer<typeof categoryRowSchema>;

export const categoriesResponseSchema = z.object({ items: z.array(categoryRowSchema) });
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

const ICON_KEYS = CATEGORY_ICON_OPTIONS.map((option) => option.key);

export const categoryCreateBodySchema = z.object({
  name: nameSchema(CATEGORY_NAME_MAX),
  icon: z.string().refine((key) => ICON_KEYS.includes(key), { message: 'Ícone não permitido' }),
  iconGroup: iconGroupSchema,
  departmentId: z.uuid(),
  defaultDeadlineDays: z.number().int().min(1).max(DEADLINE_DAYS_MAX),
  clusterRadiusM: z.number().min(1).max(CLUSTER_RADIUS_MAX_M),
  active: z.boolean(),
});
export type CategoryCreateBody = z.infer<typeof categoryCreateBodySchema>;

export const categoryUpdateBodySchema = categoryCreateBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Informe ao menos um campo' });
export type CategoryUpdateBody = z.infer<typeof categoryUpdateBodySchema>;

// Setores

export const departmentRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  categoryCount: z.number().int(),
  teamCount: z.number().int(),
  managerCount: z.number().int(),
});
export type DepartmentRow = z.infer<typeof departmentRowSchema>;

export const departmentsResponseSchema = z.object({ items: z.array(departmentRowSchema) });
export type DepartmentsResponse = z.infer<typeof departmentsResponseSchema>;

export const departmentBodySchema = z.object({ name: nameSchema(DEPARTMENT_NAME_MAX) });
export type DepartmentBody = z.infer<typeof departmentBodySchema>;
