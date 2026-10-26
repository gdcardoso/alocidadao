import { ApiError } from '@alocidadao/api-client';
import type { OccurrenceDetail, PanelContext, TeamOptionsResponse } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { AssignDialog } from './AssignDialog';

vi.mock('../api', () => ({ api: { panelTeams: vi.fn(), panelAssign: vi.fn() } }));
const panelTeams = vi.mocked(api.panelTeams);
const panelAssign = vi.mocked(api.panelAssign);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const occurrenceId = '11111111-1111-4111-8111-111111111111';
const teamA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teamB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const teamC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const context: PanelContext = {
  tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
  user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos Almeida' },
  role: 'manager',
  departments: [],
};

const occurrence = {
  id: occurrenceId,
  category: { name: 'Buraco na via', defaultDeadlineDays: 5, departmentName: 'Obras' },
  address: 'Rua das Flores, 120',
  requestCount: 6,
} as unknown as OccurrenceDetail;

const teamsResponse: TeamOptionsResponse = {
  suggestedTeamId: teamA,
  defaultDueDate: '2099-01-10',
  departmentName: 'Obras',
  items: [
    {
      id: teamA,
      name: 'Obras · Centro',
      activeAgentCount: 3,
      openWorkOrderCount: 4,
      baseDistanceM: 1100,
    },
    {
      id: teamB,
      name: 'Obras · Zona Norte',
      activeAgentCount: 2,
      openWorkOrderCount: 7,
      baseDistanceM: 6400,
    },
    {
      id: teamC,
      name: 'Sem base',
      activeAgentCount: 1,
      openWorkOrderCount: 1,
      baseDistanceM: null,
    },
  ],
};

function renderDialog() {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onAssigned = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined }}>
          <ToastProvider>
            <AssignDialog occurrence={occurrence} onClose={onClose} onAssigned={onAssigned} />
          </ToastProvider>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { onClose, onAssigned, user: userEvent.setup() };
}

beforeEach(() => {
  vi.resetAllMocks();
  panelTeams.mockResolvedValue(teamsResponse);
});

describe('assign dialog', () => {
  it('nearest team with base comes selected with the suggested badge', async () => {
    renderDialog();
    expect(await screen.findByRole('radio', { name: /Obras · Centro/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Obras · Zona Norte/ })).not.toBeChecked();
    expect(screen.getByText('Sugerida: mais próxima')).toBeInTheDocument();
    expect(
      screen.getByText('3 agentes · 4 atividades abertas · base a 1,1 km'),
    ).toBeInTheDocument();
    expect(screen.getByText('Buraco na via · Rua das Flores, 120 · 6 relatos')).toBeInTheDocument();
    expect(screen.getByText('Sugerido pela categoria Buraco na via.')).toBeInTheDocument();
    expect(screen.getByLabelText('Prazo interno')).toHaveValue('2099-01-10');
    expect(screen.getByRole('button', { name: 'Atribuir' })).toBeEnabled();
  });

  it('no team in the department disables assign with the message', async () => {
    panelTeams.mockResolvedValue({ ...teamsResponse, suggestedTeamId: null, items: [] });
    renderDialog();
    expect(
      await screen.findByText('Nenhuma equipe do setor Obras. Cadastre uma em Equipes e agentes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atribuir' })).toBeDisabled();
  });

  it('assign sends team, date and trimmed instructions and shows the notice', async () => {
    panelAssign.mockResolvedValue({ occurrenceId, workOrderId: 'w' });
    const { user, onAssigned } = renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Obras · Zona Norte/ }));
    await user.type(screen.getByLabelText('Instruções para o agente'), '  Levar cones  ');
    await user.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(panelAssign).toHaveBeenCalledWith(tenantId, occurrenceId, {
      teamId: teamB,
      dueDate: '2099-01-10',
      instructions: 'Levar cones',
    });
    expect(await screen.findByText('Atribuída a Obras · Zona Norte.')).toBeInTheDocument();
    expect(onAssigned).toHaveBeenCalled();
  });

  it('blank instructions are sent as null', async () => {
    panelAssign.mockResolvedValue({ occurrenceId, workOrderId: 'w' });
    const { user } = renderDialog();
    await screen.findByRole('radio', { name: /Obras · Centro/ });
    await user.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(panelAssign).toHaveBeenCalledWith(
      tenantId,
      occurrenceId,
      expect.objectContaining({ teamId: teamA, instructions: null }),
    );
  });

  it.each(['team_not_eligible', 'due_date_in_past'])(
    '%s shows the generic error and keeps the dialog open',
    async (code) => {
      panelAssign.mockRejectedValue(new ApiError(422, { code }));
      const { user, onClose, onAssigned } = renderDialog();
      await screen.findByRole('radio', { name: /Obras · Centro/ });
      await user.click(screen.getByRole('button', { name: 'Atribuir' }));
      expect(
        await screen.findByText('Não foi possível concluir. Tente de novo.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(onAssigned).not.toHaveBeenCalled();
    },
  );

  it('409 occurrence_unavailable shows the notice and closes', async () => {
    panelAssign.mockRejectedValue(new ApiError(409, { code: 'occurrence_unavailable' }));
    const { user, onClose } = renderDialog();
    await screen.findByRole('radio', { name: /Obras · Centro/ });
    await user.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(
      await screen.findByText('Esta ocorrência mudou. Atualizamos o painel.'),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
