import {
  ACTIVE_WORK_ORDER_STATUSES,
  WORK_ORDER_STATUS_LABELS,
  type InProgressRow,
  type WorkOrderStatus,
} from '@alocidadao/shared';
import { ApiError } from '@alocidadao/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { formatDayMonth } from '../format/date';
import { formatElapsedShort } from '../format/elapsed';
import { useNow } from '../format/use-now';
import { FilterSelect, NeighborhoodFilter } from '../map/MapFilters';
import { knownNeighborhood, neighborhoodOrNull } from '../map/map-query';
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

function subtitle(total: number): string {
  return total === 1 ? '1 ocorrência em atendimento' : `${total} ocorrências em atendimento`;
}

/** W · Em atendimento: ocorrências com atividade ativa, pelo prazo, com a gaveta do ponto. */
export function InProgressPage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const rawCategory = params.get('categoria');
  const categoryId = rawCategory && UUID.test(rawCategory) ? rawCategory : null;
  const rawStatus = params.get('atividade');
  const workOrderStatus = ACTIVE_WORK_ORDER_STATUSES.find((status) => status === rawStatus) ?? null;
  const occurrenceId = params.get('ocorrencia');
  const neighborhoods = useNeighborhoods();
  // Bairro fora da lista da prefeitura (ou prefeitura sem bairros): o `?bairro=` é ignorado.
  const neighborhood = knownNeighborhood(
    neighborhoodOrNull(params.get('bairro')),
    neighborhoods.items,
  );
  const now = useNow();

  function update(patch: {
    categoryId?: string | null;
    neighborhood?: string | null;
    workOrderStatus?: WorkOrderStatus | null;
  }) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        if ('categoryId' in patch) {
          if (patch.categoryId) search.set('categoria', patch.categoryId);
          else search.delete('categoria');
        }
        if ('neighborhood' in patch) {
          if (patch.neighborhood) search.set('bairro', patch.neighborhood);
          else search.delete('bairro');
        }
        if ('workOrderStatus' in patch) {
          if (patch.workOrderStatus) search.set('atividade', patch.workOrderStatus);
          else search.delete('atividade');
        }
        return search;
      },
      { replace: true },
    );
  }

  function fetchList(category: string | null) {
    return session.withAuth(() =>
      api.panelInProgress(tenantId, {
        ...(category ? { categoryId: category } : {}),
        ...(neighborhood ? { neighborhood } : {}),
        ...(workOrderStatus ? { workOrderStatus } : {}),
      }),
    );
  }

  // A chave começa com 'in-progress': as ações do painel invalidam esse prefixo.
  const list = useQuery({
    queryKey: ['in-progress', tenantId, categoryId, neighborhood, workOrderStatus],
    queryFn: () => fetchList(categoryId),
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
  const error = list.error
    ? list.error instanceof ApiError
      ? UNEXPECTED_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE
    : null;

  const columns: DataTableColumn<InProgressRow>[] = [
    {
      key: 'occurrence',
      header: 'Ocorrência',
      width: 280,
      render: (row) => (
        <div className={styles.cell}>
          <CategorySquare
            icon={row.icon ?? 'circle-ellipsis'}
            iconGroup={row.iconGroup}
            size={36}
          />
          <div className={styles.cellText}>
            <strong>{row.categoryName}</strong>
            <span className={styles.protocol}>{row.protocol}</span>
          </div>
        </div>
      ),
    },
    { key: 'place', header: 'Local', width: 230, render: (row) => row.address ?? '—' },
    {
      key: 'team',
      header: 'Equipe',
      width: 190,
      render: (row) => <span className={styles.muted}>{row.teamName}</span>,
    },
    {
      key: 'activity',
      header: 'Atividade',
      width: 170,
      render: (row) => <Badge>{WORK_ORDER_STATUS_LABELS[row.workOrderStatus]}</Badge>,
    },
    {
      key: 'due',
      header: 'Prazo',
      width: 100,
      render: (row) => {
        if (!row.dueAt) return '—';
        const due = new Date(row.dueAt);
        return (
          <span
            className={due.getTime() < now.getTime() ? styles.overdue : undefined}
            data-overdue={due.getTime() < now.getTime()}
          >
            {formatDayMonth(due)}
          </span>
        );
      },
    },
    {
      key: 'since',
      header: 'Em atendimento há',
      width: 150,
      render: (row) => formatElapsedShort(new Date(row.statusSince), now),
    },
  ];

  return (
    <div className={styles.page}>
      <TopBar
        title="Em atendimento"
        subtitle={data ? subtitle(data.total) : undefined}
        filters={
          <>
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
              name="Atividade"
              valueLabel={workOrderStatus ? WORK_ORDER_STATUS_LABELS[workOrderStatus] : ALL}
              value={workOrderStatus ?? ALL}
              options={[
                { value: ALL, label: ALL },
                ...ACTIVE_WORK_ORDER_STATUSES.map((status) => ({
                  value: status,
                  label: WORK_ORDER_STATUS_LABELS[status],
                })),
              ]}
              onChange={(value) =>
                update({
                  workOrderStatus:
                    ACTIVE_WORK_ORDER_STATUSES.find((status) => status === value) ?? null,
                })
              }
            />
          </>
        }
      />
      <div className={styles.area}>
        <div className={styles.content}>
          {error ? <p className={styles.state}>{error}</p> : null}
          {data && rows.length === 0 ? (
            <p className={styles.state}>Nenhuma ocorrência em atendimento.</p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.occurrenceId}
                rowLabel={(row) => `Abrir ${row.protocol}`}
                isSelected={(row) => row.occurrenceId === occurrenceId}
                onRowClick={(row) =>
                  setParams(
                    (previous) => {
                      const search = new URLSearchParams(previous);
                      search.set('ocorrencia', row.occurrenceId);
                      return search;
                    },
                    { replace: true },
                  )
                }
              />
              <p className={styles.footer}>
                Mostrando {rows.length} de {data?.total ?? rows.length}
              </p>
            </>
          ) : null}
        </div>
        <OccurrenceDrawer tenantId={tenantId} />
      </div>
    </div>
  );
}
