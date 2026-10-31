import { z } from 'zod';
import { ICON_GROUPS } from './enums.js';
import { geoPointSchema } from './geo.js';
import { occurrenceStatusSchema, type OccurrenceStatus } from './occurrence-status.js';
import { workOrderStatusSchema } from './work-order-status.js';

export const PANEL_ROLES = ['manager', 'tenant_admin'] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

export const PANEL_OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  triage: 'Aberta',
  in_progress: 'Em atendimento',
  awaiting_confirmation: 'Aguardando confirmação',
  completed: 'Concluída',
  rejected: 'Recusada',
  merged: 'Juntada',
  cancelled: 'Cancelada',
};

/** Horas em triagem a partir das quais o "Aberta há" fica em destaque. */
export const TRIAGE_LATE_HOURS = 72;
export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 500;
export const MANAGER_INSTRUCTIONS_MAX = 1000;
export const PANEL_SEARCH_LIMIT = 10;
export const TRIAGE_LIMIT = 200;
export const MAX_SUGGESTIONS = 3;

const iconGroupSchema = z.enum(ICON_GROUPS);

export const panelContextSchema = z.object({
  tenant: z.object({
    id: z.uuid(),
    displayName: z.string(),
    status: z.enum(['onboarding', 'active']),
    /** `[oeste, sul, leste, norte]` ou `null` quando a prefeitura não tem limite. */
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  }),
  user: z.object({ id: z.uuid(), name: z.string() }),
  role: z.enum(PANEL_ROLES),
  departments: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type PanelContext = z.infer<typeof panelContextSchema>;

export const panelCountsSchema = z.object({
  triage: z.number().int(),
  awaitingReview: z.number().int(),
  impeded: z.number().int(),
});
export type PanelCounts = z.infer<typeof panelCountsSchema>;

export const MAP_STATUS_FILTERS = ['open_and_in_progress', 'open', 'in_progress'] as const;
export const mapStatusFilterSchema = z.enum(MAP_STATUS_FILTERS);
export type MapStatusFilter = z.infer<typeof mapStatusFilterSchema>;

export const MAP_PERIODS = [7, 30, 90, null] as const;
export type MapPeriod = (typeof MAP_PERIODS)[number];

/** Na query string o período vem como texto: `'7' | '30' | '90' | 'all'`. */
export const mapDaysSchema = z.preprocess(
  (value) => {
    if (value === undefined) return 30;
    if (value === 'all') return null;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return value;
  },
  z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]),
);

/** Valor do filtro de bairro para as ocorrências sem bairro (`neighborhood IS NULL`). */
export const NO_NEIGHBORHOOD = '__none__';

export const neighborhoodFilterSchema = z.string().min(1).max(120).optional();

/** Bairros efetivos da prefeitura (camada própria ou malha do IBGE), em ordem pt-BR. */
export const neighborhoodsResponseSchema = z.object({
  items: z.array(z.string()),
  source: z.enum(['ibge', 'tenant']).nullable(),
});
export type NeighborhoodsResponse = z.infer<typeof neighborhoodsResponseSchema>;

export const occurrenceMapQuerySchema = z.object({
  status: mapStatusFilterSchema.default('open_and_in_progress'),
  categoryId: z.uuid().optional(),
  neighborhood: neighborhoodFilterSchema,
  days: mapDaysSchema,
});
export type OccurrenceMapQuery = z.infer<typeof occurrenceMapQuerySchema>;

export const occurrencePointSchema = z.object({
  id: z.uuid(),
  location: geoPointSchema,
  categoryId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  status: occurrenceStatusSchema,
  requestCount: z.number().int(),
  statusSince: z.iso.datetime(),
});
export type OccurrencePoint = z.infer<typeof occurrencePointSchema>;

export const occurrenceMapResponseSchema = z.object({
  total: z.number().int(),
  items: z.array(occurrencePointSchema),
});
export type OccurrenceMapResponse = z.infer<typeof occurrenceMapResponseSchema>;

export const panelSearchResultSchema = z.object({
  occurrenceId: z.uuid(),
  protocol: z.string(),
  categoryName: z.string(),
  address: z.string().nullable(),
  location: geoPointSchema,
  status: occurrenceStatusSchema,
});
export type PanelSearchResult = z.infer<typeof panelSearchResultSchema>;

export const panelSearchResponseSchema = z.object({ items: z.array(panelSearchResultSchema) });
export type PanelSearchResponse = z.infer<typeof panelSearchResponseSchema>;

