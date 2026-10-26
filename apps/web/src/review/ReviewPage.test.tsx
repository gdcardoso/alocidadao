import { ApiError } from '@alocidadao/api-client';
import type { PanelContext, ReviewDetail, WorkQueueItem } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext, panelCountsKey } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { ReviewPage } from './ReviewPage';

vi.mock('../api', () => ({
  api: {
    panelReviews: vi.fn(),
    panelReview: vi.fn(),
    panelPublish: vi.fn(),
    panelRework: vi.fn(),
  },
}));

const panelReviews = vi.mocked(api.panelReviews);
const panelReview = vi.mocked(api.panelReview);
const panelPublish = vi.mocked(api.panelPublish);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const holeId = '11111111-1111-4111-8111-111111111111';
const treeId = '22222222-2222-4222-8222-222222222222';
const lostId = '33333333-3333-4333-8333-333333333333';
const photoA = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const photoB = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const context: PanelContext = {
  tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
  user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos Almeida' },
  role: 'manager',
  departments: [],
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000 - 60_000).toISOString();

const hole: WorkQueueItem = {
  workOrderId: holeId,
  occurrenceId: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  categoryName: 'Buraco na via',
  icon: 'construction',
  iconGroup: 'infrastructure',
  address: 'Rua das Flores, 120',
  departmentName: 'Obras',
  teamName: 'Centro',
  statusSince: hoursAgo(30),
  impedimentReason: null,
};
const tree: WorkQueueItem = {
  ...hole,
  workOrderId: treeId,
  occurrenceId: 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  categoryName: 'Poda de árvore',
  address: null,
  departmentName: 'Parques',
  teamName: 'Sul',
  statusSince: hoursAgo(3),
};

function detail(item: WorkQueueItem, extra: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    workOrderId: item.workOrderId,
    occurrenceId: item.occurrenceId,
    status: 'awaiting_review',
    categoryName: item.categoryName,
    icon: item.icon,
    iconGroup: item.iconGroup,
    categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    departmentName: item.departmentName,
    defaultDeadlineDays: 5,
    address: item.address,
    teamId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    teamName: item.teamName,
    agentName: 'João Pereira',
    eventAt: '2026-10-21T18:40:00.000Z',
    distanceM: 8,
    activeRequestCount: 6,
    managerInstructions: null,
    agentNote: 'tapei o buraco c asfalto frio',
    pendingPhotos: [
      { id: photoA, url: 'https://x/a.jpg' },
      { id: photoB, url: 'https://x/b.jpg' },
    ],
    citizenPhotos: [{ url: 'https://x/c.jpg' }],
    ...extra,
  };
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = '/revisao') {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support: null }}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <ReviewPage />
              <Location />
            </MemoryRouter>
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), invalidate };
}

beforeEach(() => {
  vi.resetAllMocks();
  panelReviews.mockResolvedValue({ total: 2, items: [hole, tree] });
  panelReview.mockImplementation(async (_tenant, id) =>
    id === holeId ? detail(hole) : detail(tree, { distanceM: 250, agentNote: null }),
  );
  panelPublish.mockResolvedValue({ workOrderId: holeId, status: 'completed' });
});

const publishButton = () => screen.getByRole('button', { name: 'Publicar para os cidadãos' });

