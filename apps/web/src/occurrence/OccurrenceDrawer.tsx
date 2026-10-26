import type { OccurrenceDetail } from '@alocidadao/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AssignDialog } from './AssignDialog';
import styles from './OccurrenceDrawer.module.css';
import { PointPanel } from './PointPanel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OccurrenceDrawerProps {
  tenantId: string;
}

/**
 * Gaveta com o painel do ponto, guardada na URL em `?ocorrencia=`. Fica por cima da área da
 * página (o pai é `position: relative`). Os outros parâmetros da URL não mudam.
 */
export function OccurrenceDrawer({ tenantId }: OccurrenceDrawerProps) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('ocorrencia');
  const occurrenceId = raw && UUID.test(raw) ? raw : null;
  // Ocorrência da W2 (Atribuir a uma equipe), aberta a partir do painel do ponto.
  const [assignTarget, setAssignTarget] = useState<OccurrenceDetail | null>(null);

  function setOccurrence(next: string | null) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        if (next) search.set('ocorrencia', next);
        else search.delete('ocorrencia');
        return search;
      },
      { replace: true },
    );
  }

  // Esc fecha a gaveta, a menos que haja um diálogo aberto (ele fecha primeiro).
  useEffect(() => {
    if (!occurrenceId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      setOccurrence(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <>
      {occurrenceId ? (
        <div className={styles.drawer}>
          <PointPanel
            key={`${tenantId}:${occurrenceId}`}
            occurrenceId={occurrenceId}
            onClose={() => setOccurrence(null)}
            onAssign={setAssignTarget}
            onChanged={(result) => {
              // A junção pode manter a outra (a que tem atividade): a gaveta segue a que ficou.
              if (result.kind === 'merge' && result.survivorId !== occurrenceId) {
                setOccurrence(result.survivorId);
              }
            }}
          />
        </div>
      ) : null}
      {assignTarget ? (
        <AssignDialog
          occurrence={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => setAssignTarget(null)}
        />
      ) : null}
    </>
  );
}
