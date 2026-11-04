import { LEGAL_DOCUMENTS, type LegalDocument } from '@alocidadao/shared';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { LegalDocumentView } from './LegalDocumentView';

export interface LegalDialogProps {
  slug: LegalDocument['slug'];
  onClose: () => void;
  /** Só na caixa de aceite: "Li e concordo" chama isto e fecha. Sem ele, só leitura. */
  onAgree?: () => void;
}

/** Texto do documento numa janela; com `onAgree`, termina com "Li e concordo". */
export function LegalDialog({ slug, onClose, onAgree }: LegalDialogProps) {
  const document = LEGAL_DOCUMENTS[slug];
  return (
    <Dialog
      title={document.title}
      onClose={onClose}
      footer={
        onAgree ? (
          <Button
            size="md"
            onClick={() => {
              onAgree();
              onClose();
            }}
          >
            Li e concordo
          </Button>
        ) : undefined
      }
    >
      <LegalDocumentView document={document} />
    </Dialog>
  );
}
