import { ApiError } from '@alocidadao/api-client';
import {
  PUBLIC_NOTE_MAX,
  PUBLIC_NOTE_MIN,
  type ReviewDetail,
  type ReworkBody,
} from '@alocidadao/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert, Undo2, Send, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { useSession } from '../session/SessionProvider';
import { panelCountsKey, usePanel } from '../shell/use-panel';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { WorkOrderHeader } from '../work/WorkOrderHeader';
import { PhotoToggle } from './PhotoToggle';
import { ReworkDialog } from './ReworkDialog';
import { reviewQueueKey } from './review-keys';
import styles from './ReviewDetail.module.css';

const reviewKey = (tenantId: string, id: string) => ['review', tenantId, id] as const;

export const WORK_ORDER_CHANGED_MESSAGE = 'Esta atividade mudou. Atualizamos o painel.';

function citizensHelp(count: number): string {
  return count > 1
    ? `Os ${count} cidadãos recebem este texto e as fotos marcadas.`
    : 'O cidadão recebe este texto e as fotos marcadas.';
}

/** Detalhe da W3: fotos do serviço, relato do agente, texto para o cidadão e as duas decisões. */
export function ReviewDetailView({ workOrderId }: { workOrderId: string }) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const query = useQuery({
    queryKey: reviewKey(tenantId, workOrderId),
    queryFn: () => session.withAuth(() => api.panelReview(tenantId, workOrderId)),
  });
  if (query.error) {
    return (
      <p className={styles.state}>
        {query.error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}
      </p>
    );
  }
  if (!query.data) return null;
  return <ReviewForm review={query.data} />;
}

function ReviewForm({ review }: { review: ReviewDetail }) {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const noteId = useId();
  const [checked, setChecked] = useState<string[]>(() => review.pendingPhotos.map((p) => p.id));
  const [note, setNote] = useState(review.agentNote ?? '');
  const [reworking, setReworking] = useState(false);
  const [pending, setPending] = useState(false);
  const trimmed = note.trim();
  const validNote = trimmed.length >= PUBLIC_NOTE_MIN && trimmed.length <= PUBLIC_NOTE_MAX;
  const count = review.activeRequestCount;

  /** Roda a decisão. Dá certo ou não, a fila e os contadores se recarregam; o layout abre o próximo. */
  async function decide(action: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await action();
      toast.show(success);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'not_a_member') return;
      if (code === 'work_order_unavailable' || code === 'work_order_not_found') {
        toast.show(WORK_ORDER_CHANGED_MESSAGE);
      } else {
        toast.show(error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
        return;
      }
    } finally {
      setPending(false);
    }
    setReworking(false);
    queryClient.removeQueries({ queryKey: reviewKey(tenantId, review.workOrderId) });
    void queryClient.invalidateQueries({ queryKey: reviewQueueKey(tenantId) });
    void queryClient.invalidateQueries({ queryKey: panelCountsKey(tenantId) });
  }

  function publish() {
    void decide(
      () =>
        session.withAuth(() =>
          api.panelPublish(tenantId, review.workOrderId, {
            publicNote: trimmed,
            publishedPhotoIds: review.pendingPhotos
              .map((photo) => photo.id)
              .filter((id) => checked.includes(id)),
          }),
        ),
      'Publicado para os cidadãos.',
    );
  }

  function rework(body: ReworkBody) {
    void decide(
      () => session.withAuth(() => api.panelRework(tenantId, review.workOrderId, body)),
      'Devolvida ao agente.',
    );
  }

  return (
    <>
      <WorkOrderHeader
        header={review}
        dateLabel="Concluído em"
        lastItem={
          <>
            <Users size={16} aria-hidden="true" />
            {count === 1 ? '1 cidadão aguardando' : `${count} cidadãos aguardando`}
          </>
        }
      />
      <div className={styles.body}>
        <div className={styles.column}>
          <div className={styles.titleRow}>
            <h3 className={styles.sectionTitle}>Fotos do serviço</h3>
            <span className={styles.hint}>marque as que o cidadão vai ver</span>
          </div>
          {review.pendingPhotos.length > 0 ? (
            <div className={styles.photos}>
              {review.pendingPhotos.map((photo) => (
                <PhotoToggle
                  key={photo.id}
                  variant="publish"
                  url={photo.url}
                  checked={checked.includes(photo.id)}
                  onChange={(on) =>
                    setChecked((current) =>
                      on ? [...current, photo.id] : current.filter((id) => id !== photo.id),
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>O agente não enviou fotos.</p>
          )}
          <p className={styles.warning}>
            <TriangleAlert size={18} aria-hidden="true" />
            Antes de publicar, confira se nenhuma foto mostra rostos ou placas de carro.
          </p>
          {review.citizenPhotos.length > 0 ? (
            <>
              <div className={styles.titleRow}>
                <h3 className={styles.sectionTitle}>Fotos de abertura (cidadãos)</h3>
                <span className={styles.hint}>para comparar</span>
              </div>
              <div className={styles.thumbs}>
                {review.citizenPhotos.map((photo, index) => (
                  <img
                    key={`${photo.url}-${index}`}
                    src={photo.url}
                    alt={`Foto de abertura ${index + 1}`}
                    className={styles.thumb}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className={styles.column}>
          <div className={styles.titleRow}>
            <h3 className={styles.sectionTitle}>Relato do agente</h3>
            <span className={styles.hint}>interno · não é enviado</span>
          </div>
          <p className={styles.agentNote}>{review.agentNote || 'O agente não escreveu relato.'}</p>
          <div className={styles.titleRow}>
            <label htmlFor={noteId} className={styles.sectionTitle}>
              Texto para o cidadão
            </label>
            <span className={styles.hint}>obrigatório</span>
          </div>
          <textarea
            id={noteId}
            className={styles.textarea}
            rows={5}
            maxLength={PUBLIC_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className={styles.help}>
            <Users size={16} aria-hidden="true" />
            {citizensHelp(count)}
          </p>
        </div>
      </div>
      <footer className={styles.footer}>
        <Button
          variant="secondary"
          icon={<Undo2 size={18} aria-hidden="true" />}
          disabled={pending}
          onClick={() => setReworking(true)}
        >
          Devolver ao agente
        </Button>
        <Button
          icon={<Send size={18} aria-hidden="true" />}
          disabled={!validNote || pending}
          onClick={publish}
        >
          Publicar para os cidadãos
        </Button>
      </footer>
      {reworking ? (
        <ReworkDialog
          review={review}
          pending={pending}
          onCancel={() => setReworking(false)}
          onConfirm={rework}
        />
      ) : null}
    </>
  );
}
