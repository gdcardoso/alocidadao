import { useState } from 'react';
import { LegalDialog } from './LegalDialog';
import styles from './TermsCheckbox.module.css';

export interface TermsCheckboxProps {
  checked: boolean;
  onChange(next: boolean): void;
}

/** Caixa de aceite: os dois nomes são links que abrem o texto com "Li e concordo". */
export function TermsCheckbox({ checked, onChange }: TermsCheckboxProps) {
  const [open, setOpen] = useState<'termos' | 'privacidade' | null>(null);
  return (
    <>
      <div className={styles.label}>
        <input
          id="terms-checkbox"
          type="checkbox"
          className={styles.box}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor="terms-checkbox">
          Li e aceito os{' '}
          <button type="button" className={styles.link} onClick={() => setOpen('termos')}>
            Termos de Uso
          </button>{' '}
          e estou ciente da{' '}
          <button type="button" className={styles.link} onClick={() => setOpen('privacidade')}>
            Política de Privacidade
          </button>
          .
        </label>
      </div>
      {open ? (
        <LegalDialog slug={open} onClose={() => setOpen(null)} onAgree={() => onChange(true)} />
      ) : null}
    </>
  );
}
