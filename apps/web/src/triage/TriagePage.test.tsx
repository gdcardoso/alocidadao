import { ApiError } from '@alocidadao/api-client';
import type { OccurrenceDetail, PanelContext, TriageRow } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { TriagePage } from './TriagePage';

vi.mock('../api', () => ({
  api: { panelTriage: vi.fn(), panelOccurrence: vi.fn(), panelMerge: vi.fn() },
}));

const panelTriage = vi.mocked(api.panelTriage);
const panelOccurrence = vi.mocked(api.panelOccurrence);
const panelMerge = vi.mocked(api.panelMerge);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const lightId = '11111111-1111-4111-8111-111111111111';
const holeId = '22222222-2222-4222-8222-222222222222';
const holesCategory = '44444444-4444-4444-8444-444444444444';
const busyHoleId = '77777777-7777-4777-8777-777777777777';

const context: PanelContext = {
  tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
  user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos Almeida' },
  role: 'manager',
  departments: [],
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000 - 60_000).toISOString();

const rows: TriageRow[] = [
  {
    occurrenceId: lightId,
    protocol: '2026-000088',
    categoryName: 'Iluminação',
    categoryId: '66666666-6666-4666-8666-666666666666',
    icon: 'lightbulb',
    iconGroup: 'infrastructure',
    address: 'Av. Brasil, 1450',
    departmentName: 'Iluminação',
    requestCount: 1,
    suggestionCount: 0,
    statusSince: hoursAgo(80),
  },
  {
    occurrenceId: holeId,
    protocol: '2026-000123',
    categoryName: 'Buraco na via',
    categoryId: holesCategory,
    icon: 'construction',
    iconGroup: 'infrastructure',
    address: 'Rua das Flores, 120',
    departmentName: 'Obras',
    requestCount: 6,
    suggestionCount: 2,
    statusSince: hoursAgo(5),
  },
];

function occurrenceDetail(): OccurrenceDetail {
  return {
    id: holeId,
    status: 'triage',
    statusSince: hoursAgo(5),
    category: {
      id: holesCategory,
      name: 'Buraco na via',
      icon: 'construction',
      iconGroup: 'infrastructure',
      clusterRadiusM: 15,
      defaultDeadlineDays: 5,
      departmentId: '55555555-5555-4555-8555-555555555555',
      departmentName: 'Obras',
    },
    address: 'Rua das Flores, 120',
    location: { lat: -23.55, lng: -46.63 },
    requestCount: 1,
    requests: [
      {
        id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        protocol: '2026-000123',
        description: 'Buraco grande',
        createdAt: '2026-10-20T15:00:00.000Z',
        distanceM: 0,
        photoUrl: null,
      },
    ],
    suggestions: [],
    activeWorkOrder: null,
  };
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = '/triagem') {
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
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined }}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <TriagePage />
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
  panelTriage.mockImplementation(async (_tenant, params) => {
    let items = params.onlySuggestions ? rows.filter((r) => r.suggestionCount > 0) : rows;
    if (params.categoryId) items = items.filter((r) => r.categoryId === params.categoryId);
    return { total: 12, items };
  });
  panelOccurrence.mockResolvedValue(occurrenceDetail());
});

