import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { ToastProvider } from '../../ui/Toast';
import { TenantDetailPage } from './TenantDetailPage';

vi.mock('../../api', () => ({
  api: {
    backofficeTenant: vi.fn(),
    backofficeContext: vi.fn(),
    backofficeSetTenantStatus: vi.fn(),
    backofficeEnterSupport: vi.fn(),
  },
}));

const tenant = vi.mocked(api.backofficeTenant);
const context = vi.mocked(api.backofficeContext);
const setStatus = vi.mocked(api.backofficeSetTenantStatus);
const enterSupport = vi.mocked(api.backofficeEnterSupport);

const id = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

function detail(over: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) {
  return {
    id,
    displayName: 'Prefeitura de São Paulo',
    state: 'SP',
    ibgeCode: '3550308',
    status: 'active',
    centralPhone: '156',
    contract: {
      plan: 'complete',
      includedPanelUsers: 50,
      startsOn: '2026-11-01',
      endsOn: '2027-10-31',
    },
    stats: {
      citizenCount: 8912,
      openCount: 148,
      staleTriageCount: 32,
      awaitingReviewCount: 5,
      lateReviewCount: 2,
      avgResolutionDays: 3.9,
      teamCount: 5,
      activeAgentCount: 14,
      invitedAgentCount: 1,
      managerCount: 4,
      adminCount: 1,
      activeCategoryCount: 9,
      panelUserCount: 18,
      ...stats,
    },
    recentStaffActions: [
      { action: 'support.enter', staffName: 'Lucas Prado', at: '2026-10-26T13:02:00Z' },
      { action: 'inventada.acao', staffName: 'Marina Dias', at: '2026-10-25T19:30:00Z' },
      { action: 'tenant.create', staffName: 'Marina Dias', at: '2026-10-12T15:00:00Z' },
    ],
    ...over,
  } as never;
}

function renderPage() {
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
        <ToastProvider>
          <MemoryRouter initialEntries={[`/backoffice/prefeituras/${id}`]}>
            <Routes>
              <Route path="/backoffice/prefeituras/:id" element={<TenantDetailPage />} />
              <Route path="/mapa" element={<p>tela mapa</p>} />
              <Route path="/equipes" element={<p>tela equipes</p>} />
              <Route path="/equipes/gestores" element={<p>tela gestores</p>} />
              <Route path="/categorias" element={<p>tela categorias</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T15:00:00Z') });
  context.mockResolvedValue({ user: { id: 'u', name: 'Lucas' }, platformRole: 'admin' } as never);
  tenant.mockResolvedValue(detail());
});
afterEach(() => vi.useRealTimers());

