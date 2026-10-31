import {
  MAP_PERIODS,
  MAP_STATUS_FILTERS,
  NO_NEIGHBORHOOD,
  type MapStatusFilter,
} from '@alocidadao/shared';
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
  /** Bairros da prefeitura; vazio esconde o filtro. */
  neighborhoods: readonly string[];
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
// Vazio não colide com nenhum nome de bairro.
const ALL_NEIGHBORHOODS = '';
const NO_NEIGHBORHOOD_LABEL = 'Sem bairro';

interface NeighborhoodFilterProps {
  neighborhoods: readonly string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Filtro "Bairro: todos", com "Sem bairro" por último. Quem usa só o mostra se houver bairros. */
export function NeighborhoodFilter({ neighborhoods, value, onChange }: NeighborhoodFilterProps) {
  const unknown =
    value !== null && value !== NO_NEIGHBORHOOD && !neighborhoods.includes(value) ? value : null;
  return (
    <FilterSelect
      name="Bairro"
      valueLabel={
        value === null ? 'todos' : value === NO_NEIGHBORHOOD ? NO_NEIGHBORHOOD_LABEL : value
      }
      value={value ?? ALL_NEIGHBORHOODS}
      options={[
        { value: ALL_NEIGHBORHOODS, label: 'todos' },
        ...neighborhoods.map((name) => ({ value: name, label: name })),
        // Bairro da URL que não está na lista.
        ...(unknown ? [{ value: unknown, label: unknown }] : []),
        { value: NO_NEIGHBORHOOD, label: NO_NEIGHBORHOOD_LABEL },
      ]}
      onChange={(next) => onChange(next === ALL_NEIGHBORHOODS ? null : next)}
    />
  );
}

export function MapFilters({
  state,
  categories,
  neighborhoods,
  onChange,
  onClear,
}: MapFiltersProps) {
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
      {neighborhoods.length > 0 ? (
        <NeighborhoodFilter
          neighborhoods={neighborhoods}
          value={state.neighborhood}
          onChange={(neighborhood) => onChange({ neighborhood })}
        />
      ) : null}
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
