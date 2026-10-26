import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './PointPanel.module.css';

export interface SplitDialogProps {
  /** Relatos desmarcados, que vão para a nova ocorrência. */
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SplitDialog({ count, pending, onCancel, onConfirm }: SplitDialogProps) {
  return (
    <Dialog
      title={count === 1 ? 'Separar 1 relato?' : `Separar ${count} relatos?`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" disabled={pending} onClick={onConfirm}>
            Separar
          </Button>
        </>
      }
    >
      <p className={styles.dialogText}>
        Eles viram uma nova ocorrência em triagem, no mesmo lugar.
      </p>
    </Dialog>
  );
}
