import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import App from '../App';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { setSupportTenant } from '../session/support-tenant';

vi.mock('../api', () => ({
  api: {
    me: vi.fn(),
    panelContext: vi.fn(),
    panelCounts: vi.fn(),
    panelOccurrences: vi.fn(),
    backofficeContext: vi.fn(),
    backofficeTenant: vi.fn(),
    backofficeEnterSupport: vi.fn(),
    backofficeLeaveSupport: vi.fn(),
  },
}));
vi.mock('../map/OccurrenceMap', () => ({ OccurrenceMap: () => null }));

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const stored = { tenantId, displayName: 'Prefeitura de Santos' };

function renderApp(path: string, support: typeof stored | null = null, staleBeforeLogin = false) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  // `signIn` apaga o modo suporte; ele só vale se for gravado depois da entrada.
  if (staleBeforeLogin && support) setSupportTenant(support);
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  if (!staleBeforeLogin && support) setSupportTenant(support);
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
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  // A equipe interna não tem vínculo: `me.panelTenants` vem vazio.
  vi.mocked(api.me).mockResolvedValue({ panelTenants: [] } as never);
  vi.mocked(api.panelContext).mockResolvedValue({
    tenant: { id: tenantId, displayName: 'Prefeitura de Santos', status: 'active', bounds: null },
    user: { id: tenantId, name: 'Lucas Prado' },
    role: 'tenant_admin',
    departments: [],
  });
  vi.mocked(api.panelCounts).mockResolvedValue({ triage: 0, awaitingReview: 0, impeded: 0 });
  vi.mocked(api.panelOccurrences).mockResolvedValue({ total: 0, items: [] });
  vi.mocked(api.backofficeContext).mockResolvedValue({
    user: { id: 'u', name: 'Lucas Prado' },
    platformRole: 'admin',
  } as never);
  vi.mocked(api.backofficeTenant).mockResolvedValue({
    id: tenantId,
    displayName: 'Prefeitura de Santos',
    state: 'SP',
    ibgeCode: '3548500',
    status: 'active',
    centralPhone: null,
    contract: null,
    stats: {
      citizenCount: 1,
      openCount: 1,
      staleTriageCount: 0,
      awaitingReviewCount: 0,
      lateReviewCount: 0,
      avgResolutionDays: null,
      teamCount: 1,
      activeAgentCount: 1,
      invitedAgentCount: 0,
      managerCount: 1,
      adminCount: 1,
      activeCategoryCount: 1,
      panelUserCount: 1,
    },
    recentStaffActions: [],
  } as never);
});

describe('support mode', () => {
  it('enter support stores the tenant and opens the map with the banner', async () => {
    vi.mocked(api.backofficeEnterSupport).mockResolvedValue(undefined);
    renderApp(`/backoffice/prefeituras/${tenantId}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Entrar no painel da prefeitura' }));
    expect(
      await screen.findByText(
        'Você está na Prefeitura de Santos como equipe Alô Cidadão · suas ações ficam registradas na auditoria',
      ),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem('ac_support_tenant')).not.toBeNull();
    expect(api.panelContext).toHaveBeenCalledWith(tenantId);
    expect(screen.getByRole('link', { name: /Mapa/ })).toHaveAttribute('aria-current', 'page');
    // usuário: nome e papel, sem Sair do usuário
    expect(screen.getByText('Lucas Prado')).toBeInTheDocument();
    expect(screen.getByText('Equipe Alô Cidadão')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('reload keeps support mode from session storage', async () => {
    renderApp('/mapa', stored);
    expect(
      await screen.findByText(/Você está na Prefeitura de Santos como equipe Alô Cidadão/),
    ).toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
    expect(api.panelContext).toHaveBeenCalledWith(tenantId);
    expect(api.panelCounts).toHaveBeenCalledWith(tenantId);
  });

  it('without the stored tenant a user with no tenants sees the no-access page', async () => {
    renderApp('/mapa');
    expect(await screen.findByText('Seu acesso ao painel não está ativo')).toBeInTheDocument();
  });

  it('leaving support clears the tenant and returns to the detail', async () => {
    vi.mocked(api.backofficeLeaveSupport).mockResolvedValue(undefined);
    renderApp('/mapa', stored);
    const user = userEvent.setup();
    const banner = (await screen.findByText(/Você está na Prefeitura de Santos/)).parentElement!;
    await user.click(within(banner).getByRole('button', { name: 'Sair da prefeitura' }));
    expect(
      await screen.findByRole('heading', { name: 'Prefeitura de Santos' }),
    ).toBeInTheDocument();
    expect(api.backofficeLeaveSupport).toHaveBeenCalledWith(tenantId);
    expect(sessionStorage.getItem('ac_support_tenant')).toBeNull();
  });

  it('stale key + login as manager lands on the manager own tenant', async () => {
    const own = '9a9a9a9a-8c1e-4e6f-8a7b-9c0d1e2f3a4b';
    vi.mocked(api.me).mockResolvedValue({
      panelTenants: [
        { tenantId: own, tenantName: 'Prefeitura Própria', role: 'manager', status: 'active' },
      ],
    } as never);
    renderApp('/mapa', stored, true);
    await screen.findByRole('link', { name: /Mapa/ });
    expect(api.panelContext).toHaveBeenCalledWith(own);
    expect(api.panelContext).not.toHaveBeenCalledWith(tenantId);
    expect(screen.queryByText(/como equipe Alô Cidadão/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ac_support_tenant')).toBeNull();
  });

  it('support tenant suspended mid-session returns the staff user to the detail page', async () => {
    vi.mocked(api.panelContext).mockRejectedValue(new ApiError(403, { code: 'not_a_member' }));
    renderApp('/mapa', stored);
    expect(
      await screen.findByRole('heading', { name: 'Prefeitura de Santos' }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem('ac_support_tenant')).toBeNull();
  });

  it('support 403 for a non-staff user falls through to the regular panel', async () => {
    const own = '9a9a9a9a-8c1e-4e6f-8a7b-9c0d1e2f3a4b';
    vi.mocked(api.panelContext).mockRejectedValueOnce(new ApiError(403, { code: 'not_a_member' }));
    vi.mocked(api.backofficeContext).mockRejectedValue(
      new ApiError(403, { code: 'not_platform_staff' }),
    );
    vi.mocked(api.me).mockResolvedValue({
      panelTenants: [{ tenantId: own, tenantName: 'X', role: 'manager', status: 'active' }],
    } as never);
    renderApp('/mapa', stored);
    await waitFor(() => expect(api.panelContext).toHaveBeenCalledWith(own));
    expect(screen.queryByText(/como equipe Alô Cidadão/)).not.toBeInTheDocument();
  });
});
