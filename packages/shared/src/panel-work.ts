import { z } from 'zod';
import { impedimentReasonSchema, reworkReasonSchema, type ReworkReason } from './agent.js';
import { ICON_GROUPS } from './enums.js';
import { requestStatusSchema } from './request-status.js';
import { assignBodySchema, mapDaysSchema } from './panel.js';
import { ACTIVE_WORK_ORDER_STATUSES, workOrderStatusSchema } from './work-order-status.js';

/** Itens da fila de revisão e de impedimentos. */
export const QUEUE_LIMIT = 200;
/** Horas na fila de revisão a partir das quais a espera fica em destaque. */
export const REVIEW_LATE_HOURS = 24;
export const PUBLIC_NOTE_MIN = 10;
export const PUBLIC_NOTE_MAX = 1000;
export const REWORK_MESSAGE_MIN = 3;
export const REWORK_MESSAGE_MAX = 1000;
export const REQUESTS_PAGE_SIZE = 50;
export const IN_PROGRESS_LIMIT = 200;

export const REWORK_REASON_LABELS: Record<ReworkReason, string> = {
  new_photos: 'Tirar novas fotos',
  new_note: 'Corrigir o relato',
  return_to_site: 'Voltar ao local: serviço incompleto',
};

const iconGroupSchema = z.enum(ICON_GROUPS);

export const workQueueItemSchema = z.object({
  workOrderId: z.uuid(),
  occurrenceId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  departmentName: z.string(),
  teamName: z.string(),
  statusSince: z.iso.datetime(),
  impedimentReason: impedimentReasonSchema.nullable(),
});
export type WorkQueueItem = z.infer<typeof workQueueItemSchema>;

export const workQueueResponseSchema = z.object({
  total: z.number().int(),
  items: z.array(workQueueItemSchema),
});
export type WorkQueueResponse = z.infer<typeof workQueueResponseSchema>;

/** Cabeçalho comum do detalhe de revisão e de impedimento. */
export const workOrderHeaderSchema = z.object({
  workOrderId: z.uuid(),
  occurrenceId: z.uuid(),
  status: workOrderStatusSchema,
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  categoryId: z.uuid(),
  departmentName: z.string(),
  defaultDeadlineDays: z.number().int(),
  address: z.string().nullable(),
  teamId: z.uuid(),
  teamName: z.string(),
  agentName: z.string().nullable(),
  eventAt: z.iso.datetime(),
  distanceM: z.number().nullable(),
  activeRequestCount: z.number().int(),
  managerInstructions: z.string().nullable(),
});
export type WorkOrderHeader = z.infer<typeof workOrderHeaderSchema>;

export const reviewDetailSchema = workOrderHeaderSchema.extend({
  agentNote: z.string().nullable(),
  pendingPhotos: z.array(z.object({ id: z.uuid(), url: z.string() })),
  citizenPhotos: z.array(z.object({ url: z.string() })),
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;

export const impedimentDetailSchema = workOrderHeaderSchema.extend({
  reason: impedimentReasonSchema.nullable(),
  note: z.string().nullable(),
  photoUrl: z.string().nullable(),
});
export type ImpedimentDetail = z.infer<typeof impedimentDetailSchema>;

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const publishBodySchema = z.object({
  publicNote: z.string().trim().min(PUBLIC_NOTE_MIN).max(PUBLIC_NOTE_MAX),
  publishedPhotoIds: z.array(z.uuid()).refine(uniqueIds, { message: 'Fotos repetidas' }),
});
export type PublishBody = z.infer<typeof publishBodySchema>;

export const reworkBodySchema = z.object({
  reasons: z
    .array(reworkReasonSchema)
    .min(1)
    .refine((reasons) => new Set(reasons).size === reasons.length, {
      message: 'Motivos repetidos',
    }),
  discardedPhotoIds: z.array(z.uuid()).refine(uniqueIds, { message: 'Fotos repetidas' }),
  message: z.string().trim().min(REWORK_MESSAGE_MIN).max(REWORK_MESSAGE_MAX),
});
export type ReworkBody = z.infer<typeof reworkBodySchema>;

export const reassignBodySchema = assignBodySchema;
export type ReassignBody = z.infer<typeof reassignBodySchema>;

export const rescheduleBodySchema = z.object({ dueDate: z.iso.date() });
export type RescheduleBody = z.infer<typeof rescheduleBodySchema>;

export const workOrderResultSchema = z.object({
  workOrderId: z.uuid(),
  status: workOrderStatusSchema,
});
export type WorkOrderResult = z.infer<typeof workOrderResultSchema>;

export const inProgressRowSchema = z.object({
  occurrenceId: z.uuid(),
  protocol: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  teamName: z.string(),
  workOrderStatus: workOrderStatusSchema,
  dueAt: z.iso.datetime().nullable(),
  statusSince: z.iso.datetime(),
});
export type InProgressRow = z.infer<typeof inProgressRowSchema>;

export const inProgressQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  workOrderStatus: workOrderStatusSchema
    .refine((status) => ACTIVE_WORK_ORDER_STATUSES.includes(status), {
      message: 'Só atividades ativas',
    })
    .optional(),
});
export type InProgressQuery = z.infer<typeof inProgressQuerySchema>;

export const inProgressResponseSchema = z.object({
  total: z.number().int(),
  items: z.array(inProgressRowSchema),
});
export type InProgressResponse = z.infer<typeof inProgressResponseSchema>;

export const requestRowSchema = z.object({
  requestId: z.uuid(),
  occurrenceId: z.uuid(),
  protocol: z.string(),
  /** Para o filtro de categoria da lista. */
  categoryId: z.uuid(),
  categoryName: z.string(),
  icon: z.string().nullable(),
  iconGroup: iconGroupSchema,
  address: z.string().nullable(),
  status: requestStatusSchema,
  createdAt: z.iso.datetime(),
});
export type RequestRow = z.infer<typeof requestRowSchema>;

export const requestListQuerySchema = z.object({
  status: requestStatusSchema.optional(),
  categoryId: z.uuid().optional(),
  days: mapDaysSchema,
  q: z.string().max(200).default(''),
  /** Na query string a página vem como texto. */
  page: z
    .preprocess(
      (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value),
      z.number().int().min(1),
    )
    .default(1),
});
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

export const requestListResponseSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  items: z.array(requestRowSchema),
});
export type RequestListResponse = z.infer<typeof requestListResponseSchema>;

/** A revisão está atrasada quando a atividade espera `REVIEW_LATE_HOURS` ou mais. */
export function isReviewLate(statusSince: Date, now: Date): boolean {
  return now.getTime() - statusSince.getTime() >= REVIEW_LATE_HOURS * 3_600_000;
}
