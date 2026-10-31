import { ApiError } from '@alocidadao/api-client';
import type { OccurrenceDetail, PanelContext } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { PointPanel } from './PointPanel';

vi.mock('../api', () => ({
  api: {
    panelOccurrence: vi.fn(),
    panelMerge: vi.fn(),
    panelDismissSuggestion: vi.fn(),
    panelSplit: vi.fn(),
    panelReject: vi.fn(),
  },
}));

const panelOccurrence = vi.mocked(api.panelOccurrence);
const panelMerge = vi.mocked(api.panelMerge);
const panelDismissSuggestion = vi.mocked(api.panelDismissSuggestion);
const panelSplit = vi.mocked(api.panelSplit);
const panelReject = vi.mocked(api.panelReject);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const occurrenceId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const requestIds = [1, 2, 3, 4, 5, 6].map((n) => `aaaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);

const context: PanelContext = {
  tenant: { id: tenantId, displayName: 'Prefeitura de São Paulo', status: 'active', bounds: null },
  user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos Almeida' },
  role: 'manager',
  departments: [],
};

function detail(overrides: Partial<OccurrenceDetail> = {}): OccurrenceDetail {
  return {
    id: occurrenceId,
    status: 'triage',
    statusSince: new Date(Date.now() - 2 * 86_400_000 - 60_000).toISOString(),
    category: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Buraco na via',
      icon: 'construction',
      iconGroup: 'infrastructure',
      clusterRadiusM: 15,
      defaultDeadlineDays: 5,
      departmentId: '44444444-4444-4444-8444-444444444444',
      departmentName: 'Obras',
    },
    address: 'Rua das Flores, 120 — Centro',
    location: { lat: -23.55, lng: -46.63 },
    requestCount: 6,
    requests: requestIds.map((id, index) => ({
      id,
      protocol: `2026-00012${index + 3}`,
      description:
        index === 0
          ? 'Buraco grande perto da faixa de pedestres'
          : index === 1
            ? 'Já tem carro batendo a roda aqui'
            : index === 2
              ? null
              : `Relato ${index + 1}`,
      createdAt: '2026-10-20T15:00:00.000Z',
      distanceM: index === 0 ? 0.4 : index * 6,
      photoUrl: null,
    })),
    suggestions: [
      {
        occurrenceId: otherId,
        protocol: '2026-000140',
        categoryName: 'Buraco na via',
        description: 'Buraco na esquina com a Rua Ipê',
        distanceM: 22.2,
        requestCount: 1,
      },
    ],
    activeWorkOrder: null,
    ...overrides,
  };
}

function renderPanel(
  props: { onAssign?: () => void; onChanged?: () => void; dueAt?: string | null } = {},
) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onAssign = props.onAssign ?? vi.fn();
  const onChanged = props.onChanged ?? vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support: null }}>
          <ToastProvider>
            <PointPanel
              occurrenceId={occurrenceId}
              dueAt={props.dueAt}
              onClose={onClose}
              onAssign={onAssign}
              onChanged={onChanged}
            />
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { onAssign, onChanged, onClose, user: userEvent.setup() };
}

beforeEach(() => {
  vi.resetAllMocks();
  panelOccurrence.mockResolvedValue(detail());
});

describe('point panel', () => {
  it('point panel shows two reports and expands the rest', async () => {
    const { user } = renderPanel();
    expect(await screen.findByRole('heading', { name: 'Buraco na via' })).toBeInTheDocument();
    expect(screen.getByText('Rua das Flores, 120 — Centro')).toBeInTheDocument();
    expect(screen.getByText('Aberta há 2 dias')).toBeInTheDocument();
    expect(screen.getByText('6 relatos')).toBeInTheDocument();
    expect(screen.getByText('Raio 15 m')).toBeInTheDocument();
    expect(screen.getByText('Buraco grande perto da faixa de pedestres')).toBeInTheDocument();
    expect(screen.getByText('2026-000123 · 20 out · centro do ponto')).toBeInTheDocument();
    expect(screen.getByText('2026-000124 · 20 out · a 6 m')).toBeInTheDocument();
    expect(screen.queryByText('2026-000125 · 20 out · a 12 m')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver os outros 4 relatos' }));
    expect(screen.getByText('2026-000125 · 20 out · a 12 m')).toBeInTheDocument();
    expect(screen.getByText('Sem observação')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(screen.queryByRole('button', { name: /Ver os outros/ })).not.toBeInTheDocument();
  });

  it('shows the deadline tag only when there is a dueAt', async () => {
    renderPanel({ dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(await screen.findByText(/^Atrasada há \d+ dias?$|^Atrasada hoje$/)).toBeInTheDocument();
  });

  it('shows ver mais 1 relato with three reports', async () => {
    const base = detail();
    panelOccurrence.mockResolvedValue(
      detail({ requestCount: 3, requests: base.requests.slice(0, 3) }),
    );
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Ver mais 1 relato' })).toBeInTheDocument();
  });

  it('unchecking a report disables assign with the hint and enables split', async () => {
    const onAssign = vi.fn();
    const { user } = renderPanel({ onAssign });
    const assign = await screen.findByRole('button', { name: 'Atribuir a uma equipe' });
    const split = screen.getByRole('button', { name: 'Separar desmarcados' });
    expect(assign).toBeEnabled();
    expect(split).toBeDisabled();

    await user.click(assign);
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: occurrenceId }));

    await user.click(screen.getByRole('checkbox', { name: 'Relato 2026-000124' }));
    expect(assign).toBeDisabled();
    expect(
      screen.getByText('Separe os relatos desmarcados antes de atribuir.'),
    ).toBeInTheDocument();
    expect(split).toBeEnabled();

    // Todos desmarcados: separar não faz sentido.
    await user.click(screen.getByRole('button', { name: 'Ver os outros 4 relatos' }));
    for (const box of screen.getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) await user.click(box);
    }
    expect(split).toBeDisabled();
  });

  it('merge suggestion calls merge and shows the notice', async () => {
    panelMerge.mockResolvedValue({ survivorId: otherId });
    const onChanged = vi.fn();
    const { user } = renderPanel({ onChanged });
    expect(await screen.findByText('1 relato parecido a 22 m')).toBeInTheDocument();
    expect(
      screen.getByText('2026-000140 · Buraco na via · "Buraco na esquina com a Rua Ipê"'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Juntar a este ponto' }));
    expect(panelMerge).toHaveBeenCalledWith(tenantId, occurrenceId, {
      otherOccurrenceId: otherId,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Relatos juntados a este ponto.');
    expect(onChanged).toHaveBeenCalledWith({ kind: 'merge', survivorId: otherId });
  });

  it('dismissing a suggestion removes the card', async () => {
    panelDismissSuggestion.mockResolvedValue(undefined);
    panelOccurrence.mockResolvedValueOnce(detail()).mockResolvedValue(detail({ suggestions: [] }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'É outro problema' }));
    expect(panelDismissSuggestion).toHaveBeenCalledWith(tenantId, occurrenceId, {
      otherOccurrenceId: otherId,
    });
    await vi.waitFor(() =>
      expect(screen.queryByText('1 relato parecido a 22 m')).not.toBeInTheDocument(),
    );
  });

  it('split confirms with the count and shows the notice', async () => {
    panelSplit.mockResolvedValue({ newOccurrenceId: otherId });
    const { user } = renderPanel();
    await user.click(await screen.findByRole('checkbox', { name: 'Relato 2026-000124' }));
    await user.click(screen.getByRole('button', { name: 'Separar desmarcados' }));
    const dialog = screen.getByRole('dialog', { name: 'Separar 1 relato?' });
    expect(
      within(dialog).getByText('Eles viram uma nova ocorrência em triagem, no mesmo lugar.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Separar' }));
    // Vão para a nova ocorrência os relatos desmarcados.
    expect(panelSplit).toHaveBeenCalledWith(tenantId, occurrenceId, {
      requestIds: [requestIds[1]],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 relato separado em uma nova ocorrência.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('split title pluralizes', async () => {
    const { user } = renderPanel();
    await user.click(await screen.findByRole('checkbox', { name: 'Relato 2026-000123' }));
    await user.click(screen.getByRole('checkbox', { name: 'Relato 2026-000124' }));
    await user.click(screen.getByRole('button', { name: 'Separar desmarcados' }));
    expect(screen.getByRole('dialog', { name: 'Separar 2 relatos?' })).toBeInTheDocument();
  });

  it('reject requires 10 characters and shows the citizens count', async () => {
    panelReject.mockResolvedValue(undefined);
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = screen.getByRole('dialog', { name: 'Recusar ocorrência' });
    expect(
      within(dialog).getByText('Buraco na via · Rua das Flores, 120 — Centro · 6 relatos'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Os 6 cidadãos que relataram recebem este texto.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('A ocorrência sai das filas e os cidadãos veem "Recusada".'),
    ).toBeInTheDocument();
    const field = within(dialog).getByLabelText(/Motivo para os cidadãos/);
    expect(field).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Recusar' });
    await user.type(field, '  curto   ');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'Não é da prefeitura');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(panelReject).toHaveBeenCalledWith(tenantId, occurrenceId, {
      reason: 'Não é da prefeitura',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Ocorrência recusada.');
  });

  it('reject with one report speaks of one citizen', async () => {
    const base = detail();
    panelOccurrence.mockResolvedValue(
      detail({ requestCount: 1, requests: base.requests.slice(0, 1), address: null }),
    );
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Buraco na via · 1 relato')).toBeInTheDocument();
    expect(
      within(dialog).getByText('O cidadão que relatou recebe este texto.'),
    ).toBeInTheDocument();
  });

  it('in-progress occurrence shows the team line and only reject', async () => {
    panelOccurrence.mockResolvedValue(
      detail({
        status: 'in_progress',
        activeWorkOrder: {
          id: '55555555-5555-4555-8555-555555555555',
          status: 'in_execution',
          teamName: 'Equipe Tapa-buraco Centro',
        },
      }),
    );
    renderPanel();
    expect(
      await screen.findByText('Atribuída a Equipe Tapa-buraco Centro · Em execução'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Em atendimento há/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atribuir a uma equipe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Separar desmarcados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('closed occurrence has no footer', async () => {
    panelOccurrence.mockResolvedValue(detail({ status: 'completed', suggestions: [] }));
    renderPanel();
    expect(await screen.findByText(/^Concluída há/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
  });

  it('409 occurrence_unavailable shows the notice and refetches', async () => {
    panelMerge.mockRejectedValue(new ApiError(409, { code: 'occurrence_unavailable' }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Juntar a este ponto' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Esta ocorrência mudou. Atualizamos o painel.',
    );
    await vi.waitFor(() => expect(panelOccurrence).toHaveBeenCalledTimes(2));
  });

  it('both_have_work_orders shows its message', async () => {
    panelMerge.mockRejectedValue(new ApiError(409, { code: 'both_have_work_orders' }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Juntar a este ponto' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'As duas ocorrências têm atividade em andamento. Cancele uma antes de juntar.',
    );
  });

  it('unexpected error shows the generic notice and keeps the reject dialog', async () => {
    panelReject.mockRejectedValue(new ApiError(500, { code: 'internal' }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Fora da área do município');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não foi possível concluir. Tente de novo.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('404 occurrence_not_found closes the panel with the changed notice', async () => {
    panelOccurrence.mockRejectedValue(new ApiError(404, { code: 'occurrence_not_found' }));
    const { onClose } = renderPanel();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Esta ocorrência mudou. Atualizamos o painel.',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Não foi possível concluir. Tente de novo.')).not.toBeInTheDocument();
  });

  it('other load errors keep the generic message', async () => {
    panelOccurrence.mockRejectedValue(new ApiError(500, { code: 'internal' }));
    const { onClose } = renderPanel();
    expect(
      await screen.findByText('Não foi possível concluir. Tente de novo.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('occurrence merged by someone else closes the panel after the stale action', async () => {
    const notFound = new ApiError(404, { code: 'occurrence_not_found' });
    panelOccurrence.mockResolvedValueOnce(detail()).mockRejectedValue(notFound);
    panelMerge.mockRejectedValue(notFound);
    const { onClose, user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Juntar a este ponto' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Esta ocorrência mudou. Atualizamos o painel.',
    );
  });
});
