import { PLAN_LABELS, STAFF_AUDIT_ACTION_LABELS, type TenantDetail } from '@alocidadao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePenLine, ScrollText, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../../api';
import { formatLastActive } from '../../format/last-active';
import { useNow } from '../../format/use-now';
import { errorCode } from '../../occurrence/use-occurrence-actions';
import { useSession } from '../../session/SessionProvider';
import { setSupportTenant } from '../../session/support-tenant';
import { generalErrorMessage } from '../../teams/team-errors';
import { Button } from '../../ui/Button';
import tabStyles from '../../ui/Tabs.module.css';
import { useToast } from '../../ui/Toast';
import { useBackofficeContext } from '../use-backoffice-context';
import { formatCount, formatDays, formatIsoDate } from './format';
import { StatCard } from './StatCard';
import styles from './TenantDetailPage.module.css';
import { AuditTab } from './tabs/AuditTab';
import { CategoriesTab } from './tabs/CategoriesTab';
import { CitizensTab } from './tabs/CitizensTab';
import { ContractTab } from './tabs/ContractTab';
import { ManagersTab } from './tabs/ManagersTab';
import { TeamsTab } from './tabs/TeamsTab';
import { TENANT_TABS, tabFromSearch, tabSearch, type TenantTab } from './tenant-tabs';
import { TenantStatusActions } from './TenantStatusActions';
import { TenantStatusBadge } from './TenantStatusBadge';

const SUSPENDED_ENTER_MESSAGE = 'Reative a prefeitura para entrar no painel.';
const FALLBACK_ACTION_LABEL = 'Fez uma alteração';

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function subtitleOf(tenant: TenantDetail): string {
  const base = `${tenant.state} · IBGE ${tenant.ibgeCode}`;
  if (!tenant.contract) return base;
  return `${base} · cliente desde ${formatIsoDate(tenant.contract.startsOn)} · plano ${PLAN_LABELS[tenant.contract.plan]}`;
}

