import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { usePanel } from '../shell/use-panel';

export interface NeighborhoodsState {
  /** Bairros da prefeitura, em ordem pt-BR. */
  items: string[];
  /** A prefeitura tem bairros: sem eles o filtro some e `?bairro=` é ignorado. */
  enabled: boolean;
  /** A lista ainda não chegou: as consultas esperam para não buscar sem o filtro. */
  isPending: boolean;
}

const NONE: string[] = [];

/** Bairros do painel (`GET /panel/neighborhoods`). */
export function useNeighborhoods(): NeighborhoodsState {
  const { tenantId } = usePanel();
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['neighborhoods', tenantId],
    queryFn: () => session.withAuth(() => api.panelNeighborhoods(tenantId)),
    staleTime: 60_000,
  });
  const items = query.data?.items ?? NONE;
  return { items, enabled: items.length > 0, isPending: query.isPending };
}
