import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './TopBar.module.css';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  /** Botão à direita do título. */
  actions?: ReactNode;
  /** Linha de filtros (W1/W2/W5). Com ela, a barra fica na variante "com filtros". */
  filters?: ReactNode;
  /** Seta de voltar à esquerda do título (P2). */
  onBack?: () => void;
}

/**
 * Barra superior em três variantes do Pencil:
 * - com `filters`: título + ação, e a linha de filtros embaixo;
 * - só `actions`: título e botão na mesma linha (W6/W7);
 * - nenhum dos dois: simples (W3/W4).
 */
export function TopBar({ title, subtitle, actions, filters, onBack }: TopBarProps) {
  const titles = (
    <div className={styles.titles}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );

  if (onBack) {
    return (
      <header className={`${styles.bar} ${styles.withAction}`}>
        <button type="button" className={styles.back} aria-label="Voltar" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden />
        </button>
        {titles}
        {actions}
      </header>
    );
  }
  if (filters) {
    return (
      <header className={`${styles.bar} ${styles.withFilters}`}>
        <div className={styles.row}>
          {titles}
          {actions}
        </div>
        <div className={styles.filters}>{filters}</div>
      </header>
    );
  }
  if (actions) {
    return (
      <header className={`${styles.bar} ${styles.withAction}`}>
        {titles}
        {actions}
      </header>
    );
  }
  return <header className={`${styles.bar} ${styles.simple}`}>{titles}</header>;
}
