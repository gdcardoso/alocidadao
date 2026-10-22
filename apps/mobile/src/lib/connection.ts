import { connectionContextSchema, type ConnectionContext } from '@alocidadao/shared';

export interface NetSnapshot {
  type: string;
  isConnected: boolean | null;
  cellularGeneration: string | null;
}

export interface ConnectionMeasures {
  apiLatencyMs: number | null;
  uploadDurationMs: number | null;
  sentOffline: boolean;
}

const NETWORK_TYPES = ['wifi', 'cellular', 'ethernet'] as const;
const GENERATIONS = ['2g', '3g', '4g', '5g'] as const;

export function toConnectionContext(
  net: NetSnapshot,
  measures: ConnectionMeasures,
): ConnectionContext {
  const known = NETWORK_TYPES.find((t) => t === net.type);
  const networkType = net.isConnected === false ? 'none' : (known ?? 'unknown');
  const cellularGeneration =
    networkType === 'cellular'
      ? (GENERATIONS.find((g) => g === net.cellularGeneration) ?? null)
      : null;
  return connectionContextSchema.parse({
    networkType,
    cellularGeneration,
    apiLatencyMs: measures.apiLatencyMs === null ? null : Math.round(measures.apiLatencyMs),
    uploadDurationMs:
      measures.uploadDurationMs === null ? null : Math.round(measures.uploadDurationMs),
    sentOffline: measures.sentOffline,
  });
}

/** Cronometra a chamada (ex.: `api.health()`); devolve null se ela falhar. */
export async function measureApiLatency(
  ping: () => Promise<unknown>,
  now: () => number = Date.now,
): Promise<number | null> {
  const start = now();
  try {
    await ping();
  } catch {
    return null;
  }
  return Math.max(0, now() - start);
}
