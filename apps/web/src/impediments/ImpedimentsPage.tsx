import { ApiError } from '@alocidadao/api-client';
import { IMPEDIMENT_REASON_LABELS, type WorkQueueItem } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { OctagonAlert } from 'lucide-react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatElapsed } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { TopBar } from '../ui/TopBar';
import { WorkQueueLayout } from '../work/WorkQueueLayout';
import { ImpedimentDetailView } from './ImpedimentDetail';
import { impedimentQueueKey } from './impediment-keys';
import styles from './ImpedimentsPage.module.css';

function subtitle(total: number): string {
  return total === 1
    ? '1 atividade que a equipe não conseguiu resolver. Decida o próximo passo.'
    : `${total} atividades que a equipe não conseguiu resolver. Decida o próximo passo.`;
}

/** W4 · Impedimentos: fila de atividades que o agente não conseguiu resolver, com o detalhe ao lado. */
export function ImpedimentsPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const now = useNow();
  const queue = useQuery({
    queryKey: impedimentQueueKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelImpediments(tenantId)),
  });
  const data = queue.data;
  const error = queue.error
    ? queue.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  function renderCard(item: WorkQueueItem) {
    const reason = item.impedimentReason ? IMPEDIMENT_REASON_LABELS[item.impedimentReason] : null;
    return (
      <>
        <span className={styles.cardTop}>
          <span className={styles.category}>{item.categoryName}</span>
          <span className={styles.wait}>{formatElapsed(new Date(item.statusSince), now)}</span>
        </span>
        {item.address ? <span className={styles.address}>{item.address}</span> : null}
        <span className={styles.reason}>
          <OctagonAlert size={13} aria-hidden="true" />
          {reason ?? IMPEDIMENT_REASON_LABELS.other}
        </span>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <TopBar title="Impedimentos" subtitle={data ? subtitle(data.total) : undefined} />
      {error ? <p className={styles.state}>{error}</p> : null}
      {data ? (
        <WorkQueueLayout
          items={data.items}
          renderCard={renderCard}
          renderDetail={(id) => <ImpedimentDetailView key={id} workOrderId={id} />}
          empty="Nenhum impedimento. Tudo em dia."
        />
      ) : null}
    </div>
  );
}
