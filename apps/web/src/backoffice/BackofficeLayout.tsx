import { ApiError } from '@alocidadao/api-client';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { api } from '../api';
import { NETWORK_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../auth/login-errors';
import { useSession } from '../session/SessionProvider';
import { clearSupportTenant } from '../session/support-tenant';
import styles from '../shell/PanelLayout.module.css';
import { Button } from '../ui/Button';
import { ToastProvider } from '../ui/Toast';
import { BackofficeSidebar } from './BackofficeSidebar';

function isNotStaff(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body as { code?: string } | null)?.code === 'not_platform_staff'
  );
}

/** Estrutura do backoffice: menu escuro e conteúdo. Quem não é da equipe interna volta ao mapa. */
export function BackofficeLayout() {
  const { session } = useSession();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['backoffice', 'context'],
    queryFn: () => session.withAuth(() => api.backofficeContext()),
  });

  async function signOut() {
    clearSupportTenant();
    await session.signOut();
    void navigate('/entrar', { replace: true });
  }

  if (isNotStaff(query.error)) return <Navigate to="/mapa" replace />;
  if (query.error) {
    return (
      <main className={styles.state}>
        <p>{query.error instanceof ApiError ? UNEXPECTED_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE}</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </main>
    );
  }
  if (!query.data) return null;

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <BackofficeSidebar context={query.data} onSignOut={() => void signOut()} />
        <div className={styles.main}>
          <Outlet />
        </div>
      </div>
    </ToastProvider>
  );
}
