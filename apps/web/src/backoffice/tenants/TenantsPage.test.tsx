import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { previousMonthName } from './format';
import { TenantsPage } from './TenantsPage';

vi.mock('../../api', () => ({ api: { backofficeTenants: vi.fn(), backofficeContext: vi.fn() } }));

const tenants = vi.mocked(api.backofficeTenants);
const context = vi.mocked(api.backofficeContext);

const overview = {
  activeTenants: 3,
  onboardingTenants: 1,
  suspendedTenants: 0,
  citizens: 12480,
  requestsThisMonth: 3215,
  requestsLastMonth: 2871,
  avgResolutionDays: 4.2,
};
const item = (over: Record<string, unknown>) => ({
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Prefeitura de Santos',
  state: 'SP',
  status: 'active',
  plan: 'essential',
  citizenCount: 2304,
  openCount: 41,
  avgResolutionDays: 4.8,
  lateReviewCount: 0,
  staleImpedimentCount: 0,
  activeCategoryCount: 9,
  ...over,
});

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
        <MemoryRouter initialEntries={['/backoffice/prefeituras']}>
          <Routes>
            <Route path="/backoffice/prefeituras" element={<TenantsPage />} />
            <Route path="/backoffice/prefeituras/nova" element={<p>tela nova</p>} />
            <Route path="/backoffice/prefeituras/:id" element={<p>tela detalhe</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T15:00:00Z') });
  context.mockResolvedValue({ user: { id: 'u', name: 'Lucas' }, platformRole: 'admin' } as never);
});
afterEach(() => vi.useRealTimers());

describe('TenantsPage', () => {
  it('subtitle and cards use the singular and hide empty parts', async () => {
    tenants.mockResolvedValue({
      overview: { ...overview, activeTenants: 1, onboardingTenants: 0, suspendedTenants: 1 },
      items: [item({})],
    } as never);
    renderPage();
    expect(await screen.findByText('1 prefeitura · 1 ativa, 1 suspensa')).toBeInTheDocument();
    expect(screen.getByText('Prefeituras ativas')).toBeInTheDocument();
    expect(screen.queryByText(/em implantação/)).not.toBeInTheDocument();
    expect(screen.getByText('12.480')).toBeInTheDocument();
    expect(screen.getByText('fizeram ao menos 1 solicitação')).toBeInTheDocument();
    expect(screen.getByText('4,2 dias')).toBeInTheDocument();
    expect(screen.getByText('média das ativas, últimos 30 dias')).toBeInTheDocument();
  });

  it('subtitle lists active, onboarding and suspended in plural', async () => {
    tenants.mockResolvedValue({
      overview: {
        ...overview,
        activeTenants: 3,
        onboardingTenants: 2,
        suspendedTenants: 2,
        avgResolutionDays: null,
      },
      items: [
        item({}),
        item({ id: '2' }),
        item({ id: '3' }),
        item({ id: '4' }),
        item({ id: '5' }),
        item({ id: '6' }),
        item({ id: '7' }),
      ],
    } as never);
    renderPage();
    expect(
      await screen.findByText('7 prefeituras · 3 ativas, 2 em implantação, 2 suspensas'),
    ).toBeInTheDocument();
    expect(screen.getByText('+2 em implantação')).toBeInTheDocument();
    expect(screen.getByText('Tempo médio até a conclusão').parentElement).toHaveTextContent('—');
  });

  it('month change shows plus, minus or no comparison with the previous month name', async () => {
    expect(previousMonthName(new Date('2026-10-26T15:00:00Z'))).toBe('setembro');
    // 1º de janeiro 01:00 em Brasília ainda é 31/12 no UTC+0... e dezembro no mês anterior
    expect(previousMonthName(new Date('2026-01-01T12:00:00Z'))).toBe('dezembro');
    // 01/11 01:00 UTC ainda é outubro em Brasília: anterior = setembro
    expect(previousMonthName(new Date('2026-11-01T01:00:00Z'))).toBe('setembro');

    tenants.mockResolvedValue({
      overview: { ...overview, requestsThisMonth: 112, requestsLastMonth: 100 },
      items: [],
    } as never);
    renderPage();
    expect(await screen.findByText('+12% sobre setembro')).toBeInTheDocument();
  });

  it('month change shows minus', async () => {
    tenants.mockResolvedValue({
      overview: { ...overview, requestsThisMonth: 95, requestsLastMonth: 100 },
      items: [],
    } as never);
    renderPage();
    expect(await screen.findByText('-5% sobre setembro')).toBeInTheDocument();
  });

  it('month change shows no comparison without a base', async () => {
    tenants.mockResolvedValue({
      overview: { ...overview, requestsLastMonth: 0 },
      items: [],
    } as never);
    renderPage();
    expect(await screen.findByText('sem comparação com setembro')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma prefeitura cadastrada.')).toBeInTheDocument();
  });

  it('table orders by status group and opens the detail', async () => {
    // A API entrega a ordem (ativas, implantação, suspensas; por nome): a tela mantém.
    tenants.mockResolvedValue({
      overview,
      items: [
        item({ id: 'a1', displayName: 'Prefeitura de Jundiaí', lateReviewCount: 5 }),
        item({
          id: 'a2',
          displayName: 'Prefeitura de Santos',
          plan: null,
          avgResolutionDays: null,
          staleImpedimentCount: 1,
        }),
        item({
          id: 'o1',
          displayName: 'Prefeitura de Sorocaba',
          status: 'onboarding',
          activeCategoryCount: 0,
          plan: 'complete',
        }),
        item({ id: 's1', displayName: 'Prefeitura de Bauru', status: 'suspended' }),
      ],
    } as never);
    renderPage();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Prefeitura de JundiaíSP',
      'Prefeitura de SantosSP',
      'Prefeitura de SorocabaSP',
      'Prefeitura de BauruSP',
    ]);
    expect(within(rows[0]!).getByText('Ativa')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('5 aguardando revisão há +1 dia')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1 impedimento parado')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Em implantação')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Completo')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Sem categorias configuradas')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Suspensa')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Essencial')).toBeInTheDocument();

    await userEvent
      .setup({ advanceTimers: () => undefined })
      .click(within(rows[0]!).getByRole('button', { name: 'Abrir Prefeitura de Jundiaí' }));
    expect(await screen.findByText('tela detalhe')).toBeInTheDocument();
  });

  it('row click opens the detail', async () => {
    tenants.mockResolvedValue({ overview, items: [item({ id: 'a1' })] } as never);
    renderPage();
    const row = await screen.findByRole('row', { name: 'Abrir Prefeitura de Santos' });
    await userEvent.click(row);
    expect(await screen.findByText('tela detalhe')).toBeInTheDocument();
  });

  it('new tenant button only for the admin', async () => {
    tenants.mockResolvedValue({ overview, items: [item({})] } as never);
    renderPage();
    const button = await screen.findByRole('button', { name: 'Nova prefeitura' });
    await userEvent.click(button);
    expect(await screen.findByText('tela nova')).toBeInTheDocument();
  });

  it('hides the new tenant button for support', async () => {
    context.mockResolvedValue({ user: { id: 'u', name: 'Ana' }, platformRole: 'support' } as never);
    tenants.mockResolvedValue({ overview, items: [item({})] } as never);
    renderPage();
    await screen.findByText('Prefeitura de Santos');
    expect(screen.queryByRole('button', { name: 'Nova prefeitura' })).not.toBeInTheDocument();
  });
});
