import { useState } from 'react';
import { LegalDialog } from './LegalDialog';
import styles from './LegalLinks.module.css';

/** Rodapé do menu da conta: abre os dois textos só para leitura. */
export function LegalLinks({ color }: { color?: string }) {
  const [open, setOpen] = useState<'termos' | 'privacidade' | null>(null);
  return (
    <>
      <div className={styles.links} style={color ? { color } : undefined}>
        <button type="button" className={styles.link} onClick={() => setOpen('termos')}>
          Termos de Uso
        </button>
        <button type="button" className={styles.link} onClick={() => setOpen('privacidade')}>
          Política de Privacidade
        </button>
      </div>
      {open ? <LegalDialog slug={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
