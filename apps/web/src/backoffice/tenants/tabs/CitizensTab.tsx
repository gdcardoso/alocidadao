import {
  CITIZEN_SITUATION_LABELS,
  CITIZEN_SITUATIONS,
  type CitizenListQuery,
  type CitizenRow,
  type CitizenSituation,
} from '@alocidadao/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { formatNumericDateTime } from '../../../format/date';
import { formatLastAccess } from '../../../format/last-active';
import { useNow } from '../../../format/use-now';
import { FilterSelect } from '../../../map/MapFilters';
import { useSession } from '../../../session/SessionProvider';
import { Badge, type BadgeTone } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import { DataTable, type DataTableColumn } from '../../../ui/DataTable';
import type { TenantTabProps } from '../tenant-tabs';
import styles from './CitizensTab.module.css';

const PAGE_SIZE = 50;
const ALL = '';
const SEARCH_DELAY_MS = 300;
const CITIZENS_STALE_MS = 5 * 60_000;

const SITUATION_TONE: Record<CitizenSituation, BadgeTone> = {
  active: 'success',
  inactive: 'muted',
  frozen: 'warning',
};

/** Aba Cidadãos da P3: quem fez solicitação na prefeitura, com celular e e-mail mascarados. */
export function CitizensTab({ tenant }: TenantTabProps) {
  const { session } = useSession();
  const now = useNow();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [situation, setSituation] = useState<CitizenSituation | typeof ALL>(ALL);
  const [page, setPage] = useState(1);

  // Busca por nome com atraso: cada tecla não vira uma consulta.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const params: Partial<CitizenListQuery> = { page };
  if (q) params.q = q;
  if (situation) params.situation = situation;

  const citizens = useQuery({
    queryKey: ['backoffice', 'tenant', tenant.id, 'citizens', params],
    queryFn: () => session.withAuth(() => api.backofficeTenantCitizens(tenant.id, params)),
    placeholderData: keepPreviousData,
    // Abrir a aba grava a consulta na auditoria; voltar à janela ou remontar a aba não deve
    // gravar de novo.
    refetchOnWindowFocus: false,
    staleTime: CITIZENS_STALE_MS,
  });

  const columns: DataTableColumn<CitizenRow>[] = [
    { key: 'name', header: 'Nome', width: 200, render: (row) => row.name },
    {
      key: 'phone',
      header: 'Celular',
      width: 140,
      render: (row) => <span className={styles.muted}>{row.phoneMasked ?? '—'}</span>,
    },
    {
      key: 'email',
      header: 'E-mail',
      width: 190,
      render: (row) => <span className={styles.muted}>{row.emailMasked ?? '—'}</span>,
    },
    { key: 'requests', header: 'Solicitações', width: 110, render: (row) => row.requestCount },
    { key: 'open', header: 'Abertas', width: 80, render: (row) => row.openCount },
    {
      key: 'lastRequest',
      header: 'Última solicitação',
      width: 160,
      render: (row) => (
        <span className={styles.muted}>{formatNumericDateTime(new Date(row.lastRequestAt))}</span>
      ),
    },
    {
      key: 'lastActive',
      header: 'Último acesso',
      width: 140,
      render: (row) => (
        <span className={styles.muted}>
          {formatLastAccess(row.lastActiveAt ? new Date(row.lastActiveAt) : null, now)}
        </span>
      ),
    },
    {
      key: 'situation',
      header: 'Situação',
      width: 110,
      render: (row) => (
        <Badge tone={SITUATION_TONE[row.situation]}>
          {CITIZEN_SITUATION_LABELS[row.situation]}
        </Badge>
      ),
    },
  ];

  const data = citizens.data;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtered = q !== '' || situation !== ALL;
  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const lastItem = firstItem + rows.length - 1;

  return (
    <div className={styles.column}>
      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          placeholder="Buscar por nome"
          aria-label="Buscar por nome"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <FilterSelect
          name="Situação"
          valueLabel={situation ? CITIZEN_SITUATION_LABELS[situation] : 'todas'}
          value={situation}
          options={[
            { value: ALL, label: 'todas' },
            ...CITIZEN_SITUATIONS.map((value) => ({
              value,
              label: CITIZEN_SITUATION_LABELS[value],
            })),
          ]}
          onChange={(value) => {
            setSituation(value as CitizenSituation | typeof ALL);
            setPage(1);
          }}
        />
      </div>
      {citizens.isError ? (
        <div role="alert" className={styles.error}>
          <p>Não foi possível carregar os cidadãos.</p>
          <Button variant="secondary" size="sm" onClick={() => void citizens.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
      {citizens.isPending && !citizens.isError ? <p className={styles.state}>Carregando…</p> : null}
      {data && rows.length === 0 ? (
        <p className={styles.state}>
          {filtered
            ? 'Nenhum cidadão com estes filtros.'
            : 'Ninguém fez solicitação nesta cidade ainda.'}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.name}
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
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={lastItem >= total}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
