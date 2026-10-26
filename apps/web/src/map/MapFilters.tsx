import { MAP_PERIODS, MAP_STATUS_FILTERS, type MapStatusFilter } from '@alocidadao/shared';
import { ChevronDown } from 'lucide-react';
import { periodLabel, STATUS_FILTER_LABELS, type MapQueryState } from './map-query';
import styles from './MapPage.module.css';

export interface CategoryOption {
  id: string;
  name: string;
}

export interface MapFiltersProps {
  state: MapQueryState;
  /** Categorias do alcance, em ordem de nome. */
  categories: readonly CategoryOption[];
  onChange: (patch: Partial<MapQueryState>) => void;
  onClear: () => void;
}

interface FilterSelectProps {
  name: string;
  valueLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * Filtro "Nome: valor" do Pencil (32, raio 8). O `select` nativo fica invisível por cima
 * da pílula: o navegador cuida da lista e do teclado.
 */
export function FilterSelect({ name, valueLabel, value, options, onChange }: FilterSelectProps) {
  return (
    <span className={styles.filter}>
      <span aria-hidden="true">
        {name}: {valueLabel}
      </span>
      <ChevronDown size={16} aria-hidden="true" className={styles.filterChevron} />
      <select
        aria-label={name}
        className={styles.filterSelect}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

const ALL = 'todas';

export function MapFilters({ state, categories, onChange, onClear }: MapFiltersProps) {
  const categoryName = categories.find((item) => item.id === state.categoryId)?.name;
  return (
    <>
      <FilterSelect
        name="Status"
        valueLabel={STATUS_FILTER_LABELS[state.status]}
        value={state.status}
        options={MAP_STATUS_FILTERS.map((status) => ({
          value: status,
          label: STATUS_FILTER_LABELS[status],
        }))}
        onChange={(value) => onChange({ status: value as MapStatusFilter })}
      />
      <FilterSelect
        name="Categoria"
        valueLabel={state.categoryId ? (categoryName ?? '…') : ALL}
        value={state.categoryId ?? ALL}
        options={[
          { value: ALL, label: ALL },
          ...categories.map((item) => ({ value: item.id, label: item.name })),
          // Categoria da URL que ainda não chegou na lista.
          ...(state.categoryId && !categoryName ? [{ value: state.categoryId, label: '…' }] : []),
        ]}
        onChange={(value) => onChange({ categoryId: value === ALL ? null : value })}
      />
      <FilterSelect
        name="Período"
        valueLabel={periodLabel(state.days)}
        value={String(state.days)}
        options={MAP_PERIODS.map((days) => ({ value: String(days), label: periodLabel(days) }))}
        onChange={(value) => {
          // `find` não serve: o período "todo" é `null`.
          const index = MAP_PERIODS.findIndex((days) => String(days) === value);
          if (index >= 0) onChange({ days: MAP_PERIODS[index] });
        }}
      />
      <button type="button" className={styles.clear} onClick={onClear}>
        Limpar filtros
      </button>
    </>
  );
}
