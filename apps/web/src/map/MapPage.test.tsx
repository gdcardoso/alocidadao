import type { OccurrencePoint, PanelContext } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { MapPage } from './MapPage';

vi.mock('../api', () => ({
  api: { panelOccurrences: vi.fn(), panelSearch: vi.fn(), panelOccurrence: vi.fn() },
}));
// O MapLibre precisa de WebGL, que o jsdom não tem.
vi.mock('./OccurrenceMap', () => ({ OccurrenceMap: () => null }));

const panelOccurrences = vi.mocked(api.panelOccurrences);
const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const holes = '33333333-3333-4333-8333-333333333333';
const lights = '44444444-4444-4444-8444-444444444444';

const context: PanelContext = {
  tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
  user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos Almeida' },
  role: 'manager',
  departments: [],
};

function point(id: string, categoryId: string, categoryName: string): OccurrencePoint {
  return {
    id,
    location: { lat: -23.5, lng: -46.6 },
    categoryId,
    categoryName,
    icon: null,
    iconGroup: 'infrastructure',
    status: 'triage',
    requestCount: 1,
    statusSince: '2026-10-20T12:00:00.000Z',
  };
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(path = '/mapa') {
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
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support: null }}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <MapPage />
              <Location />
            </MemoryRouter>
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  panelOccurrences.mockImplementation(async (_tenant, params) => {
    const all = [
      point('11111111-1111-4111-8111-111111111111', lights, 'Iluminação'),
      point('22222222-2222-4222-8222-222222222222', holes, 'Buraco na via'),
    ];
    const items = params.categoryId ? all.filter((p) => p.categoryId === params.categoryId) : all;
    return { total: items.length, items };
  });
});

describe('map page', () => {
  it('shows the subtitle and keeps the filters in the url', async () => {
    const user = renderPage();
    expect(
      await screen.findByText('2 ocorrências abertas e em atendimento · últimos 30 dias'),
    ).toBeInTheDocument();
    expect(panelOccurrences).toHaveBeenCalledWith(tenantId, {
      status: 'open_and_in_progress',
      days: 30,
    });

    await user.selectOptions(screen.getByLabelText('Período'), 'null');
    expect(screen.getByTestId('location')).toHaveTextContent('?periodo=todo');
    expect(screen.getByText('Período: todo o período')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
  });

  it('category options come from the map without the category filter', async () => {
    const user = renderPage();
    const select = await screen.findByLabelText('Categoria');
    await screen.findByRole('option', { name: 'Buraco na via' });
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'todas',
      'Buraco na via',
      'Iluminação',
    ]);
    await user.selectOptions(select, holes);
    expect(await screen.findByText('Categoria: Buraco na via')).toBeInTheDocument();
    expect(
      await screen.findByText('1 ocorrência aberta e em atendimento · últimos 30 dias'),
    ).toBeInTheDocument();
    // A lista não encolhe com a categoria escolhida.
    expect((select as HTMLSelectElement).options).toHaveLength(3);
  });

  it('empty map shows the card', async () => {
    panelOccurrences.mockResolvedValue({ total: 0, items: [] });
    renderPage('/mapa?status=abertas');
    expect(await screen.findByText('Nenhuma ocorrência com estes filtros.')).toBeInTheDocument();
    expect(screen.getByText('Status: abertas')).toBeInTheDocument();
  });
});
