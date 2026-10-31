import {
  AUDIT_PAGE_SIZE,
  STAFF_AUDIT_ACTION_LABELS,
  type AuditQuery,
  type AuditRow,
} from '@alocidadao/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api';
import { formatNumericDateTime } from '../../format/date';
import { FilterSelect } from '../../map/MapFilters';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { STAFF_KEY } from '../staff/staff-keys';
import styles from './AuditPage.module.css';

const ALL = '';
const FALLBACK_ACTION_LABEL = 'Fez uma alteração';

type FilterKey = 'prefeitura' | 'pessoa' | 'de' | 'ate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validUuid = (value: string | null) => (value && UUID.test(value) ? value : undefined);

/** Só `yyyy-mm-dd` de um dia que existe; o resto é ignorado. */
function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

const actionLabel = (action: string): string =>
  (STAFF_AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? FALLBACK_ACTION_LABEL;

const allColumns: DataTableColumn<AuditRow>[] = [
  {
    key: 'at',
    header: 'Quando',
    width: 170,
    render: (row) => (
      <span className={styles.muted}>{formatNumericDateTime(new Date(row.at))}</span>
    ),
  },
  { key: 'staff', header: 'Pessoa', width: 180, render: (row) => row.staffName },
  { key: 'tenant', header: 'Prefeitura', width: 220, render: (row) => row.tenantName ?? '—' },
  { key: 'action', header: 'Ação', width: 280, render: (row) => actionLabel(row.action) },
  { key: 'target', header: 'Alvo', width: 220, render: (row) => row.targetLabel || '—' },
];

export interface AuditViewProps {
  /** Só quem é Admin consulta; a tela e a aba já conferem o papel. */
  enabled: boolean;
  /** Prefeitura fixa (aba da P3): ignora `?prefeitura=` e esconde o filtro. */
  tenantId?: string;
  /** Monta o enquadramento: a P7 põe os filtros na barra do topo; a aba, numa linha acima. */
  frame?: (filters: ReactNode, content: ReactNode) => ReactNode;
}

const defaultFrame = (filters: ReactNode, content: ReactNode) => (
  <>
    <div className={styles.filterRow}>{filters}</div>
    <div className={styles.tabContent}>{content}</div>
  </>
);

/** Tabela de auditoria com filtros e paginação, guardados na URL. */
export function AuditView({
  enabled,
  tenantId: fixedTenantId,
  frame = defaultFrame,
}: AuditViewProps) {
  const { session } = useSession();
  const isAdmin = enabled;
  const [params, setParams] = useSearchParams();
  const fixed = fixedTenantId !== undefined;
  const columns = fixed ? allColumns.filter((column) => column.key !== 'tenant') : allColumns;

  const tenantId = fixed ? fixedTenantId : validUuid(params.get('prefeitura'));
  const staffUserId = validUuid(params.get('pessoa'));
  const from = validDate(params.get('de'));
  const to = validDate(params.get('ate'));
  const requested = Number(params.get('pagina'));
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const query: Partial<AuditQuery> = { page };
  if (tenantId) query.tenantId = tenantId;
  if (staffUserId) query.staffUserId = staffUserId;
  if (from) query.from = from;
  if (to) query.to = to;

  const audit = useQuery({
    queryKey: ['backoffice', 'audit', query],
    queryFn: () => session.withAuth(() => api.backofficeAudit(query)),
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  });
  const tenants = useQuery({
    queryKey: ['backoffice', 'tenants'],
    queryFn: () => session.withAuth(() => api.backofficeTenants()),
    enabled: isAdmin && !fixed,
  });
  const staff = useQuery({
    queryKey: STAFF_KEY,
    queryFn: () => session.withAuth(() => api.backofficeStaff()),
    enabled: isAdmin,
  });

  const data = audit.data;
  const beyondLast =
    Boolean(data) && !audit.isPlaceholderData && page > 1 && data!.items.length === 0;
  // `?pagina=` além da última: a API devolve vazio; volta para a página 1.
  useEffect(() => {
    if (!beyondLast) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  }, [beyondLast, setParams]);

  /** Mudar um filtro volta para a página 1. */
  function setFilter(key: FilterKey, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('pagina');
      return next;
    });
  }

  function goToPage(target: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (target > 1) next.set('pagina', String(target));
      else next.delete('pagina');
      return next;
    });
  }

  const tenantOptions = tenants.data?.items ?? [];
  const staffOptions = staff.data?.items ?? [];
  const tenantName = tenantOptions.find((item) => item.id === tenantId)?.displayName;
  const staffName = staffOptions.find((item) => item.userId === staffUserId)?.name;

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const firstItem = (page - 1) * AUDIT_PAGE_SIZE + 1;
  const lastItem = firstItem + rows.length - 1;

  return frame(
    <>
      {fixed ? null : (
        <FilterSelect
          name="Prefeitura"
          valueLabel={tenantId ? (tenantName ?? '…') : 'todas'}
          value={tenantId ?? ALL}
          options={[
            { value: ALL, label: 'todas' },
            ...tenantOptions.map((item) => ({ value: item.id, label: item.displayName })),
            ...(tenantId && !tenantName ? [{ value: tenantId, label: '…' }] : []),
          ]}
          onChange={(value) => setFilter('prefeitura', value)}
        />
      )}
      <FilterSelect
        name="Pessoa"
        valueLabel={staffUserId ? (staffName ?? '…') : 'todas'}
        value={staffUserId ?? ALL}
        options={[
          { value: ALL, label: 'todas' },
          ...staffOptions.map((item) => ({ value: item.userId, label: item.name })),
          ...(staffUserId && !staffName ? [{ value: staffUserId, label: '…' }] : []),
        ]}
        onChange={(value) => setFilter('pessoa', value)}
      />
      <label className={styles.dateField}>
        De
        <input
          type="date"
          className={styles.dateInput}
          value={from ?? ''}
          max={to}
          onChange={(event) => setFilter('de', event.target.value)}
        />
      </label>
      <label className={styles.dateField}>
        Até
        <input
          type="date"
          className={styles.dateInput}
          value={to ?? ''}
          min={from}
          onChange={(event) => setFilter('ate', event.target.value)}
        />
      </label>
    </>,
    <>
      {audit.isError ? (
        <div role="alert" className={styles.error}>
          <p>Não foi possível carregar a auditoria.</p>
          <Button variant="secondary" size="sm" onClick={() => void audit.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
      {audit.isPending && !audit.isError ? <p className={styles.state}>Carregando…</p> : null}
      {data && rows.length === 0 && !beyondLast ? (
        <p className={styles.state}>Nenhuma ação com estes filtros.</p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => `${row.staffName}, ${actionLabel(row.action)}`}
          />
          <div className={styles.footer}>
            <span>
              {firstItem}–{lastItem} de {total}
            </span>
            <div className={styles.pager}>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={lastItem >= total}
                onClick={() => goToPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </>,
  );
}
