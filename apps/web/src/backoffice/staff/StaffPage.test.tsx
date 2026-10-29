import { ApiError } from '@alocidadao/api-client';
import type { StaffMember } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { ToastProvider } from '../../ui/Toast';
import { StaffPage } from './StaffPage';

vi.mock('../../api', () => ({
  api: {
    backofficeContext: vi.fn(),
    backofficeStaff: vi.fn(),
    backofficeAddStaff: vi.fn(),
    backofficeUpdateStaff: vi.fn(),
    backofficeRemoveStaff: vi.fn(),
    backofficeFrozenAccountCode: vi.fn(),
    backofficeRecoverFrozenAccount: vi.fn(),
    backofficeReleaseFrozenCpf: vi.fn(),
  },
}));

const context = vi.mocked(api.backofficeContext);
const list = vi.mocked(api.backofficeStaff);
const add = vi.mocked(api.backofficeAddStaff);
const update = vi.mocked(api.backofficeUpdateStaff);
const remove = vi.mocked(api.backofficeRemoveStaff);
const release = vi.mocked(api.backofficeReleaseFrozenCpf);

const selfId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';
const marinaId = '7c1d2e3f-4a5b-4c6d-8e7f-901234567891';
const biaId = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

const lucas: StaffMember = {
  userId: selfId,
  name: 'Lucas Prado',
  maskedCpf: '123.***.***-09',
  email: 'lucas@alocidadao.com.br',
  platformRole: 'admin',
  lastActiveAt: null,
};
const marina: StaffMember = {
  userId: marinaId,
  name: 'Marina Dias',
  maskedCpf: '456.***.***-21',
  email: 'marina@alocidadao.com.br',
  platformRole: 'support',
  lastActiveAt: null,
};
const bia: StaffMember = {
  userId: biaId,
  name: 'Bia Lima',
  maskedCpf: '529.***.***-25',
  email: 'bia@alocidadao.com.br',
  platformRole: 'support',
  lastActiveAt: null,
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
        <ToastProvider>
          <MemoryRouter initialEntries={['/backoffice/equipe']}>
            <Routes>
              <Route path="/backoffice/prefeituras" element={<p>tela prefeituras</p>} />
              <Route path="/backoffice/equipe" element={<StaffPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function fillAddDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Adicionar pessoa' }));
  const dialog = screen.getByRole('dialog', { name: 'Adicionar pessoa' });
  await user.type(within(dialog).getByLabelText('Nome'), 'Bia Lima');
  await user.type(within(dialog).getByLabelText('CPF'), '52998224725');
  await user.type(within(dialog).getByLabelText('E-mail'), 'Bia@AloCidadao.com.br');
  await user.selectOptions(within(dialog).getByLabelText('Papel'), 'support');
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  context.mockResolvedValue({ user: { id: selfId, name: 'Lucas Prado' }, platformRole: 'admin' });
  list.mockResolvedValue({ items: [lucas, marina] });
});

