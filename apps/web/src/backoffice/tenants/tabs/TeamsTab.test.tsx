import type { TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { TeamsTab } from './TeamsTab';

vi.mock('../../../api', () => ({ api: { backofficeTenantTeams: vi.fn() } }));

const load = vi.mocked(api.backofficeTenantTeams);

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
        <TeamsTab tenant={tenant} isAdmin={false} onOpenPanel={onOpenPanel} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return onOpenPanel;
}

describe('TeamsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the rows read-only and opens the panel at /equipes', async () => {
    load.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Turno A',
          departmentId: '11111111-1111-4111-8111-111111111111',
          departmentName: 'Obras',
          baseAddress: null,
          baseLocation: null,
          agentCount: 3,
          activeAgentCount: 2,
          openWorkOrderCount: 4,
        },
      ],
    });
    const onOpenPanel = renderTab();

    expect(await screen.findByText('Turno A')).toBeInTheDocument();
    expect(screen.getByText('Obras')).toBeInTheDocument();
    expect(screen.getByText('2 ativos de 3')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(tenant.id);
    expect(screen.queryByRole('button', { name: /⋯|menu|editar/i })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir no painel' }));
    expect(onOpenPanel).toHaveBeenCalledWith('/equipes');
  });

  it('shows an alert when loading fails', async () => {
    load.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
  });
});
