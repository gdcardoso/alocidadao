import type { GeoPoint } from '@alocidadao/shared';
import { Button } from '../ui/Button';
import { BasePickerMap } from './BasePickerMap';
import styles from './Teams.module.css';

export interface BasePickerProps {
  value: GeoPoint | null;
  onChange: (point: GeoPoint | null) => void;
  bounds: [number, number, number, number] | null;
}

/** Ponto da base da equipe: clique no mapa marca, `Remover ponto` limpa. */
export function BasePicker({ value, onChange, bounds }: BasePickerProps) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <span className={styles.label}>Ponto da base</span>
        <span className={styles.hint}>opcional</span>
      </div>
      <BasePickerMap value={value} bounds={bounds} onPick={onChange} />
      <div className={styles.mapRow}>
        <p className={styles.hint}>
          Clique no mapa para marcar a base. Ela é usada para sugerir a equipe mais próxima.
        </p>
        {value ? (
          <Button variant="secondary" size="sm" onClick={() => onChange(null)}>
            Remover ponto
          </Button>
        ) : null}
      </div>
    </div>
  );
}
