import type { TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { ManagersTab } from './ManagersTab';

vi.mock('../../../api', () => ({ api: { backofficeTenantManagers: vi.fn() } }));

const load = vi.mocked(api.backofficeTenantManagers);

const tenant = { id: '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b' } as unknown as TenantDetail;

function renderTab(onOpenPanel = vi.fn()) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <ManagersTab tenant={tenant} isAdmin={false} onOpenPanel={onOpenPanel} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return onOpenPanel;
}

describe('ManagersTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the rows read-only and opens the panel at /equipes/gestores', async () => {
    load.mockResolvedValue({
      items: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Gestora de Obras',
          cpf: '52998224725',
          email: 'g@exemplo.com',
          role: 'manager',
          status: 'active',
          departments: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Obras' }],
        },
      ],
    });
    const onOpenPanel = renderTab();

    expect(await screen.findByText('Gestora de Obras')).toBeInTheDocument();
    expect(screen.getByText('g@exemplo.com')).toBeInTheDocument();
    expect(screen.queryByText('52998224725')).toBeNull();
    expect(load).toHaveBeenCalledWith(tenant.id);
    expect(screen.queryByRole('button', { name: /⋯|menu|editar/i })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir no painel' }));
    expect(onOpenPanel).toHaveBeenCalledWith('/equipes/gestores');
  });

  it('shows an alert when loading fails', async () => {
    load.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
  });
});
