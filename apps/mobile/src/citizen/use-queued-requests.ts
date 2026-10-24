import type { RequestCard } from '@alocidadao/shared';
import { useCallback } from 'react';
import { forgetSentRequests, type SentRequest } from '../offline/outbox-state';
import { useOutbox } from '../offline/use-outbox-sync';
import { toQueuedRequests, type QueuedRequest } from './requests-view';

/**
 * Solicitações da fila offline (esperando internet ou recusadas) que aparecem no topo da
 * tela 4. `withSent` junta a elas as enviadas por uma passada que a lista do servidor
 * (`cards`, `null` enquanto ela não chega) ainda não trouxe; `forgetSent` as tira quando ela
 * traz. `remove` é o "Remover" das recusadas: tira o item e as fotos guardadas dele.
 */
export function useQueuedRequests(): {
  sent: SentRequest[];
  withSent(cards: readonly RequestCard[] | null): QueuedRequest[];
  forgetSent(requestIds: readonly string[]): void;
  remove(id: string): Promise<void>;
  reload(): Promise<void>;
} {
  const { items, sent, remove, refresh } = useOutbox();
  const withSent = useCallback(
    (cards: readonly RequestCard[] | null) =>
      toQueuedRequests(items, sent, cards ? new Set(cards.map((c) => c.id)) : null),
    [items, sent],
  );
  return { sent, withSent, forgetSent: forgetSentRequests, remove, reload: refresh };
}
