import { ApiError } from '@alocidadao/api-client';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { panelCountsKey } from '../shell/use-panel';
import { useToast } from '../ui/Toast';

export const WORK_ORDER_CHANGED_MESSAGE = 'Esta atividade mudou. Atualizamos o painel.';

const CHANGED_CODES = [
  'work_order_unavailable',
  'work_order_not_found',
  'occurrence_unavailable',
  'occurrence_not_found',
];

/**
 * Decisões do gestor sobre uma atividade da fila (W3 e W4): controla o "pendente", mostra o aviso
 * e, dando certo ou não (atividade que mudou), recarrega a fila e os contadores para o layout
 * abrir o próximo item. Devolve `true` quando a fila foi recarregada (deu certo ou mudou).
 */
export function useWorkOrderDecision(options: {
  tenantId: string;
  queueKey: QueryKey;
  detailKey: QueryKey;
}) {
  const { tenantId, queueKey, detailKey } = options;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function decide(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setPending(true);
    try {
      await action();
      toast.show(success);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'not_a_member') return false;
      if (code && CHANGED_CODES.includes(code)) {
        toast.show(WORK_ORDER_CHANGED_MESSAGE);
      } else {
        toast.show(error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
        return false;
      }
    } finally {
      setPending(false);
    }
    queryClient.removeQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: queueKey });
    void queryClient.invalidateQueries({ queryKey: panelCountsKey(tenantId) });
    void queryClient.invalidateQueries({ queryKey: ['occurrences'] });
    void queryClient.invalidateQueries({ queryKey: ['triage'] });
    return true;
  }

  return { pending, decide };
}
