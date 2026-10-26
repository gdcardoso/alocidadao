import { z } from 'zod';
import { ICON_GROUPS } from './enums.js';
import { geoPointSchema } from './geo.js';
import { REQUEST_STATUSES, requestStatusSchema, type RequestStatus } from './request-status.js';

const iconGroupSchema = z.enum(ICON_GROUPS);

/** Categoria disponível para o cidadão escolher. */
export const categoryOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
});
export type CategoryOption = z.infer<typeof categoryOptionSchema>;

export const locateQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type LocateQuery = z.infer<typeof locateQuerySchema>;

export const locateResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('served'),
    tenant: z.object({
      id: z.uuid(),
      displayName: z.string(),
      city: z.string(),
      state: z.string(),
      centralPhone: z.string().nullable(),
    }),
    categories: z.array(categoryOptionSchema),
  }),
  z.object({
    status: z.literal('not_served'),
    municipality: z
      .object({ ibgeCode: z.string(), name: z.string(), state: z.string() })
      .nullable(),
  }),
]);
export type LocateResponse = z.infer<typeof locateResponseSchema>;

export const similarQuerySchema = locateQuerySchema.extend({ categoryId: z.uuid() });
export type SimilarQuery = z.infer<typeof similarQuerySchema>;

/** Ocorrência próxima, da mesma categoria, que o cidadão pode apoiar. */
export const similarOccurrenceSchema = z.object({
  occurrenceId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  distanceM: z.number().int(),
  reportCount: z.number().int(),
  status: z.enum(['triage', 'in_progress']),
});
export type SimilarOccurrence = z.infer<typeof similarOccurrenceSchema>;

export const createRequestResponseSchema = z.object({
  requestId: z.uuid(),
  protocol: z.string(),
  status: requestStatusSchema,
  duplicate: z.boolean(),
});
export type CreateRequestResponse = z.infer<typeof createRequestResponseSchema>;

export const REQUEST_LIST_FILTERS = ['all', 'active', 'done'] as const;
export const requestListFilterSchema = z.enum(REQUEST_LIST_FILTERS);
export type RequestListFilter = z.infer<typeof requestListFilterSchema>;

const ACTIVE_STATUSES: readonly RequestStatus[] = ['open', 'in_progress', 'awaiting_confirmation'];
const DONE_STATUSES: readonly RequestStatus[] = ['completed', 'cancelled', 'rejected'];

/** Status que cada filtro da lista do cidadão inclui. */
export function requestFilterStatuses(filter: RequestListFilter): readonly RequestStatus[] {
  if (filter === 'active') return ACTIVE_STATUSES;
  if (filter === 'done') return DONE_STATUSES;
  return REQUEST_STATUSES;
}

export const requestCardSchema = z.object({
  id: z.uuid(),
  protocol: z.string(),
  status: requestStatusSchema,
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  createdAt: z.iso.datetime(),
  statusChangedAt: z.iso.datetime(),
});
export type RequestCard = z.infer<typeof requestCardSchema>;

export const photoViewSchema = z.object({
  url: z.string(),
  takenAt: z.iso.datetime(),
  /** Para o app legendar a foto da contestação. */
  purpose: z.enum(['report', 'contest', 'completion']),
});
export type PhotoView = z.infer<typeof photoViewSchema>;

export const requestDetailSchema = z.object({
  id: z.uuid(),
  protocol: z.string(),
  status: requestStatusSchema,
  statusChangedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  description: z.string(),
  location: geoPointSchema,
  photos: z.array(photoViewSchema),
  team: z.object({ name: z.string() }).nullable(),
  completion: z
    .object({
      publicNote: z.string().nullable(),
      publishedAt: z.iso.datetime(),
      photos: z.array(photoViewSchema),
    })
    .nullable(),
  rejection: z.object({ reason: z.string().nullable(), at: z.iso.datetime() }).nullable(),
  timeline: z.array(z.object({ status: requestStatusSchema, at: z.iso.datetime() })),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;

/** Corpo de cancelar e confirmar. */
export const requestActionBodySchema = z.object({ clientActionId: z.uuid() });
export type RequestActionBody = z.infer<typeof requestActionBodySchema>;

export const contestBodySchema = z.object({
  clientActionId: z.uuid(),
  comment: z.string().trim().min(3).max(1000),
  photoKeys: z.array(z.string().min(1)).max(3),
});
export type ContestBody = z.infer<typeof contestBodySchema>;

export const cityInterestBodySchema = z.object({ ibgeCode: z.string().regex(/^[0-9]{7}$/) });
export type CityInterestBody = z.infer<typeof cityInterestBodySchema>;

export const uploadResponseSchema = z.object({
  key: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
