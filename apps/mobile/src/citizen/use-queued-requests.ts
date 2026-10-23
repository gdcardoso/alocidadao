import { useMemo } from 'react';
import { useOutbox } from '../offline/use-outbox-sync';
import { toQueuedRequests, type QueuedRequest } from './requests-view';

/**
 * Solicitações da fila offline (esperando internet ou recusadas) que aparecem no topo da
 * tela 4. `remove` é o "Remover" das recusadas: tira o item e as fotos guardadas dele.
 */
export function useQueuedRequests(): {
  items: QueuedRequest[];
  remove(id: string): Promise<void>;
  reload(): Promise<void>;
} {
  const { items, remove, refresh } = useOutbox();
  const queued = useMemo(() => toQueuedRequests(items), [items]);
  return { items: queued, remove, reload: refresh };
}
