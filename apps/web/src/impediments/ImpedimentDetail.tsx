import { ApiError } from '@alocidadao/api-client';
import { IMPEDIMENT_REASON_LABELS, type ImpedimentDetail } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Users } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatDayMonth } from '../format/date';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { REASON_ICONS } from '../ui/reason-icons';
import { useWorkOrderDecision } from '../work/use-work-order-decision';
import { WorkOrderHeader } from '../work/WorkOrderHeader';
import { impedimentKey, impedimentQueueKey } from './impediment-keys';
import styles from './ImpedimentDetail.module.css';
import { NextStepOptions, type NextStep } from './NextStepOptions';

/** Detalhe da W4: relato do agente, próximo passo e confirmação. */
export function ImpedimentDetailView({ workOrderId }: { workOrderId: string }) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const query = useQuery({
    queryKey: impedimentKey(tenantId, workOrderId),
    queryFn: () => session.withAuth(() => api.panelImpediment(tenantId, workOrderId)),
  });
  if (query.error) {
    return (
      <p className={styles.state}>
        {query.error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}
      </p>
    );
  }
  if (!query.data) return null;
  return <ImpedimentForm impediment={query.data} />;
}

function ImpedimentForm({ impediment }: { impediment: ImpedimentDetail }) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const [step, setStep] = useState<NextStep | null>(null);
  const { pending, decide } = useWorkOrderDecision({
    tenantId,
    queueKey: impedimentQueueKey(tenantId),
    detailKey: impedimentKey(tenantId, impediment.workOrderId),
  });
  const reason = impediment.reason ?? 'other';
  const ReasonIcon = REASON_ICONS[reason];

  function confirm() {
    if (!step) return;
    const { workOrderId, occurrenceId } = impediment;
    switch (step.kind) {
      case 'reassign':
        void decide(
          () =>
            session.withAuth(() =>
              api.panelReassign(tenantId, workOrderId, {
                teamId: step.teamId,
                dueDate: step.dueDate,
                instructions: step.instructions,
              }),
            ),
          `Reatribuída a ${step.teamName}.`,
        );
        break;
      case 'reschedule':
        void decide(
          () =>
            session.withAuth(() =>
              api.panelReschedule(tenantId, workOrderId, { dueDate: step.dueDate }),
            ),
          `Reagendada para ${formatDayMonth(new Date(`${step.dueDate}T12:00:00-03:00`))}.`,
        );
        break;
      case 'reject':
        void decide(
          () =>
            session.withAuth(() =>
              api.panelReject(tenantId, occurrenceId, { reason: step.reason }),
            ),
          'Ocorrência recusada.',
        );
        break;
    }
  }

  return (
    <>
      <WorkOrderHeader
        header={impediment}
        dateLabel="Registrado em"
        lastItem={
          <>
            <Users size={16} aria-hidden="true" />
            Cidadãos veem: Em atendimento
          </>
        }
      />
      <div className={styles.body}>
        <div className={styles.column}>
          <div className={styles.titleRow}>
            <h3 className={styles.sectionTitle}>Relato do agente</h3>
            <span className={styles.hint}>interno</span>
          </div>
          <div className={styles.report}>
            <p className={styles.reason}>
              <ReasonIcon size={18} aria-hidden="true" />
              {IMPEDIMENT_REASON_LABELS[reason]}
            </p>
            <p className={styles.note}>{impediment.note || 'O agente não escreveu detalhes.'}</p>
            {impediment.photoUrl ? (
              <img src={impediment.photoUrl} alt="Foto do agente" className={styles.photo} />
            ) : null}
          </div>
        </div>
        <div className={styles.column}>
          <div className={styles.titleRow}>
            <h3 className={styles.sectionTitle}>Próximo passo</h3>
            <span className={styles.hint}>obrigatório</span>
          </div>
          <NextStepOptions impediment={impediment} onChange={setStep} />
        </div>
      </div>
      <footer className={styles.footer}>
        <Button
          size="sm"
          icon={<Check size={16} aria-hidden="true" />}
          disabled={!step || pending}
          onClick={confirm}
        >
          Confirmar próximo passo
        </Button>
      </footer>
    </>
  );
}
