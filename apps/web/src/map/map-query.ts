import {
  DEADLINE_FILTERS,
  MAP_STATUS_FILTERS,
  type DeadlineFilter,
  type MapPeriod,
  type MapStatusFilter,
} from '@alocidadao/shared';

/** Filtros da W1 e o ponto aberto, guardados na URL. */
export interface MapQueryState {
  status: MapStatusFilter;
  categoryId: string | null;
  /** Nome do bairro, ou `NO_NEIGHBORHOOD` para as ocorrências sem bairro. */
  neighborhood: string | null;
  days: MapPeriod;
  /** Só com prazo: o mapa mostra apenas ocorrências em atendimento. */
  deadline: DeadlineFilter | null;
  occurrenceId: string | null;
}

export const DEFAULT_MAP_QUERY: MapQueryState = {
  status: 'open_and_in_progress',
  categoryId: null,
  neighborhood: null,
  days: 30,
  deadline: null,
  occurrenceId: null,
};

/** Valor de `?status=` para cada filtro (o padrão não vai para a URL). */
const STATUS_PARAM: Record<MapStatusFilter, string> = {
  open_and_in_progress: 'abertas-em-atendimento',
  open: 'abertas',
  in_progress: 'em-atendimento',
};

/** Valor de `?prazo=` para cada filtro de prazo. */
const DEADLINE_PARAM: Record<DeadlineFilter, string> = {
  on_time: 'no-prazo',
  due_soon: 'vencendo',
  overdue: 'atrasadas',
};

/** Texto do filtro de prazo na barra: `Prazo: todos`. */
export const DEADLINE_FILTER_LABELS: Record<DeadlineFilter, string> = {
  on_time: 'No prazo',
  due_soon: 'Vencendo',
  overdue: 'Atrasadas',
};

const PERIOD_PARAM: Record<string, MapPeriod> = { '7': 7, '30': 30, '90': 90, todo: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null): string | null {
  return value && UUID.test(value) ? value : null;
}

const MAX_NEIGHBORHOOD_LENGTH = 120;

/** Valor de `?bairro=`: texto de 1 a 120 caracteres, ou nulo. */
export function neighborhoodOrNull(value: string | null): string | null {
  return value && value.length <= MAX_NEIGHBORHOOD_LENGTH ? value : null;
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
    neighborhood: neighborhoodOrNull(params.get('bairro')),
    days,
    deadline:
      DEADLINE_FILTERS.find((filter) => DEADLINE_PARAM[filter] === params.get('prazo')) ?? null,
    occurrenceId: uuidOrNull(params.get('ocorrencia')),
  };
}

export function toSearchParams(state: MapQueryState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.status !== DEFAULT_MAP_QUERY.status) params.set('status', STATUS_PARAM[state.status]);
  if (state.categoryId) params.set('categoria', state.categoryId);
  if (state.neighborhood) params.set('bairro', state.neighborhood);
  if (state.days !== DEFAULT_MAP_QUERY.days) {
    params.set('periodo', state.days === null ? 'todo' : String(state.days));
  }
  if (state.deadline) params.set('prazo', DEADLINE_PARAM[state.deadline]);
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
  state: Pick<MapQueryState, 'status' | 'days' | 'categoryId' | 'neighborhood' | 'deadline'>,
) {
  return [
    'occurrences',
    tenantId,
    state.status,
    state.days,
    state.categoryId,
    state.neighborhood,
    state.deadline,
  ] as const;
}

/** Chave dos números da faixa (ignoram status e prazo); também sob `['occurrences', …]`. */
export function mapSummaryKey(
  tenantId: string,
  state: Pick<MapQueryState, 'days' | 'categoryId' | 'neighborhood'>,
) {
  return [
    'occurrences',
    tenantId,
    'summary',
    state.days,
    state.categoryId,
    state.neighborhood,
  ] as const;
}

/**
 * Aplica uma mudança de filtro sem criar combinação vazia: prazo com "abertas" passa para
 * "em atendimento" (só quem está em atendimento tem prazo) e "abertas" tira o prazo.
 */
export function mergeMapPatch(state: MapQueryState, patch: Partial<MapQueryState>): MapQueryState {
  const next = { ...state, ...patch };
  if (patch.deadline && next.status === 'open') next.status = 'in_progress';
  else if (patch.status === 'open' && !patch.deadline) next.deadline = null;
  return next;
}

export type SummaryKey = 'triage' | 'inProgress' | 'dueSoon' | 'overdue';

/** Número da faixa que está ativo pelos filtros, ou nulo. */
export function activeSummaryKey(state: MapQueryState): SummaryKey | null {
  if (state.deadline === 'due_soon' && state.status === 'in_progress') return 'dueSoon';
  if (state.deadline === 'overdue' && state.status === 'in_progress') return 'overdue';
  if (state.deadline === null && state.status === 'open') return 'triage';
  if (state.deadline === null && state.status === 'in_progress') return 'inProgress';
  return null;
}

/** Clique num número da faixa; clicar no ativo volta ao padrão (abertas e em atendimento, prazo todos). */
export function applySummaryClick(state: MapQueryState, key: SummaryKey): MapQueryState {
  if (activeSummaryKey(state) === key) {
    return { ...state, status: DEFAULT_MAP_QUERY.status, deadline: null };
  }
  switch (key) {
    case 'triage':
      return { ...state, status: 'open', deadline: null };
    case 'inProgress':
      return { ...state, status: 'in_progress', deadline: null };
    case 'dueSoon':
      return { ...state, status: 'in_progress', deadline: 'due_soon' };
    case 'overdue':
      return { ...state, status: 'in_progress', deadline: 'overdue' };
  }
}