describe('triage page', () => {
  it('rows show protocol, address, reports, suggestion badge and late in danger', async () => {
    renderPage();
    await screen.findByText('2026-000088');
    const [lights, hole] = screen.getAllByRole('row').slice(1) as [HTMLElement, HTMLElement];
    expect(within(lights).getByText('2026-000088')).toBeInTheDocument();
    expect(within(lights).getByText('Av. Brasil, 1450')).toBeInTheDocument();
    expect(within(lights).getByText('3 dias')).toHaveAttribute('data-late', 'true');
    expect(within(lights).queryByText(/parecida/)).not.toBeInTheDocument();

    expect(within(hole).getByText('6')).toBeInTheDocument();
    expect(within(hole).getByText('+2 parecidas')).toBeInTheDocument();
    expect(within(hole).getByText('5 h')).toHaveAttribute('data-late', 'false');
    expect(within(hole).getByText('Obras')).toBeInTheDocument();
    expect(
      screen.getByText('12 solicitações novas aguardando análise · mais antigas primeiro'),
    ).toBeInTheDocument();
  });

  it('only-suggestions toggle filters through the api', async () => {
    const user = renderPage();
    await screen.findByText('2026-000088');
    expect(panelTriage).toHaveBeenCalledWith(tenantId, { onlySuggestions: false });

    await user.click(screen.getByRole('button', { name: 'Só com sugestão de agrupamento' }));
    expect(panelTriage).toHaveBeenCalledWith(tenantId, { onlySuggestions: true });
    expect(screen.getByTestId('location')).toHaveTextContent('?sugestao=1');
    expect(await screen.findByText('2026-000123')).toBeInTheDocument();
    expect(screen.queryByText('2026-000088')).not.toBeInTheDocument();
  });

  it('category filter comes from the unfiltered queue and goes through the api', async () => {
    const user = renderPage();
    const select = await screen.findByLabelText('Categoria');
    await screen.findByRole('option', { name: 'Iluminação' });
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'todas',
      'Buraco na via',
      'Iluminação',
    ]);
    await user.selectOptions(select, holesCategory);
    expect(panelTriage).toHaveBeenCalledWith(tenantId, {
      categoryId: holesCategory,
      onlySuggestions: false,
    });
    expect(screen.getByTestId('location')).toHaveTextContent(`?categoria=${holesCategory}`);
    expect(await screen.findByText('Categoria: Buraco na via')).toBeInTheDocument();
    // A lista não encolhe com a categoria escolhida.
    expect((select as HTMLSelectElement).options).toHaveLength(3);
  });

  it('analyze opens the point panel drawer and updates the url', async () => {
    const user = renderPage();
    const row = (await screen.findByText('2026-000123')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Analisar' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`?ocorrencia=${holeId}`);
    expect(await screen.findByRole('complementary', { name: 'Painel do ponto' })).toBeVisible();
    expect(panelOccurrence).toHaveBeenCalledWith(tenantId, holeId);

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Painel do ponto' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('ocorrencia');
  });

  it('drawer opens from the url and closes with the x', async () => {
    const user = renderPage(`/triagem?ocorrencia=${holeId}`);
    expect(await screen.findByRole('complementary', { name: 'Painel do ponto' })).toBeVisible();
    // Espera o detalhe carregar: o painel troca de árvore quando ele chega.
    await screen.findByText('Buraco grande');
    await user.click(screen.getByRole('button', { name: 'Fechar painel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Painel do ponto' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('empty triage shows the all-clear message', async () => {
    panelTriage.mockResolvedValue({ total: 0, items: [] });
    renderPage();
    expect(await screen.findByText('Nenhuma solicitação nova. Tudo em dia.')).toBeInTheDocument();
  });

  it('footer shows shown of total', async () => {
    renderPage();
    expect(
      await screen.findByText(
        'Mostrando 2 de 12 · Ao analisar, abre o mesmo painel do mapa (agrupar, atribuir ou recusar).',
      ),
    ).toBeInTheDocument();
  });

  it('ver no mapa links to the map', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Ver no mapa' })).toHaveAttribute(
      'href',
      '/mapa',
    );
  });

  it('merge into a suggestion with a work order opens the survivor in the drawer', async () => {
    const notFound = new ApiError(404, { code: 'occurrence_not_found' });
    let merged = false;
    panelOccurrence.mockImplementation(async (_tenant, id) => {
      if (id === busyHoleId) {
        return {
          ...occurrenceDetail(),
          id: busyHoleId,
          status: 'in_progress',
          address: 'Rua das Flores, 130',
          suggestions: [],
        };
      }
      if (merged) throw notFound;
      return {
        ...occurrenceDetail(),
        suggestions: [
          {
            occurrenceId: busyHoleId,
            protocol: '2026-000140',
            categoryName: 'Buraco na via',
            description: null,
            distanceM: 8,
            requestCount: 2,
          },
        ],
      };
    });
    panelMerge.mockImplementation(async () => {
      merged = true;
      return { survivorId: busyHoleId };
    });
    const user = renderPage(`/triagem?ocorrencia=${holeId}`);
    await user.click(await screen.findByRole('button', { name: 'Juntar a este ponto' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`?ocorrencia=${busyHoleId}`),
    );
    const drawer = await screen.findByRole('complementary', { name: 'Painel do ponto' });
    expect(await within(drawer).findByText('Rua das Flores, 130')).toBeInTheDocument();
    expect(screen.getByText('Relatos juntados a este ponto.')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível concluir. Tente de novo.')).not.toBeInTheDocument();
  });

  it('occurrence merged elsewhere closes the drawer with the changed notice', async () => {
    panelOccurrence.mockRejectedValue(new ApiError(404, { code: 'occurrence_not_found' }));
    renderPage(`/triagem?ocorrencia=${holeId}`);

    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('ocorrencia'));
    expect(
      screen.queryByRole('complementary', { name: 'Painel do ponto' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Esta ocorrência mudou. Atualizamos o painel.')).toBeInTheDocument();
  });
});