describe('ReviewPage', () => {
  it('review queue opens the first item and marks late waits in warning', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Buraco na via · Rua das Flores, 120' });
    expect(screen.getByTestId('location')).toHaveTextContent(`atividade=${holeId}`);
    expect(screen.getByText('há 1 dia')).toHaveAttribute('data-late', 'true');
    expect(screen.getByText('há 3 h')).toHaveAttribute('data-late', 'false');
    // Sem endereço, a meta começa no setor.
    expect(screen.getByText('Parques · Sul')).toBeInTheDocument();
    expect(screen.getByText('Rua das Flores, 120 · Obras · Centro')).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 atendimentos concluídos pelas equipes. O cidadão só recebe depois que você publicar.',
      ),
    ).toBeInTheDocument();
  });

  it('subtitle uses the singular for one item', async () => {
    panelReviews.mockResolvedValue({ total: 1, items: [hole] });
    renderPage();
    expect(
      await screen.findByText(
        '1 atendimento concluído pela equipe. O cidadão só recebe depois que você publicar.',
      ),
    ).toBeInTheDocument();
  });

  it('publish sends only the checked photos and the trimmed text', async () => {
    const { user } = renderPage();
    await screen.findByText('Fotos do serviço');
    const [first, second] = screen.getAllByRole('checkbox') as [HTMLElement, HTMLElement];
    expect(first).toBeChecked();
    expect(second).toBeChecked();
    await user.click(second);
    expect(screen.getByText('Não publicar')).toBeInTheDocument();

    const note = screen.getByLabelText('Texto para o cidadão');
    expect(note).toHaveValue('tapei o buraco c asfalto frio');
    await user.clear(note);
    await user.type(note, '  Buraco tapado com asfalto a frio.  ');
    await user.click(publishButton());

    await waitFor(() =>
      expect(panelPublish).toHaveBeenCalledWith(tenantId, holeId, {
        publicNote: 'Buraco tapado com asfalto a frio.',
        publishedPhotoIds: [photoA],
      }),
    );
    expect(await screen.findByText('Publicado para os cidadãos.')).toBeInTheDocument();
  });

  it('publish is disabled with fewer than 10 characters', async () => {
    const { user } = renderPage();
    await screen.findByText('Fotos do serviço');
    const note = screen.getByLabelText('Texto para o cidadão');
    await user.clear(note);
    await user.type(note, '  curto   ');
    expect(publishButton()).toBeDisabled();
    await user.type(note, ' agora sim');
    expect(publishButton()).toBeEnabled();
    expect(
      screen.getByText('Os 6 cidadãos recebem este texto e as fotos marcadas.'),
    ).toBeInTheDocument();
  });

  it('after publishing the next item opens and counts are invalidated', async () => {
    const { user, invalidate } = renderPage();
    await screen.findByText('Fotos do serviço');
    panelReviews.mockResolvedValue({ total: 1, items: [tree] });
    await user.click(publishButton());

    await screen.findByRole('heading', { name: 'Poda de árvore' });
    expect(screen.getByTestId('location')).toHaveTextContent(`atividade=${treeId}`);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: panelCountsKey(tenantId) });
    expect(panelReviews).toHaveBeenCalledTimes(2);
  });

  it('409 work_order_unavailable shows the notice and refetches', async () => {
    panelPublish.mockRejectedValue(new ApiError(409, { code: 'work_order_unavailable' }));
    const { user, invalidate } = renderPage();
    await screen.findByText('Fotos do serviço');
    panelReviews.mockResolvedValue({ total: 1, items: [tree] });
    await user.click(publishButton());

    expect(await screen.findByText('Esta atividade mudou. Atualizamos o painel.')).toBeVisible();
    await waitFor(() => expect(panelReviews).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: panelCountsKey(tenantId) });
  });

  it('distance shows on site, far away or no location', async () => {
    const lost: WorkQueueItem = { ...tree, workOrderId: lostId, categoryName: 'Calçada' };
    panelReviews.mockResolvedValue({ total: 3, items: [hole, tree, lost] });
    panelReview.mockImplementation(async (_tenant, id) =>
      id === holeId
        ? detail(hole)
        : id === treeId
          ? detail(tree, { distanceM: 250 })
          : detail(lost, { distanceM: null }),
    );
    const { user } = renderPage();
    expect(await screen.findByText('No local (a 8 m)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Poda de árvore/ }));
    expect(await screen.findByText('Longe do local (a 250 m)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Calçada/ }));
    expect(await screen.findByText('Sem localização na conclusão')).toBeInTheDocument();
  });

  it('empty queue shows the empty text', async () => {
    panelReviews.mockResolvedValue({ total: 0, items: [] });
    renderPage();
    expect(await screen.findByText('Nenhum atendimento aguardando revisão.')).toBeInTheDocument();
  });
});
