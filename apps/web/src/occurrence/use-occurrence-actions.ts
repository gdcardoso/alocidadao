import { ApiError } from '@alocidadao/api-client';
import type { OccurrenceDetail } from '@alocidadao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { useSession } from '../session/SessionProvider';
import { panelCountsKey } from '../shell/use-panel';
import { useToast } from '../ui/Toast';

/** Chave do detalhe da ocorrência (painel do ponto). */
export const occurrenceKey = (id: string) => ['occurrence', id] as const;

export type OccurrenceAction =
  | { kind: 'merge'; occurrenceId: string; otherOccurrenceId: string }
  | { kind: 'dismiss'; occurrenceId: string; otherOccurrenceId: string }
  | { kind: 'split'; occurrenceId: string; requestIds: string[] }
  | { kind: 'reject'; occurrenceId: string; reason: string }
  | {
      kind: 'assign';
      occurrenceId: string;
      teamId: string;
      teamName: string;
      dueDate: string;
      instructions: string | null;
    };

export type OccurrenceActionResult =
  | { kind: 'merge'; survivorId: string }
  | { kind: 'dismiss' }
  | { kind: 'split'; newOccurrenceId: string }
  | { kind: 'reject' }
  | { kind: 'assign'; workOrderId: string };

/**
 * Desfecho de uma ação: `done` deu certo; `stale` a ocorrência mudou (ou sumiu) e os dados
 * foram recarregados; `failed` falha de rede ou erro inesperado, para tentar de novo.
 */
export type ActionOutcome =
  { status: 'done'; result: OccurrenceActionResult } | { status: 'stale' } | { status: 'failed' };

export const OCCURRENCE_CHANGED_MESSAGE = 'Esta ocorrência mudou. Atualizamos o painel.';
export const BOTH_HAVE_WORK_ORDERS_MESSAGE =
  'As duas ocorrências têm atividade em andamento. Cancele uma antes de juntar.';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : undefined;
}

function splitNotice(count: number): string {
  return count === 1
    ? '1 relato separado em uma nova ocorrência.'
    : `${count} relatos separados em uma nova ocorrência.`;
}

/**
 * Ações do painel do ponto (juntar, "é outro problema", separar, recusar e atribuir). Depois de cada
 * uma, recarrega o detalhe, o mapa (`['occurrences']`), a triagem (`['triage']`) e os
 * contadores do menu, e mostra o aviso das decisões.
 */
export function useOccurrenceActions(tenantId: string) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: async (action: OccurrenceAction): Promise<OccurrenceActionResult> => {
      const { occurrenceId: id } = action;
      switch (action.kind) {
        case 'merge': {
          const body = { otherOccurrenceId: action.otherOccurrenceId };
          const { survivorId } = await session.withAuth(() => api.panelMerge(tenantId, id, body));
          return { kind: 'merge', survivorId };
        }
        case 'dismiss': {
          const body = { otherOccurrenceId: action.otherOccurrenceId };
          await session.withAuth(() => api.panelDismissSuggestion(tenantId, id, body));
          return { kind: 'dismiss' };
        }
        case 'split': {
          const body = { requestIds: action.requestIds };
          const { newOccurrenceId } = await session.withAuth(() =>
            api.panelSplit(tenantId, id, body),
          );
          return { kind: 'split', newOccurrenceId };
        }
        case 'reject':
          await session.withAuth(() =>
            api.panelReject(tenantId, id, { reason: action.reason.trim() }),
          );
          return { kind: 'reject' };
        case 'assign': {
          const body = {
            teamId: action.teamId,
            dueDate: action.dueDate,
            instructions: action.instructions,
          };
          const { workOrderId } = await session.withAuth(() => api.panelAssign(tenantId, id, body));
          return { kind: 'assign', workOrderId };
        }
      }
    },
  });

  async function refresh(action: OccurrenceAction) {
    const ids = [action.occurrenceId];
    if (action.kind === 'merge' || action.kind === 'dismiss') ids.push(action.otherOccurrenceId);
    await Promise.all([
      ...ids.map((id) => queryClient.invalidateQueries({ queryKey: occurrenceKey(id) })),
      queryClient.invalidateQueries({ queryKey: ['occurrences'] }),
      queryClient.invalidateQueries({ queryKey: ['triage'] }),
      queryClient.invalidateQueries({ queryKey: panelCountsKey(tenantId) }),
    ]);
  }

  async function run(action: OccurrenceAction): Promise<ActionOutcome> {
    let result: OccurrenceActionResult;
    try {
      result = await mutation.mutateAsync(action);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'not_a_member') return { status: 'failed' }; // o painel troca de página
      if (code === 'occurrence_unavailable' || code === 'occurrence_not_found') {
        toast.show(OCCURRENCE_CHANGED_MESSAGE);
        void refresh(action);
        return { status: 'stale' };
      }
      if (code === 'both_have_work_orders') {
        toast.show(BOTH_HAVE_WORK_ORDERS_MESSAGE);
        return { status: 'failed' };
      }
      toast.show(error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
      return { status: 'failed' };
    }

    if (result.kind === 'dismiss' && action.kind === 'dismiss') {
      // A sugestão some na hora; a nova leitura confirma.
      queryClient.setQueryData(
        occurrenceKey(action.occurrenceId),
        (current: OccurrenceDetail | undefined) =>
          current && {
            ...current,
            suggestions: current.suggestions.filter(
              (item) => item.occurrenceId !== action.otherOccurrenceId,
            ),
          },
      );
    }
    if (result.kind === 'merge') toast.show('Relatos juntados a este ponto.');
    if (result.kind === 'split' && action.kind === 'split') {
      toast.show(splitNotice(action.requestIds.length));
    }
    if (result.kind === 'reject') toast.show('Ocorrência recusada.');
    if (result.kind === 'assign' && action.kind === 'assign') {
      toast.show(`Atribuída a ${action.teamName}.`);
    }
    void refresh(action);
    return { status: 'done', result };
  }

  return { run, pending: mutation.isPending };
}
