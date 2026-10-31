import { ApiError } from '@alocidadao/api-client';
import {
  MAP_PERIODS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUSES,
  REQUESTS_PAGE_SIZE,
  type MapPeriod,
  type RequestRow,
  type RequestStatus,
} from '@alocidadao/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatDate } from '../format/date';
import { knownNeighborhood, neighborhoodOrNull, periodLabel } from '../map/map-query';
import { FilterSelect, NeighborhoodFilter } from '../map/MapFilters';
import { useNeighborhoods } from '../map/use-neighborhoods';
import { OccurrenceDrawer } from '../occurrence/OccurrenceDrawer';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { Badge } from '../ui/Badge';
import { CategorySquare } from '../ui/CategorySquare';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { TopBar } from '../ui/TopBar';
import styles from './Lists.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL = 'todas';
const DEFAULT_DAYS: MapPeriod = 30;
const SEARCH_DEBOUNCE_MS = 300;

/** Valor de `?periodo=` (o padrão não vai para a URL), como no mapa. */
const PERIOD_PARAM: Record<string, MapPeriod> = { '7': 7, '30': 30, '90': 90, todo: null };

function periodParam(days: MapPeriod): string {
  return days === null ? 'todo' : String(days);
}

function subtitle(total: number, days: MapPeriod): string {
  const count = total === 1 ? '1 solicitação' : `${total} solicitações`;
  return `${count} · ${days === null ? 'todo o período' : `últimos ${days} dias`}`;
}

const columns: DataTableColumn<RequestRow>[] = [
  {
    key: 'protocol',
    header: 'Protocolo',
    width: 150,
    render: (row) => <span className={styles.name}>{row.protocol}</span>,
  },
  {
    key: 'category',
    header: 'Categoria',
    width: 250,
    render: (row) => (
      <div className={styles.cell}>
        <CategorySquare icon={row.icon ?? 'circle-ellipsis'} iconGroup={row.iconGroup} size={32} />
        <span className={styles.name}>{row.categoryName}</span>
      </div>
    ),
  },
  { key: 'place', header: 'Local', width: 280, render: (row) => row.address ?? '—' },
  {
    key: 'status',
    header: 'Status',
    width: 200,
    render: (row) => <Badge>{REQUEST_STATUS_LABELS[row.status]}</Badge>,
  },
  {
    key: 'createdAt',
    header: 'Aberta em',
    width: 130,
    render: (row) => <span className={styles.muted}>{formatDate(new Date(row.createdAt))}</span>,
  },
];

