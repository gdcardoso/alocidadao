import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  title: string;
  text: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
  /** Desabilita os botões enquanto a ação roda. */
  pending?: boolean;
}

/** Confirmação curta: texto, `Cancelar` e o botão da ação. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  tone,
  onConfirm,
  onClose,
  pending = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{text}</p>
    </Dialog>
  );
}
