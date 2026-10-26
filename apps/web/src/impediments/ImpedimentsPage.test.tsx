import { ApiError } from '@alocidadao/api-client';
import type {
  ImpedimentDetail,
  PanelContext,
  TeamOptionsResponse,
  WorkQueueItem,
} from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { ImpedimentsPage } from './ImpedimentsPage';

vi.mock('../api', () => ({
  api: {
    panelImpediments: vi.fn(),
    panelImpediment: vi.fn(),
    panelTeams: vi.fn(),
    panelReassign: vi.fn(),
    panelReschedule: vi.fn(),
    panelReject: vi.fn(),
  },
}));

const panelImpediments = vi.mocked(api.panelImpediments);
const panelImpediment = vi.mocked(api.panelImpediment);
const panelTeams = vi.mocked(api.panelTeams);
const panelReassign = vi.mocked(api.panelReassign);
const panelReschedule = vi.mocked(api.panelReschedule);
const panelReject = vi.mocked(api.panelReject);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const holeId = '11111111-1111-4111-8111-111111111111';
const lampId = '22222222-2222-4222-8222-222222222222';
const currentTeam = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const teamPav = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teamSul = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
  statusSince: hoursAgo(3),
  impedimentReason: 'missing_material',
};
const lamp: WorkQueueItem = {
  ...hole,
  workOrderId: lampId,
  occurrenceId: 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  categoryName: 'Iluminação',
  address: 'Av. Brasil, 1450',
  statusSince: hoursAgo(26),
  impedimentReason: null,
};

function detail(item: WorkQueueItem, extra: Partial<ImpedimentDetail> = {}): ImpedimentDetail {
  return {
    workOrderId: item.workOrderId,
    occurrenceId: item.occurrenceId,
    status: 'impeded',
    categoryName: item.categoryName,
    icon: item.icon,
    iconGroup: item.iconGroup,
    categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    departmentName: item.departmentName,
    defaultDeadlineDays: 5,
    address: item.address,
    teamId: currentTeam,
    teamName: item.teamName,
    agentName: 'João Pereira',
    eventAt: '2026-10-22T12:10:00.000Z',
    distanceM: 8,
    activeRequestCount: 6,
    managerInstructions: 'Levar a massa fria.',
    reason: item.impedimentReason,
    note: 'Buraco maior que o previsto.',
    photoUrl: 'https://x/p.jpg',
    ...extra,
  };
}

const teamsResponse: TeamOptionsResponse = {
  suggestedTeamId: teamPav,
  defaultDueDate: '2099-01-10',
  departmentName: 'Obras',
  items: [
    {
      id: currentTeam,
      name: 'Centro',
      activeAgentCount: 1,
      openWorkOrderCount: 1,
      baseDistanceM: 500,
    },
    {
      id: teamPav,
      name: 'Pavimentação',
      activeAgentCount: 3,
      openWorkOrderCount: 4,
      baseDistanceM: 1100,
    },
    { id: teamSul, name: 'Sul', activeAgentCount: 2, openWorkOrderCount: 7, baseDistanceM: null },
  ],
};

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
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support: null }}>
          <ToastProvider>
            <MemoryRouter initialEntries={['/impedimentos']}>
              <ImpedimentsPage />
            </MemoryRouter>
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.resetAllMocks();
  panelImpediments.mockResolvedValue({ total: 2, items: [hole, lamp] });
  panelImpediment.mockImplementation(async (_tenant, id) =>
    id === holeId ? detail(hole) : detail(lamp, { photoUrl: null, note: null }),
  );
  panelTeams.mockResolvedValue(teamsResponse);
  panelReassign.mockResolvedValue({ workOrderId: holeId, status: 'cancelled' });
  panelReschedule.mockResolvedValue({ workOrderId: holeId, status: 'assigned' });
  panelReject.mockResolvedValue(undefined);
});

const confirm = () => screen.getByRole('button', { name: 'Confirmar próximo passo' });