/** W · Todas as solicitações: lista paginada com filtros na URL e a gaveta do ponto. */
export function RequestsPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();

  const statusParam = params.get('status');
  const status = REQUEST_STATUSES.find((item) => item === statusParam) ?? null;
  const rawCategory = params.get('categoria');
  const categoryId = rawCategory && UUID.test(rawCategory) ? rawCategory : null;
  const neighborhoods = useNeighborhoods();
  // Bairro fora da lista da prefeitura (ou prefeitura sem bairros): o `?bairro=` é ignorado.
  const neighborhood = knownNeighborhood(
    neighborhoodOrNull(params.get('bairro')),
    neighborhoods.items,
  );
  const rawPeriod = params.get('periodo');
  const days: MapPeriod =
    rawPeriod !== null && rawPeriod in PERIOD_PARAM
      ? (PERIOD_PARAM[rawPeriod] as MapPeriod)
      : DEFAULT_DAYS;
  const term = params.get('q') ?? '';
  const rawPage = params.get('pagina');
  const page = rawPage && /^\d+$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const occurrenceParam = params.get('ocorrencia');

  /** Muda parâmetros da URL; trocar um filtro volta à página 1. */
  function update(
    patch: Partial<{
      status: RequestStatus | null;
      categoryId: string | null;
      neighborhood: string | null;
      days: MapPeriod;
      q: string;
      page: number;
      occurrenceId: string;
    }>,
  ) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        const set = (key: string, value: string | null) => {
          if (value) search.set(key, value);
          else search.delete(key);
        };
        if ('status' in patch) set('status', patch.status ?? null);
        if ('categoryId' in patch) set('categoria', patch.categoryId ?? null);
        if ('neighborhood' in patch) set('bairro', patch.neighborhood ?? null);
        if ('days' in patch)
          set('periodo', patch.days === DEFAULT_DAYS ? null : periodParam(patch.days ?? null));
        if ('q' in patch) set('q', patch.q ?? null);
        if ('occurrenceId' in patch) set('ocorrencia', patch.occurrenceId ?? null);
        if ('page' in patch)
          set('pagina', patch.page && patch.page > 1 ? String(patch.page) : null);
        else if (!('occurrenceId' in patch)) search.delete('pagina');
        return search;
      },
      { replace: true },
    );
  }

  // Texto da busca: vai para a URL depois de uma pausa na digitação.
  const [text, setText] = useState(term);
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === term) return;
    const timer = setTimeout(() => update({ q: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  function fetchList(category: string | null, pageNumber: number) {
    return session.withAuth(() =>
      api.panelRequests(tenantId, {
        ...(status ? { status } : {}),
        ...(category ? { categoryId: category } : {}),
        ...(neighborhood ? { neighborhood } : {}),
        days,
        q: term,
        page: pageNumber,
      }),
    );
  }

  // A chave começa com 'requests': as ações do painel invalidam esse prefixo.
  const list = useQuery({
    queryKey: ['requests', tenantId, status, categoryId, neighborhood, days, term, page],
    queryFn: () => fetchList(categoryId, page),
    enabled: !neighborhoods.isPending,
    placeholderData: keepPreviousData,
  });
  // Opções de categoria: as do alcance, vindas da rota própria.
  const optionsQuery = useQuery({
    queryKey: ['category-options', tenantId],
    queryFn: () => session.withAuth(() => api.panelCategoryOptions(tenantId)),
    staleTime: 60_000,
  });
  const categories = optionsQuery.data?.items ?? [];
  const categoryName = categories.find((item) => item.id === categoryId)?.name;

  const data = list.data;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = (page - 1) * REQUESTS_PAGE_SIZE + 1;
  const to = from + rows.length - 1;
  // `?pagina=` além da última: volta para a última página.
  const lastPage = Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE));
  const beyondLast = Boolean(data) && !list.isPlaceholderData && total > 0 && page > lastPage;
  useEffect(() => {
    if (beyondLast) update({ page: lastPage });
  });
  const error = list.error
    ? list.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  return (
    <div className={styles.page}>
      <TopBar
        title="Todas as solicitações"
        subtitle={data ? subtitle(data.total, days) : undefined}
        filters={
          <>
            <FilterSelect
              name="Status"
              valueLabel={status ? REQUEST_STATUS_LABELS[status] : 'todos'}
              value={status ?? ALL}
              options={[
                { value: ALL, label: 'todos' },
                ...REQUEST_STATUSES.map((item) => ({
                  value: item,
                  label: REQUEST_STATUS_LABELS[item],
                })),
              ]}
              onChange={(value) =>
                update({ status: REQUEST_STATUSES.find((item) => item === value) ?? null })
              }
            />
            <FilterSelect
              name="Categoria"
              valueLabel={categoryId ? (categoryName ?? '…') : ALL}
              value={categoryId ?? ALL}
              options={[
                { value: ALL, label: ALL },
                ...categories.map((item) => ({ value: item.id, label: item.name })),
                ...(categoryId && !categoryName ? [{ value: categoryId, label: '…' }] : []),
              ]}
              onChange={(value) => update({ categoryId: value === ALL ? null : value })}
            />
            {neighborhoods.enabled ? (
              <NeighborhoodFilter
                neighborhoods={neighborhoods.items}
                value={neighborhood}
                onChange={(value) => update({ neighborhood: value })}
              />
            ) : null}
            <FilterSelect
              name="Período"
              valueLabel={periodLabel(days)}
              value={periodParam(days)}
              options={MAP_PERIODS.map((item) => ({
                value: periodParam(item),
                label: periodLabel(item),
              }))}
              onChange={(value) => update({ days: PERIOD_PARAM[value] ?? DEFAULT_DAYS })}
            />
            <input
              type="search"
              aria-label="Buscar endereço ou protocolo"
              placeholder="Buscar endereço ou protocolo"
              className={styles.searchInput}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </>
        }
      />
      <div className={styles.area}>
        <div className={styles.content}>
          {error ? <p className={styles.state}>{error}</p> : null}
          {data && rows.length === 0 && !beyondLast ? (
            <p className={styles.state}>Nenhuma solicitação com estes filtros.</p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.requestId}
                rowLabel={(row) => `Abrir ${row.protocol}`}
                isSelected={(row) => row.occurrenceId === occurrenceParam}
                onRowClick={(row) => update({ occurrenceId: row.occurrenceId })}
              />
              <div className={styles.footer}>
                <span>
                  {from}–{to} de {total}
                </span>
                <div className={styles.pager}>
                  <button
                    type="button"
                    className={styles.pagerButton}
                    disabled={page <= 1}
                    onClick={() => update({ page: page - 1 })}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className={styles.pagerButton}
                    disabled={to >= total}
                    onClick={() => update({ page: page + 1 })}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <OccurrenceDrawer tenantId={tenantId} />
      </div>
    </div>
  );
}
