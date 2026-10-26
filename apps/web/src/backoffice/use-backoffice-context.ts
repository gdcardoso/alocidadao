import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';

/** Contexto da equipe interna. Divide o cache com o `BackofficeLayout` (mesma chave). */
export function useBackofficeContext() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['backoffice', 'context'],
    queryFn: () => session.withAuth(() => api.backofficeContext()),
  });
}
