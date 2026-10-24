import { z } from 'zod';
import {
  MAX_PHOTOS_PER_IMPEDIMENT,
  deviceLocationSchema,
  impedimentReasonSchema,
} from './agent.js';
import { MAX_LOCATION_ADJUST_M, distanceMeters, geoPointSchema } from './geo.js';
import { workOrderStatusSchema } from './work-order-status.js';

/** Network conditions recorded with every status event and attachment. */
export const connectionContextSchema = z.object({
  networkType: z.enum(['wifi', 'cellular', 'ethernet', 'none', 'unknown']),
  cellularGeneration: z.enum(['2g', '3g', '4g', '5g']).nullable(),
  apiLatencyMs: z.number().int().nonnegative().nullable(),
  uploadDurationMs: z.number().int().nonnegative().nullable(),
  sentOffline: z.boolean(),
});
export type ConnectionContext = z.infer<typeof connectionContextSchema>;

export const MAX_PHOTOS_PER_REQUEST = 3;
export const MAX_PHOTOS_PER_COMPLETION = 3;

/** Lado maior da foto reduzida no aparelho, em pixels. */
export const PHOTO_MAX_SIDE_PX = 1600;
/** Tamanho alvo da foto após a compressão, em bytes. */
export const PHOTO_TARGET_BYTES = 300_000;
/** Limite rígido aceito pelo servidor, em bytes. */
export const PHOTO_MAX_BYTES = 1_000_000;

export const createRequestInputSchema = z
  .object({
    /** Idempotência: o mesmo envio repetido não cria outra solicitação. */
    clientActionId: z.uuid(),
    categoryId: z.uuid(),
    /** Observação opcional do cidadão. */
    description: z.string().trim().max(2000).optional(),
    /** Momento do relato no aparelho. */
    occurredAt: z.iso.datetime(),
    /** Posição lida do GPS no momento do relato. */
    gpsLocation: geoPointSchema,
    /** Ponto ajustado pelo cidadão; fica a no máximo MAX_LOCATION_ADJUST_M do GPS. */
    location: geoPointSchema,
    address: z.string().trim().max(300).optional(),
    /** Ocorrência existente que o cidadão escolheu apoiar. */
    occurrenceId: z.uuid().optional(),
    photoKeys: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS_PER_REQUEST),
    connection: connectionContextSchema,
  })
  .superRefine((value, ctx) => {
    if (distanceMeters(value.gpsLocation, value.location) > MAX_LOCATION_ADJUST_M) {
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: `O local não pode ficar a mais de ${MAX_LOCATION_ADJUST_M} m do GPS`,
      });
    }
  });
export type CreateRequestInput = z.infer<typeof createRequestInputSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Ação feita pelo agente no aparelho (possivelmente offline) sobre uma atividade. */
export const workOrderActionInputSchema = z
  .object({
    clientActionId: z.uuid(),
    action: z.enum(['start', 'complete', 'report_impediment']),
    occurredAt: z.iso.datetime(),
    /** Observação da conclusão ou detalhes do impedimento. */
    note: z.string().trim().min(3).max(2000).optional(),
    impedimentReason: impedimentReasonSchema.optional(),
    /** Posição do aparelho no momento da ação; null quando não foi possível ler. */
    location: deviceLocationSchema.nullable().default(null),
    photoKeys: z.array(z.string().min(1)).max(MAX_PHOTOS_PER_COMPLETION),
    connection: connectionContextSchema,
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.action === 'complete') {
      if (!value.note) issue('note', 'A observação é obrigatória');
      if (value.photoKeys.length < 1) issue('photoKeys', 'Ao menos uma foto é obrigatória');
      if (value.impedimentReason)
        issue('impedimentReason', 'Concluir não leva motivo de impedimento');
    } else if (value.action === 'report_impediment') {
      if (!value.impedimentReason)
        issue('impedimentReason', 'O motivo do impedimento é obrigatório');
      if (!value.note || value.note.length < 3 || value.note.length > 1000) {
        issue('note', 'Os detalhes do impedimento são obrigatórios (3 a 1000 caracteres)');
      }
      if (value.photoKeys.length > MAX_PHOTOS_PER_IMPEDIMENT) {
        issue('photoKeys', `O impedimento aceita no máximo ${MAX_PHOTOS_PER_IMPEDIMENT} foto`);
      }
    } else {
      if (value.photoKeys.length > 0) issue('photoKeys', 'Iniciar a atividade não leva fotos');
      if (value.note) issue('note', 'Iniciar a atividade não leva observação');
      if (value.impedimentReason) issue('impedimentReason', 'Iniciar a atividade não leva motivo');
    }
  });
export type WorkOrderActionInput = z.infer<typeof workOrderActionInputSchema>;

export const workOrderActionResultSchema = z.object({
  workOrderId: z.uuid(),
  status: workOrderStatusSchema,
  duplicate: z.boolean(),
});
export type WorkOrderActionResult = z.infer<typeof workOrderActionResultSchema>;

/** Item da lista de atividades ativas do agente. */
export const workOrderSummarySchema = z.object({
  id: z.uuid(),
  status: workOrderStatusSchema,
  protocol: z.string(),
  description: z.string(),
  categoryName: z.string(),
  address: z.string().nullable(),
  location: geoPointSchema,
  dueAt: z.iso.datetime().nullable(),
});
export type WorkOrderSummary = z.infer<typeof workOrderSummarySchema>;
