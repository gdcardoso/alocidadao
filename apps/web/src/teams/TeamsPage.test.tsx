import { ApiError } from '@alocidadao/api-client';
import type { AgentRow, PanelContext, TeamSummary } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { PanelValueContext } from '../shell/use-panel';
import { ToastProvider } from '../ui/Toast';
import { TeamsPage } from './TeamsPage';

vi.mock('../api', () => ({
  api: {
    panelTeamsList: vi.fn(),
    panelCreateTeam: vi.fn(),
    panelUpdateTeam: vi.fn(),
    panelAgents: vi.fn(),
    panelAddAgent: vi.fn(),
    panelUpdateAgent: vi.fn(),
    panelResendAgentInvite: vi.fn(),
    panelDepartments: vi.fn(),
  },
}));
// O MapLibre precisa de WebGL: o mapa vira um botão que "clica" num ponto fixo.
vi.mock('./BasePickerMap', () => ({
  BasePickerMap: (props: {
    value: { lat: number; lng: number } | null;
    onPick: (point: { lat: number; lng: number }) => void;
  }) => (
    <div>
      <button type="button" onClick={() => props.onPick({ lat: -23.5, lng: -46.6 })}>
        mapa
      </button>
      <output data-testid="map-value">
        {props.value ? `${props.value.lat},${props.value.lng}` : 'nenhum'}
      </output>
    </div>
  ),
}));

const teamsList = vi.mocked(api.panelTeamsList);
const createTeam = vi.mocked(api.panelCreateTeam);
const updateTeam = vi.mocked(api.panelUpdateTeam);
const agentsList = vi.mocked(api.panelAgents);
const addAgent = vi.mocked(api.panelAddAgent);
const updateAgent = vi.mocked(api.panelUpdateAgent);
const resendInvite = vi.mocked(api.panelResendAgentInvite);
const departments = vi.mocked(api.panelDepartments);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const deptObras = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const teamA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teamB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function team(overrides: Partial<TeamSummary>): TeamSummary {
  return {
    id: teamA,
    name: 'Obras · Centro',
    departmentId: deptObras,
    departmentName: 'Obras',
    baseAddress: 'Rua do Paço, 50',
    baseLocation: { lat: -23.55, lng: -46.63 },
    agentCount: 3,
    activeAgentCount: 2,
    openWorkOrderCount: 4,
    ...overrides,
  };
}

const teams: TeamSummary[] = [
  team({}),
  team({
    id: teamB,
    name: 'Obras · Zona Norte',
    baseAddress: null,
    baseLocation: null,
    agentCount: 1,
    activeAgentCount: 1,
    openWorkOrderCount: 1,
  }),
];

function agent(overrides: Partial<AgentRow>): AgentRow {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    name: 'João Pereira',
    phone: '+5511988771020',
    email: 'joao@goiania.go.gov.br',
    status: 'active',
    lastActiveAt: '2026-10-20T15:00:00Z',
    ...overrides,
  };
}

const joao = agent({});
const marcos = agent({
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Marcos Lima',
  phone: '+5511966558899',
  email: null,
  status: 'invited',
  lastActiveAt: null,
});
const carla = agent({
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Carla Dias',
  phone: '+5511955443322',
  status: 'inactive',
});

function renderPage(role: PanelContext['role'] = 'manager', path = '/equipes') {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const context: PanelContext = {
    tenant: { id: tenantId, displayName: 'Prefeitura', status: 'active', bounds: null },
    user: { id: '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b', name: 'Carlos' },
    role,
    departments: [],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={{ tenantId, context, counts: undefined, support: null }}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <TeamsPage />
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
  teamsList.mockResolvedValue({ items: teams });
  agentsList.mockResolvedValue({ items: [joao, marcos, carla] });
  departments.mockResolvedValue({
    items: [
      { id: deptObras, name: 'Obras', categoryCount: 1, teamCount: 2, managerCount: 1 },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        name: 'Limpeza Urbana',
        categoryCount: 1,
        teamCount: 0,
        managerCount: 0,
      },
    ],
  });
});

