import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import App from '../App';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';

vi.mock('../api', () => ({
  api: {
    backofficeContext: vi.fn(),
    backofficeTenants: vi.fn(),
    me: vi.fn(),
    panelContext: vi.fn(),
    panelCounts: vi.fn(),
  },
}));
vi.mock('../map/OccurrenceMap', () => ({ OccurrenceMap: () => null }));

const backofficeContext = vi.mocked(api.backofficeContext);
const userId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';

function renderApp(path: string) {
  const panelLogout = vi.fn(async () => undefined);
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout,
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { panelLogout };
}

beforeEach(() => {
  vi.resetAllMocks();
  backofficeContext.mockResolvedValue({
    user: { id: userId, name: 'Lucas Prado' },
    platformRole: 'admin',
  });
  // Para quem não é da equipe, o mapa carrega o painel: basta não quebrar.
  vi.mocked(api.me).mockResolvedValue({ panelTenants: [], termsAccepted: true } as never);
});

describe('BackofficeLayout', () => {
  it('menu shows the four items and the role label', async () => {
    renderApp('/backoffice');
    expect(await screen.findByRole('link', { name: 'Prefeituras' })).toHaveAttribute(
      'href',
      '/backoffice/prefeituras',
    );
    for (const name of ['Interesse por cidade', 'Equipe Alô Cidadão', 'Auditoria']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Lucas Prado')).toBeInTheDocument();
    expect(screen.getByText('LP')).toBeInTheDocument();
    expect(screen.getByText('Admin · Alô Cidadão')).toBeInTheDocument();
  });

  it('support role shows the support label and logout goes to the login', async () => {
    backofficeContext.mockResolvedValue({
      user: { id: userId, name: 'Rafa Souza' },
      platformRole: 'support',
    });
    const { panelLogout } = renderApp('/backoffice/prefeituras');
    expect(await screen.findByText('Suporte · Alô Cidadão')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(panelLogout).toHaveBeenCalled());
  });

  it('support does not see Equipe and Auditoria in the menu', async () => {
    backofficeContext.mockResolvedValue({
      user: { id: userId, name: 'Rafa Souza' },
      platformRole: 'support',
    });
    renderApp('/backoffice/interesse');
    expect(await screen.findByRole('link', { name: 'Prefeituras' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Interesse por cidade' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Equipe Alô Cidadão' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
  });

  it('support opening /backoffice/equipe goes back to prefeituras', async () => {
    backofficeContext.mockResolvedValue({
      user: { id: userId, name: 'Rafa Souza' },
      platformRole: 'support',
    });
    vi.mocked(api.backofficeTenants).mockReturnValue(new Promise(() => undefined));
    renderApp('/backoffice/equipe');
    expect(await screen.findByRole('heading', { name: 'Prefeituras' })).toBeInTheDocument();
    expect(api.backofficeTenants).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Equipe Alô Cidadão' })).not.toBeInTheDocument();
  });

  it('non-staff opening the backoffice goes to the map', async () => {
    backofficeContext.mockRejectedValue(new ApiError(403, { code: 'not_platform_staff' }));
    renderApp('/backoffice/prefeituras');
    await waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
  });
});
