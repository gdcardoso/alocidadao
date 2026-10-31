import { DEADLINE_PIN_COLORS } from './map-style';
import styles from './MapPage.module.css';

const ITEMS = [
  { color: DEADLINE_PIN_COLORS.on_time, label: 'No prazo' },
  { color: DEADLINE_PIN_COLORS.due_soon, label: 'Vence em até 2 dias' },
  { color: DEADLINE_PIN_COLORS.overdue, label: 'Atrasada' },
  { color: DEADLINE_PIN_COLORS.none, label: 'Na triagem (sem prazo)' },
] as const;

/** Legenda do mapa (canto inferior esquerdo): a cor do pino é a situação do prazo. */
export function MapLegend() {
  return (
    <div className={styles.legend}>
      <p className={styles.legendTitle}>Situação do prazo</p>
      <ul className={styles.legendList}>
        {ITEMS.map((item) => (
          <li key={item.label}>
            <span className={styles.legendDot} style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
      <p className={styles.legendNote}>Número = relatos no ponto</p>
    </div>
  );
}
