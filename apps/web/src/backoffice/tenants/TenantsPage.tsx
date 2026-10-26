import { PLAN_LABELS, formatChange, type TenantSummary } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import { Info, Plus, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { TopBar } from '../../ui/TopBar';
import { useBackofficeContext } from '../use-backoffice-context';
import { formatCount, formatDays, previousMonthName } from './format';
import { StatCard } from './StatCard';
import { tenantAlert } from './tenant-alert';
import { TenantStatusBadge } from './TenantStatusBadge';
import styles from './TenantsPage.module.css';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function subtitleOf(total: number, active: number, onboarding: number, suspended: number) {
  const parts: string[] = [];
  if (active > 0) parts.push(plural(active, 'ativa', 'ativas'));
  if (onboarding > 0) parts.push(`${onboarding} em implantação`);
  if (suspended > 0) parts.push(plural(suspended, 'suspensa', 'suspensas'));
  const head = plural(total, 'prefeitura', 'prefeituras');
  return parts.length > 0 ? `${head} · ${parts.join(', ')}` : head;
}

function monthChangeText(current: number, previous: number): string {
  const month = previousMonthName(new Date());
  const change = formatChange(current, previous);
  if (change === null) return `sem comparação com ${month}`;
  return `${change > 0 ? '+' : ''}${change}% sobre ${month}`;
}

/** Ordem da API: ativas, em implantação e suspensas, cada grupo por nome. */
export function TenantsPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const context = useBackofficeContext();
  const query = useQuery({
    queryKey: ['backoffice', 'tenants'],
    queryFn: () => session.withAuth(() => api.backofficeTenants()),
  });

  const openTenant = (row: TenantSummary) => void navigate(`/backoffice/prefeituras/${row.id}`);

  const columns: DataTableColumn<TenantSummary>[] = [
    {
      key: 'name',
      header: 'Prefeitura',
      width: 230,
      render: (row) => (
        <div className={styles.name}>
          <span className={styles.nameMain}>{row.displayName}</span>
          <span className={styles.nameSub}>{row.state}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: (row) => <TenantStatusBadge status={row.status} />,
    },
    {
      key: 'plan',
      header: 'Plano',
      width: 120,
      render: (row) => (row.plan ? PLAN_LABELS[row.plan] : '—'),
    },
    {
      key: 'citizens',
      header: 'Cidadãos',
      width: 100,
      render: (row) => formatCount(row.citizenCount),
    },
    { key: 'open', header: 'Abertas', width: 90, render: (row) => formatCount(row.openCount) },
    {
      key: 'avg',
      header: 'Tempo médio',
      width: 110,
      render: (row) => formatDays(row.avgResolutionDays),
    },
    {
      key: 'alert',
      header: 'Alertas',
      width: 210,
      render: (row) => {
        const alert = tenantAlert(row);
        if (!alert) return <span className={styles.none}>—</span>;
        const Icon = alert.tone === 'warning' ? TriangleAlert : Info;
        return (
          <span className={`${styles.alert} ${styles[alert.tone]}`}>
            <Icon size={14} aria-hidden />
            {alert.text}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      render: (row) => (
        <button
          type="button"
          className={styles.open}
          aria-label={`Abrir ${row.displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            openTenant(row);
          }}
        >
          Abrir
        </button>
      ),
    },
  ];

  const data = query.data;
  const overview = data?.overview;

  return (
    <>
      <TopBar
        title="Prefeituras"
        subtitle={
          overview && data
            ? subtitleOf(
                data.items.length,
                overview.activeTenants,
                overview.onboardingTenants,
                overview.suspendedTenants,
              )
            : undefined
        }
        actions={
          context.data?.platformRole === 'admin' ? (
            <Button
              size="md"
              icon={<Plus size={16} aria-hidden />}
              onClick={() => void navigate('/backoffice/prefeituras/nova')}
            >
              Nova prefeitura
            </Button>
          ) : undefined
        }
      />
      <main className={styles.content}>
        {query.isError ? (
          <div role="alert" className={styles.error}>
            <p>Não foi possível carregar as prefeituras.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {overview && data ? (
          <>
            <div className={styles.cards}>
              <StatCard
                label="Prefeituras ativas"
                value={formatCount(overview.activeTenants)}
                help={
                  overview.onboardingTenants > 0
                    ? `+${overview.onboardingTenants} em implantação`
                    : undefined
                }
              />
              <StatCard
                label="Cidadãos"
                value={formatCount(overview.citizens)}
                help="fizeram ao menos 1 solicitação"
              />
              <StatCard
                label="Solicitações no mês"
                value={formatCount(overview.requestsThisMonth)}
                help={monthChangeText(overview.requestsThisMonth, overview.requestsLastMonth)}
              />
              <StatCard
                label="Tempo médio até a conclusão"
                value={formatDays(overview.avgResolutionDays)}
                help="média das ativas, últimos 30 dias"
              />
            </div>
            {data.items.length === 0 ? (
              <p className={styles.empty}>Nenhuma prefeitura cadastrada.</p>
            ) : (
              <DataTable
                columns={columns}
                rows={data.items}
                rowKey={(row) => row.id}
                rowLabel={(row) => `Abrir ${row.displayName}`}
                onRowClick={openTenant}
              />
            )}
          </>
        ) : null}
      </main>
    </>
  );
}
