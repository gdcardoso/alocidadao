import { z } from 'zod';

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

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

export const createRequestInputSchema = z.object({
  categoryId: z.uuid(),
  description: z.string().trim().min(10).max(2000),
  location: geoPointSchema,
  address: z.string().trim().max(300).optional(),
  photoKeys: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS_PER_REQUEST),
  connection: connectionContextSchema,
});
export type CreateRequestInput = z.infer<typeof createRequestInputSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