export const occurrenceDetailSchema = z.object({
  id: z.uuid(),
  status: occurrenceStatusSchema,
  statusSince: z.iso.datetime(),
  category: z.object({
    id: z.uuid(),
    name: z.string(),
    icon: z.string().nullable(),
    iconGroup: iconGroupSchema,
    clusterRadiusM: z.number(),
    defaultDeadlineDays: z.number().int(),
    departmentId: z.uuid(),
    departmentName: z.string(),
  }),
  address: z.string().nullable(),
  location: geoPointSchema,
  requestCount: z.number().int(),
  requests: z.array(
    z.object({
      id: z.uuid(),
      protocol: z.string(),
      description: z.string().nullable(),
      createdAt: z.iso.datetime(),
      distanceM: z.number(),
      photoUrl: z.string().nullable(),
    }),
  ),
  suggestions: z.array(
    z.object({
      occurrenceId: z.uuid(),
      protocol: z.string(),
      categoryName: z.string(),
      description: z.string().nullable(),
      distanceM: z.number(),
      requestCount: z.number().int(),
    }),
  ),
  activeWorkOrder: z
    .object({ id: z.uuid(), status: workOrderStatusSchema, teamName: z.string() })
    .nullable(),
});
export type OccurrenceDetail = z.infer<typeof occurrenceDetailSchema>;

export const teamOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  activeAgentCount: z.number().int(),
  openWorkOrderCount: z.number().int(),
  baseDistanceM: z.number().nullable(),
});
export type TeamOption = z.infer<typeof teamOptionSchema>;

export const teamOptionsResponseSchema = z.object({
  suggestedTeamId: z.uuid().nullable(),
  defaultDueDate: z.iso.date(),
  departmentName: z.string(),
  items: z.array(teamOptionSchema),
});
export type TeamOptionsResponse = z.infer<typeof teamOptionsResponseSchema>;

export const assignBodySchema = z.object({
  teamId: z.uuid(),
  dueDate: z.iso.date(),
  instructions: z
    .string()
    .trim()
    .max(MANAGER_INSTRUCTIONS_MAX)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value)),
});
export type AssignBody = z.infer<typeof assignBodySchema>;

export const rejectBodySchema = z.object({
  reason: z.string().trim().min(REJECT_REASON_MIN).max(REJECT_REASON_MAX),
});
export type RejectBody = z.infer<typeof rejectBodySchema>;

export const mergeBodySchema = z.object({ otherOccurrenceId: z.uuid() });
export type MergeBody = z.infer<typeof mergeBodySchema>;
export const dismissSuggestionBodySchema = mergeBodySchema;
export type DismissSuggestionBody = MergeBody;

export const splitBodySchema = z.object({ requestIds: z.array(z.uuid()).min(1) });
export type SplitBody = z.infer<typeof splitBodySchema>;

export const assignResponseSchema = z.object({ occurrenceId: z.uuid(), workOrderId: z.uuid() });
export type AssignResponse = z.infer<typeof assignResponseSchema>;
export const mergeResponseSchema = z.object({ survivorId: z.uuid() });
export type MergeResponse = z.infer<typeof mergeResponseSchema>;
export const splitResponseSchema = z.object({ newOccurrenceId: z.uuid() });
export type SplitResponse = z.infer<typeof splitResponseSchema>;

export const triageRowSchema = z.object({
  occurrenceId: z.uuid(),
  protocol: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  departmentName: z.string(),
  requestCount: z.number().int(),
  suggestionCount: z.number().int(),
  statusSince: z.iso.datetime(),
});
export type TriageRow = z.infer<typeof triageRowSchema>;

/** Na query string o booleano vem como texto: `'true' | 'false'`. */
const queryBooleanSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

export const triageQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  onlySuggestions: queryBooleanSchema.default(false),
});
export type TriageQuery = z.infer<typeof triageQuerySchema>;

export const triageResponseSchema = z.object({
  total: z.number().int(),
  items: z.array(triageRowSchema),
});
export type TriageResponse = z.infer<typeof triageResponseSchema>;

/** Tamanho e cor do pino do mapa pela soma de relatos. */
export function pinStyleFor(reportCount: number): {
  size: number;
  tone: 'primary' | 'warning' | 'danger';
} {
  if (reportCount <= 1) return { size: 32, tone: 'primary' };
  if (reportCount === 2) return { size: 36, tone: 'primary' };
  if (reportCount === 3) return { size: 40, tone: 'primary' };
  if (reportCount === 4) return { size: 42, tone: 'primary' };
  if (reportCount <= 7) return { size: 48, tone: 'warning' };
  if (reportCount <= 10) return { size: 50, tone: 'warning' };
  if (reportCount <= 15) return { size: 54, tone: 'warning' };
  return { size: 64, tone: 'danger' };
}

/** A triagem está atrasada quando o status dura `TRIAGE_LATE_HOURS` ou mais. */
export function isTriageLate(statusSince: Date, now: Date): boolean {
  return now.getTime() - statusSince.getTime() >= TRIAGE_LATE_HOURS * 3_600_000;
}
