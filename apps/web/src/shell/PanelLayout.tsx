import { ApiError } from '@alocidadao/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { useSession } from '../session/SessionProvider';
import { clearSupportTenant, getSupportTenant } from '../session/support-tenant';
import { Button } from '../ui/Button';
import { ToastProvider } from '../ui/Toast';
import { NoAccessPage } from './NoAccessPage';
import styles from './PanelLayout.module.css';
import { Sidebar } from './Sidebar';
import { SupportBanner } from './SupportBanner';
import { panelCountsKey, PanelValueContext, type PanelValue } from './use-panel';

const COUNTS_REFRESH_MS = 60_000;

function isNotAMember(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body as { code?: string } | null)?.code === 'not_a_member'
  );
}

/**
 * Estrutura do painel: carrega a prefeitura, o contexto e os contadores, mostra o menu e
 * publica `usePanel`. Um 403 `not_a_member` em qualquer consulta ou ação mostra a página
 * de acesso inativo.
 */
export function PanelLayout() {
  const { session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [noAccess, setNoAccess] = useState(false);
  // Equipe interna numa prefeitura: o `sessionStorage` mantém o modo suporte ao recarregar.
  const [support, setSupport] = useState(getSupportTenant);
  const supportRef = useRef(support);
  useEffect(() => {
    supportRef.current = support;
  }, [support]);
  const dropping = useRef(false);
  const [leaving, setLeaving] = useState(false);

  // Vínculo ou prefeitura perdidos com o painel aberto: qualquer chamada (inclusive as das
  // telas filhas) que responda 403 not_a_member derruba o painel para a página sem acesso.
  useEffect(() => {
    // No modo suporte, 403 not_a_member é a prefeitura suspensa (ou a conta que deixou de ser
    // da equipe): apaga o modo suporte e volta à P3 se a pessoa é da equipe; senão segue
    // como painel comum.
    async function dropSupport(tenant: string) {
      if (dropping.current) return;
      dropping.current = true;
      clearSupportTenant();
      let staff = false;
      try {
        await session.withAuth(() => api.backofficeContext());
        staff = true;
      } catch {
        // não é da equipe interna
      }
      if (staff) void navigate(`/backoffice/prefeituras/${tenant}`, { replace: true });
      else setSupport(null);
      dropping.current = false;
    }
    const watch = (error: unknown) => {
      if (!isNotAMember(error)) return;
      const current = supportRef.current;
      if (current) void dropSupport(current.tenantId);
      else setNoAccess(true);
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') watch(event.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') watch(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient, session, navigate]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => session.withAuth(() => api.me()),
    enabled: !support,
  });
  // Equipe interna sem modo suporte (nova aba, favorito, `/`): o caminho dela é o backoffice,
  // mesmo que também tenha vínculo com alguma prefeitura.
  const staffOutsideSupport = !support && !!meQuery.data?.platformRole;
  const tenantId = support
    ? support.tenantId
    : staffOutsideSupport
      ? undefined
      : meQuery.data?.panelTenants[0]?.tenantId;

  const contextQuery = useQuery({
    queryKey: ['panel', 'context', tenantId],
    queryFn: () => session.withAuth(() => api.panelContext(tenantId!)),
    enabled: tenantId !== undefined,
  });
  const countsQuery = useQuery({
    queryKey: panelCountsKey(tenantId ?? ''),
    queryFn: () => session.withAuth(() => api.panelCounts(tenantId!)),
    enabled: tenantId !== undefined,
    refetchInterval: COUNTS_REFRESH_MS,
  });

  const context = contextQuery.data;
  const counts = countsQuery.data;
  const value = useMemo<PanelValue | null>(
    () => (tenantId && context ? { tenantId, context, counts, support } : null),
    [tenantId, context, counts, support],
  );

  async function signOut() {
    await session.signOut();
    void navigate('/entrar', { replace: true });
  }

  async function leaveSupport() {
    if (!support) return;
    setLeaving(true);
    try {
      await session.withAuth(() => api.backofficeLeaveSupport(support.tenantId));
    } catch {
      // A saída não pode prender a pessoa na prefeitura; a auditoria já tem a entrada.
    }
    clearSupportTenant();
    void navigate(`/backoffice/prefeituras/${support.tenantId}`, { replace: true });
  }

  if (staffOutsideSupport) {
    return <Navigate to="/backoffice/prefeituras" replace />;
  }
  const withoutTenant = !support && meQuery.isSuccess && tenantId === undefined;
  if (noAccess || withoutTenant) return <NoAccessPage />;

  const error = meQuery.error ?? contextQuery.error;
  if (error) {
    return (
      <main className={styles.state}>
        <p>{error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void (meQuery.error ? meQuery.refetch() : contextQuery.refetch())}
        >
          Tentar de novo
        </Button>
      </main>
    );
  }
  if (!value) return null;

  return (
    <PanelValueContext.Provider value={value}>
      <ToastProvider>
        {support ? (
          <SupportBanner
            displayName={support.displayName}
            pending={leaving}
            onLeave={() => void leaveSupport()}
          />
        ) : null}
        <div className={`${styles.shell} ${support ? styles.shellWithBanner : ''}`}>
          <Sidebar
            context={value.context}
            counts={value.counts}
            onSignOut={() => void signOut()}
            support={support !== null}
          />
          <div className={styles.main}>
            <Outlet />
          </div>
        </div>
      </ToastProvider>
    </PanelValueContext.Provider>
  );
}
