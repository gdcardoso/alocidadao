import type { OccurrenceSummary } from '@alocidadao/shared';
import type { SummaryKey } from './map-query';
import styles from './SummaryStrip.module.css';

const ITEMS: { key: SummaryKey; label: string; tone?: 'warning' | 'danger' }[] = [
  { key: 'triage', label: 'Na triagem' },
  { key: 'inProgress', label: 'Em atendimento' },
  { key: 'dueSoon', label: 'Vencem em 2 dias', tone: 'warning' },
  { key: 'overdue', label: 'Atrasadas', tone: 'danger' },
];

export interface SummaryStripProps {
  /** Nulo enquanto carrega: os números aparecem como "–". */
  summary: OccurrenceSummary | undefined;
  active: SummaryKey | null;
  onClick: (key: SummaryKey) => void;
}

/** Faixa de números abaixo dos filtros; cada um é um botão que filtra o mapa. */
export function SummaryStrip({ summary, active, onClick }: SummaryStripProps) {
  return (
    <div className={styles.strip} role="group" aria-label="Resumo das ocorrências">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`${styles.card} ${item.tone ? styles[item.tone] : ''}`}
          aria-label={`${item.label}: ${summary ? summary[item.key] : 'carregando'}`}
          aria-pressed={active === item.key}
          onClick={() => onClick(item.key)}
        >
          <span className={styles.label}>{item.label}</span>
          <span className={styles.value}>
            {summary ? summary[item.key].toLocaleString('pt-BR') : '–'}
          </span>
        </button>
      ))}
    </div>
  );
}
