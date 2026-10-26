import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from './SessionProvider';

/** Rotas do painel: sem sessão, manda para `/entrar`. Enquanto renova, não mostra nada. */
export function RequireSession() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return null;
  if (status === 'signed_out') return <Navigate to="/entrar" replace state={{ from: location }} />;
  return <Outlet />;
}