describe('TeamsPage', () => {
  it('teams list shows counts in the singular and opens the first team', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Equipes e agentes', level: 1 }),
    ).toBeVisible();
    expect(await screen.findByText('2 equipes · 3 agentes ativos')).toBeInTheDocument();
    expect(screen.getByText('Obras · 3 agentes · 4 abertas')).toBeInTheDocument();
    expect(screen.getByText('Obras · 1 agente · 1 aberta')).toBeInTheDocument();
    expect(await screen.findByText('Setor: Obras · base: Rua do Paço, 50')).toBeInTheDocument();
    expect(agentsList).toHaveBeenCalledWith(tenantId, teamA);
    const rows = await screen.findAllByRole('row');
    // cabeçalho, ativo, convidado, desativado no fim
    expect(within(rows[1]!).getByText('João Pereira')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('(11) 98877-1020')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Convidado')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('nunca entrou')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Desativado')).toBeInTheDocument();
    expect(screen.queryByText('Em aberto')).not.toBeInTheDocument();
  });

  it('selecting another team shows it without base', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: /Obras · Zona Norte/ }));
    expect(await screen.findByText('Setor: Obras · sem base')).toBeInTheDocument();
    expect(agentsList).toHaveBeenLastCalledWith(tenantId, teamB);
  });

  it('team dialog shows the department only on create and saves the base', async () => {
    createTeam.mockResolvedValue(
      team({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Nova' }),
    );
    updateTeam.mockResolvedValue(team({}));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Nova equipe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova equipe' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Limpeza · Sul');
    await user.selectOptions(await within(dialog).findByLabelText('Setor'), 'Limpeza Urbana');
    await user.type(within(dialog).getByLabelText('Endereço da base'), 'Rua A, 1');
    await user.click(within(dialog).getByRole('button', { name: 'mapa' }));
    expect(within(dialog).getByTestId('map-value')).toHaveTextContent('-23.5,-46.6');
    await user.click(within(dialog).getByRole('button', { name: 'Remover ponto' }));
    expect(within(dialog).getByTestId('map-value')).toHaveTextContent('nenhum');
    await user.click(within(dialog).getByRole('button', { name: 'mapa' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(createTeam).toHaveBeenCalledWith(tenantId, {
      name: 'Limpeza · Sul',
      departmentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      baseAddress: 'Rua A, 1',
      baseLocation: { lat: -23.5, lng: -46.6 },
    });
    expect(await screen.findByText('Equipe criada.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar equipe' });
    expect(within(edit).queryByLabelText('Setor')).not.toBeInTheDocument();
    expect(within(edit).getByText('Obras')).toBeInTheDocument();
    expect(within(edit).getByTestId('map-value')).toHaveTextContent('-23.55,-46.63');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    expect(updateTeam).toHaveBeenCalledWith(tenantId, teamA, {
      name: 'Obras · Centro',
      baseAddress: 'Rua do Paço, 50',
      baseLocation: { lat: -23.55, lng: -46.63 },
    });
    expect(await screen.findByText('Equipe salva.')).toBeInTheDocument();
  });

  it('repeated team name shows the field error', async () => {
    updateTeam.mockRejectedValue(new ApiError(409, { code: 'team_name_taken' }));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar equipe' });
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Já existe uma equipe com este nome.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nome')).toBeInvalid();
  });

  it('add agent converts the mask and shows the other team error', async () => {
    addAgent.mockRejectedValueOnce(
      new ApiError(409, { code: 'agent_in_other_team', teamName: 'Obras · Zona Norte' }),
    );
    // Sem o nome da equipe (o índice único pegou uma inclusão simultânea).
    addAgent.mockRejectedValueOnce(new ApiError(409, { code: 'agent_in_other_team' }));
    addAgent.mockResolvedValueOnce(agent({ name: 'Ana Souza' }));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Adicionar agente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar agente' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana');
    await user.type(within(dialog).getByLabelText('Celular'), '11988771020');
    expect(within(dialog).getByLabelText('Celular')).toHaveValue('(11) 98877-1020');
    expect(within(dialog).getByRole('button', { name: 'Adicionar' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@goiania.go.gov.br');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(addAgent).toHaveBeenCalledWith(tenantId, teamA, {
      name: 'Ana',
      phone: '+5511988771020',
      email: 'ana@goiania.go.gov.br',
    });
    expect(
      await within(dialog).findByText(
        'Este celular já é de um agente da equipe Obras · Zona Norte.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(
      await within(dialog).findByText('Este celular já é de um agente de outra equipe.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Ana Souza adicionado à equipe.')).toBeInTheDocument();
  });

  it('add agent with another email on the account shows the masked email', async () => {
    addAgent.mockRejectedValueOnce(
      new ApiError(409, { code: 'email_mismatch', maskedEmail: 'm•••@goiania.go.gov.br' }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Adicionar agente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar agente' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana');
    await user.type(within(dialog).getByLabelText('Celular'), '11988771020');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@goiania.go.gov.br');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(
      await within(dialog).findByText(
        'Esta pessoa já tem outro e-mail cadastrado (m•••@goiania.go.gov.br). Use esse e-mail.',
      ),
    ).toBeInTheDocument();
  });

  it('resend invite is offered only with an email and not to inactive agents', async () => {
    const user = renderPage();
    await screen.findByText('Marcos Lima');
    await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
    expect(screen.getByRole('menuitem', { name: 'Reenviar convite' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Trocar e-mail' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Ações de Marcos Lima' }));
    expect(screen.queryByRole('menuitem', { name: 'Reenviar convite' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Trocar e-mail' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Ações de Carla Dias' }));
    expect(screen.queryByRole('menuitem', { name: 'Reenviar convite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Trocar e-mail' })).not.toBeInTheDocument();
  });

  it('resend invite toasts the masked email, then shows the wait and the inactive tenant message', async () => {
    resendInvite.mockResolvedValueOnce({ maskedEmail: 'm•••@goiania.go.gov.br' });
    resendInvite.mockRejectedValueOnce(
      new ApiError(429, { code: 'rate_limited', retryAfterSeconds: 30 }),
    );
    resendInvite.mockRejectedValueOnce(new ApiError(409, { code: 'tenant_not_active' }));
    const user = renderPage();
    await screen.findByText('Marcos Lima');
    const resend = async () => {
      await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
      await user.click(screen.getByRole('menuitem', { name: 'Reenviar convite' }));
    };
    await resend();
    expect(resendInvite).toHaveBeenCalledWith(tenantId, joao.userId);
    expect(
      await screen.findByText('Convite reenviado para m•••@goiania.go.gov.br.'),
    ).toBeInTheDocument();
    await resend();
    expect(await screen.findByText('Aguarde 30 s para reenviar o convite.')).toBeInTheDocument();
    await resend();
    expect(
      await screen.findByText('O convite do agente é enviado quando a prefeitura for ativada.'),
    ).toBeInTheDocument();
  });

  it('change email saves the new address and shows the not allowed message', async () => {
    updateAgent.mockRejectedValueOnce(new ApiError(409, { code: 'email_change_not_allowed' }));
    updateAgent.mockResolvedValueOnce(joao);
    const user = renderPage();
    await screen.findByText('Marcos Lima');
    await user.click(screen.getByRole('button', { name: 'Ações de Marcos Lima' }));
    await user.click(screen.getByRole('menuitem', { name: 'Trocar e-mail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Trocar e-mail' });
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('E-mail'), 'novo@goiania.go.gov.br');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(updateAgent).toHaveBeenCalledWith(tenantId, marcos.userId, {
      action: 'change_email',
      email: 'novo@goiania.go.gov.br',
    });
    expect(
      await within(dialog).findByText(
        'O e-mail desta pessoa só pode ser trocado pelo suporte do Alô Cidadão.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('E-mail trocado.')).toBeInTheDocument();
  });

  it('staff_account_not_allowed on agent shows the staff phone message', async () => {
    addAgent.mockRejectedValueOnce(new ApiError(409, { code: 'staff_account_not_allowed' }));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Adicionar agente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar agente' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana');
    await user.type(within(dialog).getByLabelText('Celular'), '11988771020');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@goiania.go.gov.br');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(
      await within(dialog).findByText(
        'Este número é de alguém da equipe Alô Cidadão. Use outro número.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Celular')).toHaveAttribute('aria-invalid', 'true');
  });

  it('change phone is only offered to agents who never signed in', async () => {
    updateAgent.mockResolvedValue(marcos);
    const user = renderPage();
    await screen.findByText('Marcos Lima');
    await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
    expect(screen.queryByRole('menuitem', { name: 'Trocar número' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Ações de Marcos Lima' }));
    await user.click(screen.getByRole('menuitem', { name: 'Trocar número' }));
    const dialog = await screen.findByRole('dialog', { name: 'Trocar número' });
    await user.type(within(dialog).getByLabelText('Novo celular'), '11977776666');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(updateAgent).toHaveBeenCalledWith(tenantId, marcos.userId, {
      action: 'change_phone',
      phone: '+5511977776666',
    });
    expect(await screen.findByText('Número trocado.')).toBeInTheDocument();
  });

  it('change phone refused by the database shows the profile notice', async () => {
    updateAgent.mockRejectedValue(new ApiError(409, { code: 'phone_change_not_allowed' }));
    const user = renderPage();
    await screen.findByText('Marcos Lima');
    await user.click(screen.getByRole('button', { name: 'Ações de Marcos Lima' }));
    await user.click(screen.getByRole('menuitem', { name: 'Trocar número' }));
    const dialog = await screen.findByRole('dialog', { name: 'Trocar número' });
    await user.type(within(dialog).getByLabelText('Novo celular'), '11977776666');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText(
        'Não dá para trocar o número deste agente pelo painel. Ele troca no Perfil do app.',
      ),
    ).toBeInTheDocument();
  });

  it('move agent offers the other teams', async () => {
    updateAgent.mockResolvedValue(joao);
    const user = renderPage();
    await screen.findByText('João Pereira');
    await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mudar de equipe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mudar de equipe' });
    await user.selectOptions(within(dialog).getByLabelText('Equipe'), 'Obras · Zona Norte');
    await user.click(within(dialog).getByRole('button', { name: 'Mudar' }));
    expect(updateAgent).toHaveBeenCalledWith(tenantId, joao.userId, {
      action: 'move',
      teamId: teamB,
    });
    expect(
      await screen.findByText('João Pereira agora está na equipe Obras · Zona Norte.'),
    ).toBeInTheDocument();
  });

  it('staff_account_not_allowed on move and reactivate shows the staff phone message', async () => {
    updateAgent.mockRejectedValue(new ApiError(409, { code: 'staff_account_not_allowed' }));
    const user = renderPage();
    await screen.findByText('João Pereira');
    await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mudar de equipe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mudar de equipe' });
    await user.selectOptions(within(dialog).getByLabelText('Equipe'), 'Obras · Zona Norte');
    await user.click(within(dialog).getByRole('button', { name: 'Mudar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este número é de alguém da equipe Alô Cidadão. Use outro número.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Ações de Carla Dias' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reativar' }));
    expect(
      await screen.findByText('Este número é de alguém da equipe Alô Cidadão. Use outro número.'),
    ).toBeInTheDocument();
  });

  it('deactivate asks for confirmation and reactivate does not', async () => {
    updateAgent.mockResolvedValue(joao);
    const user = renderPage();
    await screen.findByText('João Pereira');
    await user.click(screen.getByRole('button', { name: 'Ações de João Pereira' }));
    await user.click(screen.getByRole('menuitem', { name: 'Desativar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desativar João Pereira?' });
    expect(
      within(dialog).getByText('Ele deixa de ver as atividades no app. Dá para reativar depois.'),
    ).toBeInTheDocument();
    expect(updateAgent).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));
    expect(updateAgent).toHaveBeenCalledWith(tenantId, joao.userId, { action: 'deactivate' });
    expect(await screen.findByText('João Pereira desativado.')).toBeInTheDocument();

    updateAgent.mockClear();
    await user.click(screen.getByRole('button', { name: 'Ações de Carla Dias' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reativar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateAgent).toHaveBeenCalledWith(tenantId, carla.userId, { action: 'reactivate' });
    expect(await screen.findByText('Carla Dias reativado.')).toBeInTheDocument();
  });

  it('gestores tab is hidden for the manager', async () => {
    renderPage('manager');
    await screen.findByText('Setor: Obras · base: Rua do Paço, 50');
    expect(screen.getByRole('link', { name: 'Equipes e agentes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Gestores' })).not.toBeInTheDocument();
  });

  it('gestores tab is shown for the admin', async () => {
    renderPage('tenant_admin');
    expect(await screen.findByRole('link', { name: 'Gestores' })).toHaveAttribute(
      'href',
      '/equipes/gestores',
    );
  });

  it('empty scope shows the invitation to create a team', async () => {
    teamsList.mockResolvedValue({ items: [] });
    renderPage();
    expect(
      await screen.findByText('Nenhuma equipe cadastrada. Crie a primeira em "Nova equipe".'),
    ).toBeInTheDocument();
  });
});
