import {
  REWORK_MESSAGE_MAX,
  REWORK_MESSAGE_MIN,
  REWORK_REASONS,
  REWORK_REASON_LABELS,
  type ReviewDetail,
  type ReworkBody,
  type ReworkReason,
} from '@alocidadao/shared';
import { Camera, MapPin, PencilLine, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { PhotoToggle } from './PhotoToggle';
import styles from './ReworkDialog.module.css';

const REASON_ICONS: Record<ReworkReason, ReactNode> = {
  new_photos: <Camera size={18} aria-hidden="true" />,
  new_note: <PencilLine size={18} aria-hidden="true" />,
  return_to_site: <MapPin size={18} aria-hidden="true" />,
};

export interface ReworkDialogProps {
  review: ReviewDetail;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (body: ReworkBody) => void;
}

/** W3b · Devolver ao agente. */
export function ReworkDialog({ review, pending, onCancel, onConfirm }: ReworkDialogProps) {
  const messageId = useId();
  const [reasons, setReasons] = useState<ReworkReason[]>([]);
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const trimmed = message.trim();
  const valid =
    reasons.length > 0 &&
    trimmed.length >= REWORK_MESSAGE_MIN &&
    trimmed.length <= REWORK_MESSAGE_MAX;
  const subtitle = [review.agentName, review.categoryName, review.address]
    .filter(Boolean)
    .join(' · ');

  function toggleReason(reason: ReworkReason, on: boolean) {
    setReasons((current) =>
      on ? [...current, reason] : current.filter((item) => item !== reason),
    );
  }

  function submit() {
    onConfirm({
      reasons: REWORK_REASONS.filter((reason) => reasons.includes(reason)),
      discardedPhotoIds: review.pendingPhotos
        .map((photo) => photo.id)
        .filter((id) => discarded.includes(id)),
      message: trimmed,
    });
  }

  return (
    <Dialog
      title="Devolver ao agente"
      subtitle={subtitle}
      onClose={onCancel}
      footer={
        <>
          <p className={styles.effect}>
            A atividade volta para a lista do agente. O cidadão continua vendo &quot;Em
            atendimento&quot;.
          </p>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            size="sm"
            icon={<Undo2 size={16} aria-hidden="true" />}
            disabled={!valid || pending}
            onClick={submit}
          >
            Devolver
          </Button>
        </>
      }
    >
      <fieldset className={styles.section}>
        <legend className={styles.legend}>
          <span className={styles.label}>O que precisa ajustar?</span>
          <span className={styles.hint}>marque um ou mais</span>
        </legend>
        {REWORK_REASONS.map((reason) => {
          const checked = reasons.includes(reason);
          return (
            <label key={reason} className={styles.reason} data-checked={checked}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => toggleReason(reason, event.target.checked)}
              />
              {REASON_ICONS[reason]}
              {REWORK_REASON_LABELS[reason]}
            </label>
          );
        })}
      </fieldset>

      {review.pendingPhotos.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.legend}>
            <span className={styles.label}>Fotos que não servem</span>
            <span className={styles.hint}>serão descartadas</span>
          </div>
          <div className={styles.photos}>
            {review.pendingPhotos.map((photo, index) => (
              <PhotoToggle
                key={photo.id}
                variant="discard"
                url={photo.url}
                label={`Descartar foto ${index + 1}`}
                checked={discarded.includes(photo.id)}
                onChange={(on) =>
                  setDiscarded((current) =>
                    on ? [...current, photo.id] : current.filter((id) => id !== photo.id),
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.section}>
        <div className={styles.legend}>
          <label htmlFor={messageId} className={styles.label}>
            Mensagem para o agente
          </label>
          <span className={styles.hint}>obrigatório</span>
        </div>
        <textarea
          id={messageId}
          className={styles.textarea}
          rows={3}
          maxLength={REWORK_MESSAGE_MAX}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
