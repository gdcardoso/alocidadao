import type { QueuedRequest } from './requests-view';

/**
 * Ponto de ligação da Task 9: as solicitações da fila offline (itens `create_request`,
 * esperando internet ou recusadas) que aparecem no topo da tela 4. A fila de hoje só tem
 * ações do agente, então a lista vem vazia; a Task 9 lê os itens da fila aqui e implementa
 * `remove` (botão "Remover" das recusadas).
 */
export function useQueuedRequests(): {
  items: QueuedRequest[];
  remove(id: string): Promise<void>;
  reload(): Promise<void>;
} {
  return EMPTY_QUEUE;
}

// Referências estáveis: a tela usa `reload` como dependência dos efeitos.
const EMPTY_QUEUE = {
  items: [] as QueuedRequest[],
  remove: async (_id: string) => undefined,
  reload: async () => undefined,
};
