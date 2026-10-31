import { ApiError } from '@alocidadao/api-client';
import type { DepartmentRow, ManagerRow } from '@alocidadao/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { renderAdminPage, tenantId } from '../test/render-page';
import { ManagersPage } from './ManagersPage';

vi.mock('../api', () => ({
  api: {
    panelManagers: vi.fn(),
    panelCreateManager: vi.fn(),
    panelUpdateManager: vi.fn(),
    panelDepartments: vi.fn(),
    backofficeFrozenAccountCode: vi.fn(),
    backofficeRecoverFrozenAccount: vi.fn(),
    backofficeReleaseFrozenCpf: vi.fn(),
  },
}));

const managers = vi.mocked(api.panelManagers);
const createManager = vi.mocked(api.panelCreateManager);
const updateManager = vi.mocked(api.panelUpdateManager);
const departments = vi.mocked(api.panelDepartments);
const releaseCpf = vi.mocked(api.backofficeReleaseFrozenCpf);

const deptObras = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const deptLimpeza = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function dept(id: string, name: string): DepartmentRow {
  return { id, name, categoryCount: 1, teamCount: 1, managerCount: 1 };
}

function manager(overrides: Partial<ManagerRow>): ManagerRow {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    name: 'Carlos Almeida',
    cpf: '12345678909',
    email: 'c.almeida@prefeitura.sp.gov.br',
    role: 'manager',
    status: 'active',
    departments: [{ id: deptObras, name: 'Obras' }],
    ...overrides,
  };
}

const rita = manager({
  userId: '44444444-4444-4444-8444-444444444444',
  name: 'Rita Campos',
  cpf: '32100000040',
  role: 'tenant_admin',
  departments: [],
});
const carlos = manager({});
const paulo = manager({
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Paulo Nunes',
  cpf: '78900000055',
  status: 'inactive',
  departments: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  managers.mockResolvedValue({ items: [paulo, carlos, rita] });
  departments.mockResolvedValue({
    items: [dept(deptObras, 'Obras'), dept(deptLimpeza, 'Limpeza Urbana')],
  });
});

async function fillNewManager(user: ReturnType<typeof renderAdminPage>) {
  await user.click(await screen.findByRole('button', { name: 'Novo gestor' }));
  const dialog = await screen.findByRole('dialog', { name: 'Novo gestor' });
  await user.type(within(dialog).getByLabelText('Nome'), 'Ana Souza');
  await user.type(within(dialog).getByLabelText('CPF'), '52998224725');
  await user.type(within(dialog).getByLabelText('E-mail'), 'ana@prefeitura.sp.gov.br');
  await user.click(await within(dialog).findByRole('checkbox', { name: 'Obras' }));
  return dialog;
}

