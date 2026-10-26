import { Calendar } from 'lucide-react';
import { useId } from 'react';
import { dueDateHint, todayInSaoPaulo } from '../format/due-date';
import { useNow } from '../format/use-now';
import styles from './DueDateField.module.css';

export interface DueDateFieldProps {
  /** Data `YYYY-MM-DD`; vazio enquanto o padrão não chegou. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Texto à direita do rótulo (13 `text-secondary`). */
  hint?: string;
  /** Ajuda abaixo do campo. */
  help?: string;
}

/** Campo de data da W2 e da W4: mínimo hoje (Brasília) e a dica `(N dias)` ao lado. */
export function DueDateField({ value, onChange, label, hint, help }: DueDateFieldProps) {
  const now = useNow();
  const today = todayInSaoPaulo(now);
  const id = useId();
  const helpId = useId();
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      <div className={styles.dateRow}>
        <span className={styles.dateBox}>
          <Calendar size={16} aria-hidden="true" />
          <input
            id={id}
            type="date"
            className={styles.dateInput}
            min={today}
            value={value}
            aria-describedby={help ? helpId : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
        {value ? <span className={styles.dateHint}>{dueDateHint(value, today)}</span> : null}
      </div>
      {help ? (
        <p id={helpId} className={styles.hint}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
