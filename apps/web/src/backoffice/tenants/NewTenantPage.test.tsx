import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { ToastProvider } from '../../ui/Toast';
import { NewTenantPage } from './NewTenantPage';

vi.mock('../../api', () => ({
  api: {
    backofficeContext: vi.fn(),
    backofficeMunicipalities: vi.fn(),
    backofficeCreateTenant: vi.fn(),
  },
}));

const context = vi.mocked(api.backofficeContext);
const search = vi.mocked(api.backofficeMunicipalities);
const create = vi.mocked(api.backofficeCreateTenant);

function renderPage(role: 'admin' | 'support' = 'admin') {
  context.mockResolvedValue({ platformRole: role } as never);
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
          <MemoryRouter initialEntries={['/backoffice/prefeituras/nova']}>
            <Routes>
              <Route path="/backoffice/prefeituras" element={<p>tela lista</p>} />
              <Route path="/backoffice/prefeituras/nova" element={<NewTenantPage />} />
              <Route path="/backoffice/prefeituras/:id" element={<p>tela detalhe</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

async function pickMunicipality(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('combobox', { name: 'Buscar município (IBGE)' }), 'soro');
  await user.click(await screen.findByRole('option', { name: /Sorocaba — SP · 3552205/ }));
}

async function fillRest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome'), 'Maria Souza');
  await user.type(screen.getByLabelText('CPF'), '52998224725');
  await user.type(screen.getByLabelText('E-mail institucional'), 'Maria@Sorocaba.sp.gov.br');
  await user.type(screen.getByLabelText('Início da vigência'), '2026-11-01');
}

beforeEach(() => {
  vi.clearAllMocks();
  search.mockResolvedValue({
    items: [
      { ibgeCode: '3552205', name: 'Sorocaba', state: 'SP', taken: false },
      { ibgeCode: '3552403', name: 'Sorocabana', state: 'SP', taken: true },
    ],
  });
});

describe('NewTenantPage', () => {
  it('choosing a municipality fills the display name and shows the IBGE notice', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickMunicipality(user);
    expect(screen.getByLabelText('Nome de exibição')).toHaveValue('Prefeitura de Sorocaba');
    expect(screen.getByLabelText('Central de atendimento')).toHaveValue('156');
    expect(screen.getByText('Limite do município importado do IBGE')).toBeInTheDocument();
    expect(
      screen.getByText('Usado para saber em qual prefeitura cai cada solicitação.'),
    ).toBeInTheDocument();
  });

  it('taken municipalities are disabled', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByRole('combobox', { name: 'Buscar município (IBGE)' }),
      'soro',
    );
    const taken = await screen.findByRole('option', { name: /Sorocabana/ });
    expect(taken).toHaveAttribute('aria-disabled', 'true');
    expect(taken).toHaveTextContent('já cadastrado');
    await user.click(taken);
    expect(screen.queryByText('Limite do município importado do IBGE')).not.toBeInTheDocument();
  });

  it('create sends the body and opens the new tenant with the notice', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    renderPage();
    await pickMunicipality(user);
    await fillRest(user);
    await user.click(screen.getByRole('button', { name: 'Criar prefeitura' }));
    expect(await screen.findByText('tela detalhe')).toBeInTheDocument();
    expect(screen.getByText('Prefeitura criada. Ela está em implantação.')).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith({
      ibgeCode: '3552205',
      displayName: 'Prefeitura de Sorocaba',
      centralPhone: '156',
      admin: { name: 'Maria Souza', cpf: '52998224725', email: 'maria@sorocaba.sp.gov.br' },
      contract: { plan: 'essential', includedPanelUsers: 50, startsOn: '2026-11-01', endsOn: null },
      copyDefaultCatalog: true,
    });
  });

  it('server errors land on the right fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickMunicipality(user);
    await fillRest(user);
    const submit = screen.getByRole('button', { name: 'Criar prefeitura' });

    create.mockRejectedValueOnce(
      new ApiError(409, { code: 'email_mismatch', maskedEmail: 'm***@x.gov.br' }),
    );
    await user.click(submit);
    expect(
      await screen.findByText('Este CPF já tem outro e-mail cadastrado: m***@x.gov.br.'),
    ).toBeInTheDocument();

    create.mockRejectedValueOnce(new ApiError(409, { code: 'email_in_use' }));
    await user.click(submit);
    expect(await screen.findByText('Este e-mail já é de outra pessoa.')).toBeInTheDocument();

    create.mockRejectedValueOnce(new ApiError(409, { code: 'cpf_unavailable' }));
    await user.click(submit);
    expect(
      await screen.findByText(
        'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.',
      ),
    ).toBeInTheDocument();

    create.mockRejectedValueOnce(new ApiError(409, { code: 'tenant_exists' }));
    await user.click(submit);
    expect(
      await screen.findByText('Este município já tem prefeitura cadastrada.'),
    ).toBeInTheDocument();
  });

  it('shows municipality_not_found on the municipality field', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickMunicipality(user);
    await fillRest(user);
    create.mockRejectedValueOnce(new ApiError(422, { code: 'municipality_not_found' }));
    await user.click(screen.getByRole('button', { name: 'Criar prefeitura' }));
    expect(
      await screen.findByText('Município não encontrado. Busque de novo.'),
    ).toBeInTheDocument();
  });

  it('requires the display name', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickMunicipality(user);
    await fillRest(user);
    await user.clear(screen.getByLabelText('Nome de exibição'));
    await user.click(screen.getByRole('button', { name: 'Criar prefeitura' }));
    expect(await screen.findByText('Preencha este campo.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('the keyboard chooses a municipality and skips taken ones', async () => {
    const user = userEvent.setup();
    search.mockResolvedValue({
      items: [
        { ibgeCode: '3552403', name: 'Sorocabana', state: 'SP', taken: true },
        { ibgeCode: '3552205', name: 'Sorocaba', state: 'SP', taken: false },
      ],
    });
    renderPage();
    const input = await screen.findByRole('combobox', { name: 'Buscar município (IBGE)' });
    await user.type(input, 'soro');
    await screen.findByRole('option', { name: /Sorocaba — SP/ });
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /Sorocaba — SP/ }).id,
    );
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Nome de exibição')).toHaveValue('Prefeitura de Sorocaba');
  });

  it('shows the end date error and does not send', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickMunicipality(user);
    await fillRest(user);
    await user.type(screen.getByLabelText('Fim da vigência'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Criar prefeitura' }));
    expect(
      await screen.findByText('O fim da vigência não pode ser antes do início.'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('cancel goes back to the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('tela lista')).toBeInTheDocument();
  });

  it('back arrow goes to the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(await screen.findByText('tela lista')).toBeInTheDocument();
  });

  it('support users are redirected to the list', async () => {
    renderPage('support');
    expect(await screen.findByText('tela lista')).toBeInTheDocument();
  });
});
