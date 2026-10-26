/** Chaves da fila e do detalhe de impedimentos; as decisões da W4 as invalidam. */
export const impedimentQueueKey = (tenantId: string) => ['impediment-queue', tenantId] as const;
export const impedimentKey = (tenantId: string, id: string) =>
  ['impediment', tenantId, id] as const;
