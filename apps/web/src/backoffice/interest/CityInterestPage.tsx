import {
  COMMERCIAL_STATUS_LABELS,
  COMMERCIAL_STATUSES,
  type CityInterestRow,
} from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { formatNumericDate } from '../../format/date';
import { useSession } from '../../session/SessionProvider';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { RowMenu } from '../../ui/RowMenu';
import { useToast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { generalErrorMessage } from '../../teams/team-errors';
import { CITY_INTEREST_KEY } from './interest-keys';
import styles from './CityInterestPage.module.css';

const FILE_NAME = 'interesse-por-cidade.csv';

// Pencil: "Sem contato" é `bg`; as situações em andamento são `primary-soft`.
const STATUS_TONE: Record<CityInterestRow['commercialStatus'], BadgeTone> = {
  new: 'subtle',
  contacted: 'primary',
  proposal_sent: 'primary',
  negotiating: 'primary',
  won: 'success',
  lost: 'muted',
};

const cityLabel = (row: CityInterestRow) => `${row.name} — ${row.state}`;

/** P5 · Interesse por cidade: ranking do comercial. Admin e Suporte. */
export function CityInterestPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: CITY_INTEREST_KEY,
    queryFn: () => session.withAuth(() => api.backofficeCityInterest()),
  });

  const setStatus = useMutation({
    mutationFn: (variables: {
      row: CityInterestRow;
      status: CityInterestRow['commercialStatus'];
    }) =>
      session.withAuth(() => api.backofficeSetLeadStatus(variables.row.ibgeCode, variables.status)),
    onSuccess: async (_result, { row, status }) => {
      await queryClient.invalidateQueries({ queryKey: CITY_INTEREST_KEY });
      toast.show(`${cityLabel(row)}: ${COMMERCIAL_STATUS_LABELS[status]}.`);
    },
    onError: (error) => setActionError(generalErrorMessage(error)),
  });

  const exportCsv = useMutation({
    mutationFn: () => session.withAuth(() => api.backofficeCityInterestCsv()),
    onSuccess: (text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    onError: (error) => setActionError(generalErrorMessage(error)),
  });

  const columns: DataTableColumn<CityInterestRow>[] = [
    {
      key: 'position',
      header: '#',
      width: 50,
      render: (row) => (
        <span className={styles.muted}>{(query.data?.items.indexOf(row) ?? 0) + 1}</span>
      ),
    },
    {
      key: 'city',
      header: 'Município',
      width: 260,
      render: (row) => (
        <span className={styles.cityCell}>
          <span className={styles.city}>{cityLabel(row)}</span>
          {row.isCustomer ? <Badge tone="success">Já é cliente</Badge> : null}
        </span>
      ),
    },
    {
      key: 'requests',
      header: 'Pedidos',
      width: 120,
      render: (row) => <span className={styles.count}>{row.requestCount}</span>,
    },
    {
      key: 'recent',
      header: 'Últimos 30 dias',
      width: 150,
      render: (row) => <span className={styles.recent}>+{row.last30Days}</span>,
    },
    {
      key: 'first',
      header: 'Primeiro pedido',
      width: 160,
      render: (row) => (
        <span className={styles.muted}>{formatNumericDate(new Date(row.firstAt))}</span>
      ),
    },
    {
      key: 'status',
      header: 'Situação comercial',
      width: 220,
      render: (row) => (
        <Badge tone={STATUS_TONE[row.commercialStatus]}>
          {COMMERCIAL_STATUS_LABELS[row.commercialStatus]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 100,
      render: (row) => (
        <RowMenu
          label={cityLabel(row)}
          items={COMMERCIAL_STATUSES.map((status) => ({
            label: COMMERCIAL_STATUS_LABELS[status],
            current: status === row.commercialStatus,
            onSelect: () => {
              setActionError(null);
              if (status !== row.commercialStatus) setStatus.mutate({ row, status });
            },
          }))}
        />
      ),
    },
  ];

  return (
    <>
      <TopBar
        title="Interesse por cidade"
        subtitle={'Moradores que tocaram em "Quero o Alô Cidadão aqui"'}
        actions={
          <Button
            variant="secondary"
            size="md"
            icon={<Download size={16} aria-hidden />}
            disabled={exportCsv.isPending}
            onClick={() => {
              setActionError(null);
              exportCsv.mutate();
            }}
          >
            Exportar CSV
          </Button>
        }
      />
      <main className={styles.content}>
        {query.isError ? (
          <div role="alert" className={styles.error}>
            <p>Não foi possível carregar o interesse por cidade.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className={styles.alert}>
            {actionError}
          </p>
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <p className={styles.state}>Ninguém pediu o Alô Cidadão em uma cidade ainda.</p>
        ) : null}
        {query.data && query.data.items.length > 0 ? (
          <>
            <DataTable
              columns={columns}
              rows={query.data.items}
              rowKey={(row) => row.ibgeCode}
              rowLabel={cityLabel}
            />
            <p className={styles.note}>
              Cada pessoa conta uma vez por município. Não guardamos o local exato, só o município.
            </p>
          </>
        ) : null}
      </main>
    </>
  );
}
