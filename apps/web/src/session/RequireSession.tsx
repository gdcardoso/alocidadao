import { Navigate, Outlet, useLocation } from 'react-router';
import { IdleGuard } from './IdleGuard';
import { useSession } from './SessionProvider';

/**
 * Rotas do painel: sem sessão, manda para `/entrar`. Enquanto renova, não mostra nada. Com a
 * sessão aberta, sai sozinho depois de 1 h sem uso.
 */
export function RequireSession() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return null;
  if (status === 'signed_out') return <Navigate to="/entrar" replace state={{ from: location }} />;
  return (
    <>
      <Outlet />
      <IdleGuard />
    </>
  );
}
