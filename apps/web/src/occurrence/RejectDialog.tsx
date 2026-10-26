import { REJECT_REASON_MAX, REJECT_REASON_MIN, type OccurrenceDetail } from '@alocidadao/shared';
import { useId, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './PointPanel.module.css';

export interface RejectDialogProps {
  detail: OccurrenceDetail;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function reportsLabel(count: number): string {
  return count === 1 ? '1 relato' : `${count} relatos`;
}

export function RejectDialog({ detail, pending, onCancel, onConfirm }: RejectDialogProps) {
  const fieldId = useId();
  const helpId = useId();
  const [reason, setReason] = useState('');
  const count = detail.requestCount;
  const subtitle = [detail.category.name, detail.address, reportsLabel(count)]
    .filter(Boolean)
    .join(' · ');
  const valid = reason.trim().length >= REJECT_REASON_MIN;

  return (
    <Dialog
      title="Recusar ocorrência"
      subtitle={subtitle}
      onClose={onCancel}
      footer={
        <>
          <p className={styles.dialogEffect}>
            A ocorrência sai das filas e os cidadãos veem &quot;Recusada&quot;.
          </p>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!valid || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            Recusar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <div className={styles.fieldLabelRow}>
          <label htmlFor={fieldId} className={styles.fieldLabel}>
            Motivo para os cidadãos
          </label>
          <span className={styles.fieldHint}>obrigatório</span>
        </div>
        <textarea
          id={fieldId}
          className={styles.textarea}
          rows={4}
          maxLength={REJECT_REASON_MAX}
          value={reason}
          aria-describedby={helpId}
          onChange={(event) => setReason(event.target.value)}
        />
        <p id={helpId} className={styles.fieldHint}>
          {count === 1
            ? 'O cidadão que relatou recebe este texto.'
            : `Os ${count} cidadãos que relataram recebem este texto.`}
        </p>
      </div>
    </Dialog>
  );
}