describe('ImpedimentsPage', () => {
  it('impediment card shows the reason badge', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Buraco na via · Rua das Flores, 120' });
    expect(screen.getAllByText('Falta material ou equipamento').length).toBeGreaterThan(0);
    expect(screen.getByText('Outro motivo')).toBeInTheDocument();
    expect(
      screen.getByText('2 atividades que a equipe não conseguiu resolver. Decida o próximo passo.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Registrado em 22 out, 09:10')).toBeInTheDocument();
    expect(screen.getByText('Cidadãos veem: Em atendimento')).toBeInTheDocument();
    expect(screen.getByText('Buraco maior que o previsto.')).toBeInTheDocument();
  });

  it('empty details and empty queue use the texts', async () => {
    panelImpediments.mockResolvedValue({ total: 1, items: [lamp] });
    renderPage();
    expect(
      await screen.findByText(
        '1 atividade que a equipe não conseguiu resolver. Decida o próximo passo.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('O agente não escreveu detalhes.')).toBeInTheDocument();
  });

  it('empty queue shows the empty text', async () => {
    panelImpediments.mockResolvedValue({ total: 0, items: [] });
    renderPage();
    expect(await screen.findByText('Nenhum impedimento. Tudo em dia.')).toBeInTheDocument();
  });

  it('confirm stays disabled until an option is complete', async () => {
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(confirm()).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Recusar solicitação/ }));
    expect(confirm()).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo para os cidadãos'), 'curto');
    expect(confirm()).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo para os cidadãos'), ' o suficiente');
    expect(confirm()).toBeEnabled();
  });

  it('reassign lists the other teams of the department and sends team, date and instructions', async () => {
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    await user.click(screen.getByRole('radio', { name: /Reatribuir a outra equipe/ }));

    const select = await screen.findByLabelText('Equipe');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['Pavimentação · base a 1,1 km', 'Sul']);
    const instructions = screen.getByLabelText('Instruções para o agente');
    expect(instructions).toHaveValue('Levar a massa fria.');
    expect(screen.getByLabelText('Prazo interno')).toHaveValue('2099-01-10');
    await user.selectOptions(select, teamSul);
    await user.clear(instructions);
    await user.type(instructions, 'Levar rolo.');
    await user.click(confirm());

    await waitFor(() =>
      expect(panelReassign).toHaveBeenCalledWith(tenantId, holeId, {
        teamId: teamSul,
        dueDate: '2099-01-10',
        instructions: 'Levar rolo.',
      }),
    );
    expect(await screen.findByText('Reatribuída a Sul.')).toBeInTheDocument();
  });

  it('reassign without other teams shows the empty text', async () => {
    panelTeams.mockResolvedValue({ ...teamsResponse, items: [teamsResponse.items[0]!] });
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    await user.click(screen.getByRole('radio', { name: /Reatribuir a outra equipe/ }));
    expect(
      await screen.findByText(
        'Nenhuma outra equipe do setor Obras. Cadastre uma em Equipes e agentes.',
      ),
    ).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
  });

  it('reschedule sends the new date and shows the notice', async () => {
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    await user.click(screen.getByRole('radio', { name: /Reagendar com a mesma equipe/ }));
    const date = await screen.findByLabelText('Nova data');
    await waitFor(() => expect(date).toHaveValue('2099-01-10'));
    await user.click(confirm());

    await waitFor(() =>
      expect(panelReschedule).toHaveBeenCalledWith(tenantId, holeId, { dueDate: '2099-01-10' }),
    );
    expect(await screen.findByText('Reagendada para 10 jan.')).toBeInTheDocument();
  });

  it('reject from impediment sends the reason and shows the notice', async () => {
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    await user.click(screen.getByRole('radio', { name: /Recusar solicitação/ }));
    expect(screen.getByText('Os 6 cidadãos que relataram recebem este texto.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Motivo para os cidadãos'), '  Não é da prefeitura.  ');
    await user.click(confirm());

    await waitFor(() =>
      expect(panelReject).toHaveBeenCalledWith(tenantId, hole.occurrenceId, {
        reason: 'Não é da prefeitura.',
      }),
    );
    expect(await screen.findByText('Ocorrência recusada.')).toBeInTheDocument();
  });

  it('409 shows the changed notice and reloads the queue', async () => {
    panelReschedule.mockRejectedValue(new ApiError(409, { code: 'work_order_unavailable' }));
    const { user } = renderPage();
    await screen.findByText('Próximo passo');
    await user.click(screen.getByRole('radio', { name: /Reagendar com a mesma equipe/ }));
    await waitFor(() => expect(screen.getByLabelText('Nova data')).toHaveValue('2099-01-10'));
    panelImpediments.mockResolvedValue({ total: 1, items: [lamp] });
    await user.click(confirm());
    expect(await screen.findByText('Esta atividade mudou. Atualizamos o painel.')).toBeVisible();
    await waitFor(() => expect(panelImpediments).toHaveBeenCalledTimes(2));
  });
});
