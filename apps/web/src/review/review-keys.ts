/** Chave da fila de revisão; as ações da W3 a invalidam. */
export const reviewQueueKey = (tenantId: string) => ['review-queue', tenantId] as const;
