import { PLAN_LABELS, TENANT_STATUS_LABELS, type TenantProfile } from '@alocidadao/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';
import { TopBar } from '../ui/TopBar';
import styles from './TenantProfilePage.module.css';

/** `2026-02-01` vira `01/02/2026`. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function neighborhoodsText({ count, source }: TenantProfile['neighborhoods']): string {
  if (count === 0) return 'Nenhum bairro cadastrado';
  const label = count === 1 ? '1 bairro cadastrado' : `${count} bairros cadastrados`;
  return `${label} · ${source === 'tenant' ? 'enviados pela prefeitura' : 'IBGE'}`;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.item}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {children}
    </section>
  );
}

/** Dados da prefeitura (só leitura): quem altera é a equipe do Alô Cidadão. */
export function TenantProfilePage() {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['panel', tenantId, 'tenant-profile'],
    queryFn: () => session.withAuth(() => api.panelTenantProfile(tenantId)),
  });
  const profile = query.data;

  return (
    <div className={styles.page}>
      <TopBar
        title="Dados da prefeitura"
        subtitle="Para alterar estes dados, fale com o suporte do Alô Cidadão."
      />
      <div className={styles.area}>
        {query.isPending ? <p className={styles.state}>Carregando…</p> : null}
        {query.isError ? (
          <p className={styles.state} role="alert">
            Não foi possível carregar os dados da prefeitura.
          </p>
        ) : null}
        {profile ? (
          <>
            <Block title="Prefeitura">
              <dl className={styles.list}>
                <Item label="Nome de exibição">{profile.displayName}</Item>
                <Item label="Município e UF">{`${profile.city} · ${profile.state}`}</Item>
                <Item label="Código IBGE">{profile.ibgeCode}</Item>
                <Item label="Central de atendimento">{profile.centralPhone ?? '—'}</Item>
                <Item label="Situação">{TENANT_STATUS_LABELS[profile.status]}</Item>
              </dl>
            </Block>
            <Block title="Contrato">
              {profile.contract ? (
                <dl className={styles.list}>
                  <Item label="Plano">{PLAN_LABELS[profile.contract.plan]}</Item>
                  <Item label="Vigência">
                    {profile.contract.endsOn
                      ? `${formatDate(profile.contract.startsOn)} a ${formatDate(profile.contract.endsOn)}`
                      : `A partir de ${formatDate(profile.contract.startsOn)}`}
                  </Item>
                  <Item label="Usuários do painel">
                    {`${profile.panelUserCount} de ${profile.contract.includedPanelUsers} incluídos`}
                  </Item>
                </dl>
              ) : (
                <p className={styles.state}>Sem contrato cadastrado</p>
              )}
            </Block>
            <Block title="Bairros">
              <p className={styles.value}>{neighborhoodsText(profile.neighborhoods)}</p>
            </Block>
          </>
        ) : null}
      </div>
    </div>
  );
}