describe('TenantDetailPage', () => {
  it('detail shows stats, people, contract and recent actions with labels', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Prefeitura de São Paulo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(
      screen.getByText('SP · IBGE 3550308 · cliente desde 01/11/2026 · plano Completo'),
    ).toBeInTheDocument();
    expect(screen.getByText('Visão geral')).toBeInTheDocument();

    expect(screen.getByText('8.912')).toBeInTheDocument();
    expect(screen.getByText('fizeram ao menos 1 solicitação')).toBeInTheDocument();
    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText('32 abertas há +3 dias')).toBeInTheDocument();
    expect(screen.getByText('2 há mais de 1 dia')).toBeInTheDocument();
    expect(screen.getByText('3,9 dias')).toBeInTheDocument();
    expect(screen.getByText('últimos 30 dias')).toBeInTheDocument();

    expect(screen.getByText('14 ativos · 1 convidado')).toBeInTheDocument();
    expect(screen.getByText('4 · 1 admin')).toBeInTheDocument();
    expect(screen.getByText('9 ativas')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Gerenciar/ })).toHaveLength(4);

    expect(screen.getByText('01/11/2026 a 31/10/2027')).toBeInTheDocument();
    expect(screen.getByText('18 de 50 incluídos')).toBeInTheDocument();
    expect(screen.getByText('156')).toBeInTheDocument();

    expect(screen.getByText('Entrou no painel (suporte)')).toBeInTheDocument();
    expect(screen.getByText('Lucas Prado · hoje, 10:02')).toBeInTheDocument();
    expect(screen.getByText('Fez uma alteração')).toBeInTheDocument();
    expect(screen.getByText('Marina Dias · ontem, 16:30')).toBeInTheDocument();
    expect(screen.getByText('Criou a prefeitura')).toBeInTheDocument();
    expect(screen.getByText('Marina Dias · 12 out')).toBeInTheDocument();
  });

  it('uses singulars, zero variants, no contract and no central', async () => {
    tenant.mockResolvedValue(
      detail(
        { contract: null, centralPhone: null, recentStaffActions: [] },
        {
          staleTriageCount: 0,
          awaitingReviewCount: 0,
          lateReviewCount: 0,
          avgResolutionDays: null,
          activeAgentCount: 1,
          invitedAgentCount: 0,
          adminCount: 2,
          activeCategoryCount: 1,
        },
      ),
    );
    renderPage();
    expect(await screen.findByText('SP · IBGE 3550308')).toBeInTheDocument();
    expect(screen.getByText('nenhuma aberta há +3 dias')).toBeInTheDocument();
    expect(screen.getByText('nenhuma há mais de 1 dia')).toBeInTheDocument();
    expect(screen.getByText('1 ativo')).toBeInTheDocument();
    expect(screen.getByText('4 · 2 admins')).toBeInTheDocument();
    expect(screen.getByText('1 ativa')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma ação da equipe Alô Cidadão ainda.')).toBeInTheDocument();
  });

  it('review card turns warning only with late reviews', async () => {
    renderPage();
    const card = (await screen.findByText('Aguardando revisão')).parentElement!;
    expect(card).toHaveAttribute('data-tone', 'warning');
    expect(within(card).getByText('2 há mais de 1 dia')).toBeInTheDocument();
    expect(screen.getByText('Cidadãos').parentElement).not.toHaveAttribute('data-tone');
  });

  it('review card is plain without late reviews', async () => {
    tenant.mockResolvedValue(detail({}, { lateReviewCount: 0 }));
    renderPage();
    const card = (await screen.findByText('Aguardando revisão')).parentElement!;
    expect(card).not.toHaveAttribute('data-tone');
  });

  it('activate asks for confirmation and shows tenant_not_ready', async () => {
    tenant.mockResolvedValue(detail({ status: 'onboarding' }));
    setStatus.mockRejectedValueOnce(new ApiError(422, { code: 'tenant_not_ready' }));
    vi.useRealTimers();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ativar prefeitura' }));
    const dialog = screen.getByRole('dialog', { name: 'Ativar Prefeitura de São Paulo?' });
    expect(
      within(dialog).getByText(
        'Ela passa a aparecer para os cidadãos do município, que poderão registrar solicitações.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ativar' }));
    expect(setStatus).toHaveBeenCalledWith(id, { action: 'activate' });
    expect(
      await screen.findByText(
        'Antes de ativar, cadastre ao menos uma categoria ativa e uma equipe.',
      ),
    ).toBeInTheDocument();

    setStatus.mockResolvedValueOnce({ status: 'active' });
    if (!screen.queryByRole('dialog')) {
      await user.click(screen.getByRole('button', { name: 'Ativar prefeitura' }));
    }
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ativar' }));
    expect(await screen.findByText('Prefeitura ativada.')).toBeInTheDocument();
  });

  it('suspend asks for confirmation; reactivate does not', async () => {
    vi.useRealTimers();
    setStatus.mockResolvedValue({ status: 'suspended' });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender Prefeitura de São Paulo?' });
    expect(
      within(dialog).getByText(
        'Os cidadãos deixam de conseguir registrar solicitações no município, e gestores e agentes perdem o acesso. As solicitações abertas ficam como estão.',
      ),
    ).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
    tenant.mockResolvedValue(detail({ status: 'suspended' }));
    await user.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(setStatus).toHaveBeenCalledWith(id, { action: 'suspend' });
    expect(await screen.findByText('Prefeitura suspensa.')).toBeInTheDocument();

    // suspensa: entrar desabilitado com ajuda; reativar sem diálogo
    const enter = await screen.findByRole('button', { name: 'Entrar no painel da prefeitura' });
    expect(enter).toBeDisabled();
    expect(screen.getByText('Reative a prefeitura para entrar no painel.')).toBeInTheDocument();
    setStatus.mockResolvedValue({ status: 'active' });
    await user.click(screen.getByRole('button', { name: 'Reativar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(setStatus).toHaveBeenLastCalledWith(id, { action: 'reactivate' });
    expect(await screen.findByText('Prefeitura reativada.')).toBeInTheDocument();
  });

  it('support role sees no status actions', async () => {
    context.mockResolvedValue({
      user: { id: 'u', name: 'Sara' },
      platformRole: 'support',
    } as never);
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Entrar no painel da prefeitura' }),
    ).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar prefeitura' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument();
  });

  it('enter support stores the tenant and opens the map', async () => {
    vi.useRealTimers();
    enterSupport.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Entrar no painel da prefeitura' }));
    expect(await screen.findByText('tela mapa')).toBeInTheDocument();
    expect(enterSupport).toHaveBeenCalledWith(id);
    expect(JSON.parse(sessionStorage.getItem('ac_support_tenant')!)).toEqual({
      tenantId: id,
      displayName: 'Prefeitura de São Paulo',
    });
  });

  it('manage teams enters support on the teams page', async () => {
    vi.useRealTimers();
    enterSupport.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gerenciar equipes' }));
    expect(await screen.findByText('tela equipes')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('ac_support_tenant')).not.toBeNull());
  });

  it('manage managers and categories open their pages', async () => {
    vi.useRealTimers();
    enterSupport.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gerenciar gestores' }));
    expect(await screen.findByText('tela gestores')).toBeInTheDocument();
  });
});
