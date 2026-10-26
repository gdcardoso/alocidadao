import styles from './StatCard.module.css';

export interface StatCardProps {
  label: string;
  value: string;
  help?: string;
  tone?: 'warning';
}

export function StatCard({ label, value, help, tone }: StatCardProps) {
  return (
    <div className={`${styles.card} ${tone === 'warning' ? styles.warning : ''}`} data-tone={tone}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {help ? <span className={styles.help}>{help}</span> : null}
    </div>
  );
}