describe('ManagersPage', () => {
  it('managers table masks the CPF and shows Todos for the admin', async () => {
    renderAdminPage(<ManagersPage />, '/equipes/gestores');
    expect(await screen.findByText('1 gestor · 1 admin da prefeitura')).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    // cabeçalho, admin, gestor ativo, desativado
    expect(within(rows[1]!).getByText('Rita Campos')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('321.***.***-40')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Todos')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Admin')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('123.***.***-09')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Obras')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Gestor')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Desativado')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('12345678909')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'O gestor entra no painel com o CPF e recebe o código neste e-mail. Ele vê só as ocorrências dos setores marcados.',
      ),
    ).toBeInTheDocument();
  });

  it('managers table has no "⋯" header text', async () => {
    renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await screen.findByText('Carlos Almeida');
    expect(screen.queryByText('⋯')).not.toBeInTheDocument();
  });

  it('admin row has no actions menu', async () => {
    renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await screen.findByText('Rita Campos');
    expect(screen.queryByRole('button', { name: 'Ações de Rita Campos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ações de Carlos Almeida' })).toBeInTheDocument();
  });

  it('new manager needs a department and shows the email mismatch error with the masked email', async () => {
    createManager.mockRejectedValue(
      new ApiError(409, { code: 'email_mismatch', maskedEmail: 'c***@prefeitura.sp.gov.br' }),
    );
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Novo gestor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo gestor' });
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana Souza');
    await user.type(within(dialog).getByLabelText('CPF'), '52998224725');
    expect(within(dialog).getByLabelText('CPF')).toHaveValue('529.982.247-25');
    await user.type(within(dialog).getByLabelText('E-mail'), 'Ana@Prefeitura.sp.gov.br');
    expect(save).toBeDisabled();
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Limpeza Urbana' }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(createManager).toHaveBeenCalledWith(tenantId, {
      name: 'Ana Souza',
      cpf: '52998224725',
      email: 'ana@prefeitura.sp.gov.br',
      departmentIds: [deptLimpeza],
    });
    expect(
      await within(dialog).findByText(
        'Este CPF já tem outro e-mail cadastrado: c***@prefeitura.sp.gov.br.',
      ),
    ).toBeInTheDocument();
  });

  it('creating a manager toasts and refreshes the list', async () => {
    createManager.mockResolvedValue(manager({ name: 'Ana Souza' }));
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Novo gestor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo gestor' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana Souza');
    await user.type(within(dialog).getByLabelText('CPF'), '52998224725');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@prefeitura.sp.gov.br');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Obras' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Ana Souza cadastrado como gestor.')).toBeInTheDocument();
    expect(managers).toHaveBeenCalledTimes(2);
  });

  it('maps the cpf_unavailable and already_manager refusals to the fields', async () => {
    createManager.mockRejectedValueOnce(new ApiError(409, { code: 'cpf_unavailable' }));
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Novo gestor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo gestor' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana Souza');
    await user.type(within(dialog).getByLabelText('CPF'), '52998224725');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@prefeitura.sp.gov.br');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Obras' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText(
        'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.',
      ),
    ).toBeInTheDocument();
    createManager.mockRejectedValueOnce(new ApiError(409, { code: 'already_manager' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Esta pessoa já é gestora nesta prefeitura.'),
    ).toBeInTheDocument();
    createManager.mockRejectedValueOnce(new ApiError(409, { code: 'staff_account_not_allowed' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Esta pessoa é da equipe Alô Cidadão. Use outro CPF.'),
    ).toBeInTheDocument();
  });

  it('in support mode cpf_unavailable shows the frozen account panel and retries', async () => {
    createManager
      .mockRejectedValueOnce(new ApiError(409, { code: 'cpf_unavailable' }))
      .mockResolvedValueOnce(manager({ name: 'Ana Souza' }));
    releaseCpf.mockResolvedValue(undefined);
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores', 'tenant_admin', {
      tenantId,
      displayName: 'Prefeitura',
    });
    const dialog = await fillNewManager(user);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(
      await within(dialog).findByRole('region', { name: 'Conta bloqueada' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.',
      ),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Criar conta nova' }));
    const confirm = await screen.findByRole('dialog', { name: 'Criar conta nova?' });
    await user.click(within(confirm).getByRole('button', { name: 'Criar conta nova' }));

    await waitFor(() => expect(createManager).toHaveBeenCalledTimes(2));
    expect(releaseCpf).toHaveBeenCalledWith({ cpf: '52998224725', tenantId });
    expect(await screen.findByText('Ana Souza cadastrado como gestor.')).toBeInTheDocument();
  });

  it('outside support mode cpf_unavailable keeps the 6a message', async () => {
    createManager.mockRejectedValueOnce(new ApiError(409, { code: 'cpf_unavailable' }));
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    const dialog = await fillNewManager(user);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(
      await within(dialog).findByText(
        'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('region', { name: 'Conta bloqueada' }),
    ).not.toBeInTheDocument();
  });

  it('edit saves email and departments; email_change_not_allowed shows the field error', async () => {
    updateManager.mockRejectedValueOnce(new ApiError(409, { code: 'email_change_not_allowed' }));
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Ações de Carlos Almeida' }));
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar gestor' });
    expect(within(dialog).getByText('Carlos Almeida')).toBeInTheDocument();
    expect(within(dialog).getByText('123.***.***-09')).toBeInTheDocument();
    expect(await within(dialog).findByRole('checkbox', { name: 'Obras' })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Limpeza Urbana' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(updateManager).toHaveBeenCalledWith(tenantId, carlos.userId, {
      action: 'update',
      email: 'c.almeida@prefeitura.sp.gov.br',
      departmentIds: [deptObras, deptLimpeza],
    });
    expect(
      await within(dialog).findByText(
        'Esta pessoa também tem acesso a outro painel. Peça a troca ao suporte do Alô Cidadão.',
      ),
    ).toBeInTheDocument();
    updateManager.mockResolvedValueOnce(carlos);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Gestor salvo.')).toBeInTheDocument();
  });

  it('reactivate refused for a staff account shows the staff message', async () => {
    updateManager.mockRejectedValue(new ApiError(409, { code: 'staff_account_not_allowed' }));
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Ações de Paulo Nunes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reativar' }));
    expect(
      await screen.findByText('Esta pessoa é da equipe Alô Cidadão. Use outro CPF.'),
    ).toBeInTheDocument();
  });

  it('deactivate asks for confirmation and reactivate does not', async () => {
    updateManager.mockResolvedValue(carlos);
    const user = renderAdminPage(<ManagersPage />, '/equipes/gestores');
    await user.click(await screen.findByRole('button', { name: 'Ações de Carlos Almeida' }));
    await user.click(screen.getByRole('menuitem', { name: 'Desativar' }));
    const confirm = await screen.findByRole('dialog', { name: 'Desativar Carlos Almeida?' });
    expect(
      within(confirm).getByText('Ele deixa de entrar no painel. Dá para reativar depois.'),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Desativar' }));
    expect(updateManager).toHaveBeenCalledWith(tenantId, carlos.userId, { action: 'deactivate' });
    expect(await screen.findByText('Carlos Almeida desativado.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ações de Paulo Nunes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reativar' }));
    expect(updateManager).toHaveBeenLastCalledWith(tenantId, paulo.userId, {
      action: 'reactivate',
    });
    expect(await screen.findByText('Paulo Nunes reativado.')).toBeInTheDocument();
  });
});
