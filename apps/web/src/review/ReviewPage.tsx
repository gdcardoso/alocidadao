import { ApiError } from '@alocidadao/api-client';
import { isReviewLate, type WorkQueueItem } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatElapsed } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { TopBar } from '../ui/TopBar';
import { WorkQueueLayout } from '../work/WorkQueueLayout';
import { ReviewDetailView } from './ReviewDetail';
import { reviewQueueKey } from './review-keys';
import styles from './ReviewPage.module.css';

function subtitle(total: number): string {
  return total === 1
    ? '1 atendimento concluído pela equipe. O cidadão só recebe depois que você publicar.'
    : `${total} atendimentos concluídos pelas equipes. O cidadão só recebe depois que você publicar.`;
}

/** W3 · Aguardando revisão: fila de atividades concluídas, com o detalhe ao lado. */
export function ReviewPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const now = useNow();
  const queue = useQuery({
    queryKey: reviewQueueKey(tenantId),
    queryFn: () => session.withAuth(() => api.panelReviews(tenantId)),
  });
  const data = queue.data;
  const error = queue.error
    ? queue.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  function renderCard(item: WorkQueueItem) {
    const since = new Date(item.statusSince);
    const meta = [item.address, item.departmentName, item.teamName].filter(Boolean).join(' · ');
    return (
      <>
        <span className={styles.cardTop}>
          <span className={styles.category}>{item.categoryName}</span>
          <span className={styles.wait} data-late={isReviewLate(since, now)}>
            <Hourglass size={14} aria-hidden="true" />
            {formatElapsed(since, now)}
          </span>
        </span>
        <span className={styles.meta}>{meta}</span>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <TopBar title="Aguardando revisão" subtitle={data ? subtitle(data.total) : undefined} />
      {error ? <p className={styles.state}>{error}</p> : null}
      {data ? (
        <WorkQueueLayout
          items={data.items}
          renderCard={renderCard}
          renderDetail={(id) => <ReviewDetailView key={id} workOrderId={id} />}
          empty="Nenhum atendimento aguardando revisão."
        />
      ) : null}
    </div>
  );
}