function actionLabel(action: string): string {
  return (STAFF_AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? FALLBACK_ACTION_LABEL;
}

interface SummaryRow {
  label: string;
  value: string;
  manage?: { tab: TenantTab };
}

/** P3: detalhe da prefeitura, com as abas escolhidas por `?aba=`. */
export function TenantDetailPage() {
  const { id = '' } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const context = useBackofficeContext();
  const [entering, setEntering] = useState(false);
  const now = useNow();
  const [searchParams] = useSearchParams();

  const query = useQuery({
    queryKey: ['backoffice', 'tenant', id],
    queryFn: () => session.withAuth(() => api.backofficeTenant(id)),
  });
  const tenant = query.data;

  const enter = useMutation({
    mutationFn: (_target: string) => session.withAuth(() => api.backofficeEnterSupport(id)),
    onSuccess: (_result, target) => {
      setSupportTenant({ tenantId: id, displayName: tenant?.displayName ?? '' });
      void navigate(target);
    },
    onError: async (error) => {
      setEntering(false);
      if (errorCode(error) === 'tenant_suspended') {
        toast.show(SUSPENDED_ENTER_MESSAGE);
        await queryClient.invalidateQueries({ queryKey: ['backoffice'] });
      } else {
        toast.show(generalErrorMessage(error));
      }
    },
  });

  const enterAt = (target: string) => {
    setEntering(true);
    enter.mutate(target);
  };

  if (query.isError) {
    return (
      <main className={styles.content}>
        <div role="alert" className={styles.error}>
          <p>Não foi possível carregar a prefeitura.</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </main>
    );
  }
  if (!tenant) return null;

  const isAdmin = context.data?.platformRole === 'admin';
  const visibleTabs = TENANT_TABS.filter((def) => !def.adminOnly || isAdmin);
  const requested = tabFromSearch(searchParams);
  // Aba só do admin: sem o papel (ou ainda sem saber), cai na Visão geral.
  const activeTab = visibleTabs.some((def) => def.key === requested) ? requested : 'overview';

  const { stats, contract } = tenant;
  const people: SummaryRow[] = [
    { label: 'Equipes', value: formatCount(stats.teamCount), manage: { tab: 'teams' } },
    {
      label: 'Agentes',
      value:
        countLabel(stats.activeAgentCount, 'ativo', 'ativos') +
        (stats.invitedAgentCount > 0
          ? ` · ${countLabel(stats.invitedAgentCount, 'convidado', 'convidados')}`
          : ''),
      manage: { tab: 'teams' },
    },
    {
      label: 'Gestores',
      value:
        formatCount(stats.managerCount) +
        (stats.adminCount > 0 ? ` · ${countLabel(stats.adminCount, 'admin', 'admins')}` : ''),
      manage: { tab: 'managers' },
    },
    {
      label: 'Categorias',
      value: countLabel(stats.activeCategoryCount, 'ativa', 'ativas'),
      manage: { tab: 'categories' },
    },
  ];
  const contractRows: SummaryRow[] = [
    { label: 'Plano', value: contract ? PLAN_LABELS[contract.plan] : '—' },
    {
      label: 'Vigência',
      value: contract
        ? contract.endsOn
          ? `${formatIsoDate(contract.startsOn)} a ${formatIsoDate(contract.endsOn)}`
          : `desde ${formatIsoDate(contract.startsOn)}`
        : '—',
    },
    {
      label: 'Usuários do painel',
      value: contract
        ? `${stats.panelUserCount} de ${contract.includedPanelUsers} incluídos`
        : String(stats.panelUserCount),
    },
    { label: 'Central', value: tenant.centralPhone ?? '—' },
  ];

  const lateReviews = stats.lateReviewCount > 0;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titles}>
            <div className={styles.titleLine}>
              <h1 className={styles.title}>{tenant.displayName}</h1>
              <TenantStatusBadge status={tenant.status} />
            </div>
            <p className={styles.subtitle}>{subtitleOf(tenant)}</p>
          </div>
          {context.data ? (
            <TenantStatusActions
              tenantId={tenant.id}
              displayName={tenant.displayName}
              status={tenant.status}
              isAdmin={context.data.platformRole === 'admin'}
              entering={entering}
              onEnter={() => enterAt('/mapa')}
            />
          ) : null}
        </div>
        <nav className={styles.tabs} aria-label="Seções">
          {visibleTabs.map((def) => {
            const active = def.key === activeTab;
            return (
              <Link
                key={def.key}
                to={tabSearch(def.key) || '?'}
                className={`${tabStyles.tab} ${active ? tabStyles.active : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {def.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className={styles.content}>
        {activeTab === 'contract' && context.data ? (
          <ContractTab tenant={tenant} isAdmin={isAdmin} />
        ) : null}
        {activeTab === 'teams' ? (
          <TeamsTab tenant={tenant} isAdmin={isAdmin} onOpenPanel={enterAt} />
        ) : null}
        {activeTab === 'managers' ? (
          <ManagersTab tenant={tenant} isAdmin={isAdmin} onOpenPanel={enterAt} />
        ) : null}
        {activeTab === 'categories' ? (
          <CategoriesTab tenant={tenant} isAdmin={isAdmin} onOpenPanel={enterAt} />
        ) : null}
        {activeTab === 'citizens' ? <CitizensTab tenant={tenant} isAdmin={isAdmin} /> : null}
        {activeTab === 'audit' ? <AuditTab tenant={tenant} isAdmin={isAdmin} /> : null}
        {activeTab === 'overview' ? (
          <>
            <div className={styles.cards}>
              <StatCard
                label="Cidadãos"
                value={formatCount(stats.citizenCount)}
                help="fizeram ao menos 1 solicitação"
              />
              <StatCard
                label="Abertas e em atendimento"
                value={formatCount(stats.openCount)}
                help={
                  stats.staleTriageCount > 0
                    ? `${stats.staleTriageCount} abertas há +3 dias`
                    : 'nenhuma aberta há +3 dias'
                }
              />
              <StatCard
                label="Aguardando revisão"
                value={formatCount(stats.awaitingReviewCount)}
                help={
                  lateReviews
                    ? `${stats.lateReviewCount} há mais de 1 dia`
                    : 'nenhuma há mais de 1 dia'
                }
                tone={lateReviews ? 'warning' : undefined}
              />
              <StatCard
                label="Tempo médio até a conclusão"
                value={formatDays(stats.avgResolutionDays)}
                help="últimos 30 dias"
              />
            </div>

            <div className={styles.blocks}>
              <section className={styles.block} aria-labelledby="block-people">
                <h2 id="block-people" className={styles.blockTitle}>
                  <Users size={18} aria-hidden />
                  Pessoas da prefeitura
                </h2>
                {people.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    <span className={styles.rowValue}>{row.value}</span>
                    {row.manage ? (
                      <Link
                        className={styles.manage}
                        aria-label={`Gerenciar ${row.label.toLowerCase()}`}
                        to={tabSearch(row.manage.tab)}
                      >
                        Gerenciar
                      </Link>
                    ) : null}
                  </div>
                ))}
              </section>

              <section className={styles.block} aria-labelledby="block-contract">
                <h2 id="block-contract" className={styles.blockTitle}>
                  <FilePenLine size={18} aria-hidden />
                  Contrato
                </h2>
                {contractRows.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    <span className={styles.rowValue}>{row.value}</span>
                  </div>
                ))}
              </section>

              <section className={styles.block} aria-labelledby="block-audit">
                <h2 id="block-audit" className={styles.blockTitle}>
                  <ScrollText size={18} aria-hidden />
                  Últimas ações da equipe Alô Cidadão
                </h2>
                {tenant.recentStaffActions.length === 0 ? (
                  <p className={styles.empty}>Nenhuma ação da equipe Alô Cidadão ainda.</p>
                ) : (
                  <ul className={styles.actionsList}>
                    {tenant.recentStaffActions.map((item, index) => (
                      <li key={`${item.at}-${index}`} className={styles.actionItem}>
                        <span className={styles.actionName}>{actionLabel(item.action)}</span>
                        <span className={styles.actionMeta}>
                          {`${item.staffName} · ${formatLastActive(new Date(item.at), now)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
