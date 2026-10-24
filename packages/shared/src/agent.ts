import { z } from 'zod';
import { photoViewSchema } from './citizen.js';
import { ICON_GROUPS } from './enums.js';
import { geoPointSchema } from './geo.js';
import { workOrderStatusSchema } from './work-order-status.js';

/** Máximo de fotos ao relatar um impedimento. */
export const MAX_PHOTOS_PER_IMPEDIMENT = 1;

/** Distância até a ocorrência, em metros, abaixo da qual o agente "está no local". */
export const AGENT_NEAR_SITE_M = 100;

export const IMPEDIMENT_REASONS = [
  'missing_material',
  'inaccessible',
  'needs_other_team',
  'not_municipal',
  'other',
] as const;
export const impedimentReasonSchema = z.enum(IMPEDIMENT_REASONS);
export type ImpedimentReason = z.infer<typeof impedimentReasonSchema>;

export const IMPEDIMENT_REASON_LABELS: Record<ImpedimentReason, string> = {
  missing_material: 'Falta material ou equipamento',
  inaccessible: 'Local inacessível',
  needs_other_team: 'Precisa de outra equipe',
  not_municipal: 'Não é da prefeitura',
  other: 'Outro motivo',
};

export const REWORK_REASONS = ['new_photos', 'new_note', 'return_to_site'] as const;
export const reworkReasonSchema = z.enum(REWORK_REASONS);
export type ReworkReason = z.infer<typeof reworkReasonSchema>;

export const reworkDetailsSchema = z.object({
  reasons: z.array(reworkReasonSchema).min(1),
  discardedPhotoIds: z.array(z.uuid()),
});
export type ReworkDetails = z.infer<typeof reworkDetailsSchema>;

/** Posição lida no aparelho, com a precisão informada pelo GPS. */
export const deviceLocationSchema = geoPointSchema.extend({
  accuracyM: z.number().nonnegative().nullable(),
});
export type DeviceLocation = z.infer<typeof deviceLocationSchema>;

/** Cartão da atividade na lista do agente. */
export const agentWorkOrderCardSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  status: workOrderStatusSchema,
  protocol: z.string(),
  categoryName: z.string(),
  categoryIcon: z.string().nullable(),
  categoryGroup: z.enum(ICON_GROUPS),
  address: z.string().nullable(),
  location: geoPointSchema,
  teamName: z.string(),
  reportCount: z.number().int(),
  dueAt: z.iso.datetime().nullable(),
  assignedAt: z.iso.datetime(),
  statusChangedAt: z.iso.datetime(),
});
export type AgentWorkOrderCard = z.infer<typeof agentWorkOrderCardSchema>;

/** Detalhe da atividade para o agente (nunca traz dados pessoais de cidadãos). */
export const agentWorkOrderDetailSchema = agentWorkOrderCardSchema.extend({
  managerInstructions: z.string().nullable(),
  assignedBy: z.object({ name: z.string(), departmentName: z.string() }).nullable(),
  reports: z.array(z.object({ description: z.string(), createdAt: z.iso.datetime() })),
  photos: z.array(photoViewSchema),
  citizenCount: z.number().int(),
  rework: z
    .object({
      reasons: z.array(reworkReasonSchema),
      message: z.string(),
      byName: z.string().nullable(),
      departmentName: z.string().nullable(),
      at: z.iso.datetime(),
    })
    .nullable(),
  previousNote: z.string().nullable(),
});
export type AgentWorkOrderDetail = z.infer<typeof agentWorkOrderDetailSchema>;

/** Corpo das ações do gestor na rota de desenvolvimento (o painel real vem no Plano 5). */
export const devManagerActionBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request_rework'),
    reasons: reworkDetailsSchema.shape.reasons,
    message: z.string().trim().min(3).max(1000),
    discardedPhotoIds: reworkDetailsSchema.shape.discardedPhotoIds,
  }),
  z.object({ action: z.literal('reschedule'), dueAt: z.iso.datetime().nullable() }),
]);
export type DevManagerActionBody = z.infer<typeof devManagerActionBodySchema>;