describe('StaffPage', () => {
  it('admin sees the staff table with masked cpf and role badges', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Equipe Alô Cidadão' })).toBeInTheDocument();
    expect(screen.getByText('Quem da empresa acessa o backoffice')).toBeInTheDocument();
    const lucasRow = (await screen.findByText('Lucas Prado')).closest('tr')!;
    expect(within(lucasRow).getByText('123.***.***-09')).toBeInTheDocument();
    expect(within(lucasRow).getByText('Admin')).toBeInTheDocument();
    expect(within(lucasRow).getByText('nunca entrou')).toBeInTheDocument();
    const marinaRow = screen.getByText('Marina Dias').closest('tr')!;
    expect(within(marinaRow).getByText('456.***.***-21')).toBeInTheDocument();
    expect(within(marinaRow).getByText('Suporte')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tudo: criar e suspender prefeituras, contratos, equipe interna, e entrar em qualquer prefeitura.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Entra em qualquer prefeitura e faz a gestão dela (equipes, gestores, agentes, solicitações). Não mexe em contratos nem na equipe interna.',
      ),
    ).toBeInTheDocument();
  });

  it('add person submits and shows the new row', async () => {
    const user = renderPage();
    add.mockResolvedValue({ id: biaId });
    const dialog = await fillAddDialog(user);
    list.mockResolvedValue({ items: [lucas, marina, bia] });
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(add).toHaveBeenCalledWith({
      name: 'Bia Lima',
      cpf: '52998224725',
      email: 'bia@alocidadao.com.br',
      platformRole: 'support',
    });
    expect(await screen.findByText('Bia Lima')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Bia Lima entrou na equipe.');
  });

  it('add person with a city hall member shows the cpf message', async () => {
    const user = renderPage();
    add.mockRejectedValue(new ApiError(409, { code: 'tenant_member_not_allowed' }));
    const dialog = await fillAddDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText(
        'Esta pessoa é gestora ou agente de uma prefeitura. Use outro CPF.',
      ),
    ).toBeInTheDocument();
  });

  it('add person with a frozen cpf offers the frozen account panel and retries', async () => {
    const user = renderPage();
    add
      .mockRejectedValueOnce(new ApiError(409, { code: 'cpf_unavailable' }))
      .mockResolvedValueOnce({ id: biaId });
    release.mockResolvedValue(undefined);
    const dialog = await fillAddDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await user.click(await within(dialog).findByRole('button', { name: 'Criar conta nova' }));
    const confirm = await screen.findByRole('dialog', { name: 'Criar conta nova?' });
    await user.click(within(confirm).getByRole('button', { name: 'Criar conta nova' }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(release).toHaveBeenCalledWith({ cpf: '52998224725', tenantId: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('remove asks for confirmation and hides self actions', async () => {
    const user = renderPage();
    remove.mockResolvedValue(undefined);

    // Na própria linha, só Editar: ninguém troca o próprio papel nem se remove.
    await user.click(await screen.findByRole('button', { name: 'Ações de Lucas Prado' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Editar']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Ações de Marina Dias' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Editar',
      'Trocar papel',
      'Remover da equipe',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Remover da equipe' }));
    const dialog = screen.getByRole('dialog', { name: 'Remover Marina Dias da equipe?' });
    expect(remove).not.toHaveBeenCalled();
    list.mockResolvedValue({ items: [lucas] });
    await user.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(remove).toHaveBeenCalledWith(marinaId);
    await waitFor(() => expect(screen.queryByText('Marina Dias')).not.toBeInTheDocument());
  });

  it('change role confirms and sends the other role', async () => {
    const user = renderPage();
    update.mockResolvedValue(undefined);
    await user.click(await screen.findByRole('button', { name: 'Ações de Marina Dias' }));
    await user.click(screen.getByRole('menuitem', { name: 'Trocar papel' }));
    const dialog = screen.getByRole('dialog', { name: 'Trocar o papel de Marina Dias?' });
    expect(
      within(dialog).getByText('Marina Dias passa de Suporte para Admin.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Trocar papel' }));
    expect(update).toHaveBeenCalledWith(marinaId, { platformRole: 'admin' });
  });

  it('last admin refusal shows the message', async () => {
    const user = renderPage();
    list.mockResolvedValue({ items: [lucas, { ...marina, platformRole: 'admin' }] });
    update.mockRejectedValue(new ApiError(409, { code: 'last_platform_admin' }));
    await user.click(await screen.findByRole('button', { name: 'Ações de Marina Dias' }));
    await user.click(screen.getByRole('menuitem', { name: 'Trocar papel' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Trocar papel' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A equipe precisa de ao menos um Admin. Passe o papel de Admin a outra pessoa antes.',
    );
  });

  it('edit sends only name and email', async () => {
    const user = renderPage();
    update.mockResolvedValue(undefined);
    await user.click(await screen.findByRole('button', { name: 'Ações de Marina Dias' }));
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar pessoa' });
    expect(within(dialog).getByText('456.***.***-21')).toBeInTheDocument();
    const email = within(dialog).getByLabelText('E-mail');
    await user.clear(email);
    await user.type(email, 'marina.dias@alocidadao.com.br');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(update).toHaveBeenCalledWith(marinaId, {
      name: 'Marina Dias',
      email: 'marina.dias@alocidadao.com.br',
    });
  });

  it('support opening the page goes back to prefeituras', async () => {
    context.mockResolvedValue({
      user: { id: marinaId, name: 'Marina Dias' },
      platformRole: 'support',
    });
    renderPage();
    expect(await screen.findByText('tela prefeituras')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});
