import { MAP_STATUS_FILTERS, type MapPeriod, type MapStatusFilter } from '@alocidadao/shared';

/** Filtros da W1 e o ponto aberto, guardados na URL. */
export interface MapQueryState {
  status: MapStatusFilter;
  categoryId: string | null;
  days: MapPeriod;
  occurrenceId: string | null;
}

export const DEFAULT_MAP_QUERY: MapQueryState = {
  status: 'open_and_in_progress',
  categoryId: null,
  days: 30,
  occurrenceId: null,
};

/** Valor de `?status=` para cada filtro (o padrão não vai para a URL). */
const STATUS_PARAM: Record<MapStatusFilter, string> = {
  open_and_in_progress: 'abertas-em-atendimento',
  open: 'abertas',
  in_progress: 'em-atendimento',
};

const PERIOD_PARAM: Record<string, MapPeriod> = { '7': 7, '30': 30, '90': 90, todo: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null): string | null {
  return value && UUID.test(value) ? value : null;
}

export function parseMapQuery(params: URLSearchParams): MapQueryState {
  const statusParam = params.get('status');
  const status =
    MAP_STATUS_FILTERS.find((filter) => STATUS_PARAM[filter] === statusParam) ??
    DEFAULT_MAP_QUERY.status;
  const periodParam = params.get('periodo');
  const days =
    periodParam !== null && periodParam in PERIOD_PARAM
      ? (PERIOD_PARAM[periodParam] as MapPeriod)
      : DEFAULT_MAP_QUERY.days;
  return {
    status,
    categoryId: uuidOrNull(params.get('categoria')),
    days,
    occurrenceId: uuidOrNull(params.get('ocorrencia')),
  };
}

export function toSearchParams(state: MapQueryState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.status !== DEFAULT_MAP_QUERY.status) params.set('status', STATUS_PARAM[state.status]);
  if (state.categoryId) params.set('categoria', state.categoryId);
  if (state.days !== DEFAULT_MAP_QUERY.days) {
    params.set('periodo', state.days === null ? 'todo' : String(state.days));
  }
  if (state.occurrenceId) params.set('ocorrencia', state.occurrenceId);
  return params;
}

/** Texto do filtro de status, no plural e no singular. */
const STATUS_WORDS: Record<MapStatusFilter, { one: string; many: string }> = {
  open_and_in_progress: { one: 'aberta e em atendimento', many: 'abertas e em atendimento' },
  open: { one: 'aberta', many: 'abertas' },
  in_progress: { one: 'em atendimento', many: 'em atendimento' },
};

/** Valor do filtro de status na barra: `Status: abertas, em atendimento`. */
export const STATUS_FILTER_LABELS: Record<MapStatusFilter, string> = {
  open_and_in_progress: 'abertas, em atendimento',
  open: 'abertas',
  in_progress: 'em atendimento',
};

export function periodLabel(days: MapPeriod): string {
  return days === null ? 'todo o período' : `${days} dias`;
}

/** Apoio do título: `148 ocorrências abertas e em atendimento · últimos 30 dias`. */
export function mapSubtitle(total: number, state: Pick<MapQueryState, 'status' | 'days'>): string {
  const words = STATUS_WORDS[state.status];
  const count =
    total === 1
      ? `1 ocorrência ${words.one}`
      : `${total.toLocaleString('pt-BR')} ocorrências ${words.many}`;
  const period = state.days === null ? 'todo o período' : `últimos ${state.days} dias`;
  return `${count} · ${period}`;
}

const PROTOCOL = /^\d{4}-\d{1,6}$/;
const MIN_ADDRESS_LENGTH = 3;

/** O texto vale uma busca: protocolo (`2026-123`) ou endereço com pelo menos 3 letras. */
export function isSearchable(text: string): boolean {
  const value = text.trim();
  return PROTOCOL.test(value) || value.length >= MIN_ADDRESS_LENGTH;
}

/**
 * Opções do filtro de categoria. Não há rota de categorias: elas saem do mapa com o mesmo
 * status e período, sem o filtro de categoria, para a lista não encolher quando uma está
 * escolhida. Uma por id, em ordem de nome.
 */
export function categoriesOf(
  items: readonly { categoryId: string; categoryName: string }[],
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) byId.set(item.categoryId, item.categoryName);
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Chave do mapa: `['occurrences', …]`, que as ações invalidam pelo prefixo. */
export function mapOccurrencesKey(
  tenantId: string,
  state: Pick<MapQueryState, 'status' | 'days' | 'categoryId'>,
) {
  return ['occurrences', tenantId, state.status, state.days, state.categoryId] as const;
}
