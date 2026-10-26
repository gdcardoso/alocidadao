import { ApiError } from '@alocidadao/api-client';
import type { CategoryRow, DepartmentRow } from '@alocidadao/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { renderAdminPage, tenantId } from '../test/render-page';
import { CategoriesPage } from './CategoriesPage';
import { DepartmentsPage } from './DepartmentsPage';

vi.mock('../api', () => ({
  api: {
    panelCategories: vi.fn(),
    panelCreateCategory: vi.fn(),
    panelUpdateCategory: vi.fn(),
    panelDepartments: vi.fn(),
    panelCreateDepartment: vi.fn(),
    panelUpdateDepartment: vi.fn(),
  },
}));

const categories = vi.mocked(api.panelCategories);
const createCategory = vi.mocked(api.panelCreateCategory);
const updateCategory = vi.mocked(api.panelUpdateCategory);
const departments = vi.mocked(api.panelDepartments);
const createDepartment = vi.mocked(api.panelCreateDepartment);
const updateDepartment = vi.mocked(api.panelUpdateDepartment);

const deptObras = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const deptLimpeza = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function category(overrides: Partial<CategoryRow>): CategoryRow {
  return {
    id: 'a1111111-1111-4111-8111-111111111111',
    name: 'Buraco na via',
    icon: 'construction',
    iconGroup: 'infrastructure',
    departmentId: deptObras,
    departmentName: 'Obras',
    defaultDeadlineDays: 3,
    clusterRadiusM: 15,
    active: true,
    ...overrides,
  };
}

const buraco = category({});
const animal = category({
  id: 'a2222222-2222-4222-8222-222222222222',
  name: 'Animal',
  icon: 'paw-print',
  iconGroup: 'public_services',
  departmentId: deptLimpeza,
  departmentName: 'Limpeza Urbana',
  defaultDeadlineDays: 1,
  clusterRadiusM: 50,
  active: false,
});

function dept(id: string, name: string, counts: [number, number, number]): DepartmentRow {
  return {
    id,
    name,
    categoryCount: counts[0],
    teamCount: counts[1],
    managerCount: counts[2],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  categories.mockResolvedValue({ items: [buraco, animal] });
  departments.mockResolvedValue({
    items: [dept(deptObras, 'Obras', [1, 2, 1]), dept(deptLimpeza, 'Limpeza Urbana', [1, 0, 0])],
  });
});

describe('CategoriesPage', () => {
  it('categories are listed alphabetically and the switch sends active', async () => {
    updateCategory.mockResolvedValue({ ...animal, active: true });
    const user = renderAdminPage(<CategoriesPage />, '/categorias');
    expect(await screen.findByRole('heading', { name: 'Categorias', level: 1 })).toBeVisible();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).getByText('Animal')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1 dia')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('50 m')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Buraco na via')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('3 dias')).toBeInTheDocument();
    const off = screen.getByRole('switch', { name: 'Mostrar Animal no app' });
    expect(off).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mostrar Buraco na via no app' })).toBeChecked();
    await user.click(off);
    expect(updateCategory).toHaveBeenCalledWith(tenantId, animal.id, { active: true });
    expect(await screen.findByText('Animal aparece no app.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Mostrar Buraco na via no app' }));
    expect(await screen.findByText('Buraco na via não aparece mais no app.')).toBeInTheDocument();
  });

  it('category editor creates with the defaults and shows the radius help with the typed value', async () => {
    createCategory.mockResolvedValue(category({ name: 'Semáforo' }));
    const user = renderAdminPage(<CategoriesPage />, '/categorias');
    await user.click(await screen.findByRole('button', { name: 'Nova categoria' }));
    const panel = await screen.findByRole('complementary', { name: 'Nova categoria' });
    expect(within(panel).getByLabelText('Ícone')).toHaveValue('circle-ellipsis');
    expect(within(panel).getByLabelText('Cor do ícone')).toHaveValue('public_services');
    expect(within(panel).getByLabelText('Prazo padrão')).toHaveValue(7);
    expect(within(panel).getByLabelText('Raio de agrupamento')).toHaveValue(20);
    expect(
      within(panel).getByText(
        'Relatos desta categoria a até 20 m são sugeridos como a mesma ocorrência.',
      ),
    ).toBeInTheDocument();
    const radius = within(panel).getByLabelText('Raio de agrupamento');
    await user.clear(radius);
    await user.type(radius, '35');
    expect(
      within(panel).getByText(
        'Relatos desta categoria a até 35 m são sugeridos como a mesma ocorrência.',
      ),
    ).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Nome no app'), 'Semáforo');
    await user.selectOptions(within(panel).getByLabelText('Setor responsável'), 'Obras');
    await user.selectOptions(within(panel).getByLabelText('Ícone'), 'Lâmpada');
    await user.click(within(panel).getByRole('button', { name: 'Salvar' }));
    expect(createCategory).toHaveBeenCalledWith(tenantId, {
      name: 'Semáforo',
      icon: 'lightbulb',
      iconGroup: 'public_services',
      departmentId: deptObras,
      defaultDeadlineDays: 7,
      clusterRadiusM: 35,
      active: true,
    });
    expect(await screen.findByText('Categoria criada.')).toBeInTheDocument();
  });

  it('clicking a row opens the editor with the title and saves only the changes', async () => {
    updateCategory.mockResolvedValue(buraco);
    const user = renderAdminPage(<CategoriesPage />, '/categorias');
    await user.click(await screen.findByRole('row', { name: 'Editar Buraco na via' }));
    const panel = await screen.findByRole('complementary', { name: 'Editar: Buraco na via' });
    expect(within(panel).getByLabelText('Nome no app')).toHaveValue('Buraco na via');
    const days = within(panel).getByLabelText('Prazo padrão');
    await user.clear(days);
    await user.type(days, '5');
    await user.click(within(panel).getByRole('button', { name: 'Salvar' }));
    expect(updateCategory).toHaveBeenCalledWith(tenantId, buraco.id, { defaultDeadlineDays: 5 });
    expect(await screen.findByText('Categoria salva.')).toBeInTheDocument();
  });

  it('repeated category name shows the field error', async () => {
    createCategory.mockRejectedValue(new ApiError(409, { code: 'category_name_taken' }));
    const user = renderAdminPage(<CategoriesPage />, '/categorias');
    await user.click(await screen.findByRole('button', { name: 'Nova categoria' }));
    const panel = await screen.findByRole('complementary', { name: 'Nova categoria' });
    await user.type(within(panel).getByLabelText('Nome no app'), 'Animal');
    await user.selectOptions(within(panel).getByLabelText('Setor responsável'), 'Obras');
    await user.click(within(panel).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(panel).findByText('Já existe uma categoria com este nome.'),
    ).toBeInTheDocument();
  });
});

describe('DepartmentsPage', () => {
  it('departments tab lists counts and renames', async () => {
    updateDepartment.mockResolvedValue(dept(deptObras, 'Obras Públicas', [1, 2, 1]));
    const user = renderAdminPage(<DepartmentsPage />, '/categorias/setores');
    const rows = await screen.findAllByRole('row');
    // por nome: Limpeza Urbana, Obras
    expect(within(rows[1]!).getByText('Limpeza Urbana')).toBeInTheDocument();
    const obras = within(rows[2]!).getAllByRole('cell');
    expect(obras.map((cell) => cell.textContent?.replace(/^⋯$/, ''))).toContain('2');
    expect(screen.getByRole('columnheader', { name: 'Setor' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ações de Obras' }));
    await user.click(screen.getByRole('menuitem', { name: 'Renomear' }));
    const dialog = await screen.findByRole('dialog', { name: 'Renomear setor' });
    const name = within(dialog).getByLabelText('Nome');
    expect(name).toHaveValue('Obras');
    await user.clear(name);
    await user.type(name, 'Obras Públicas');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(updateDepartment).toHaveBeenCalledWith(tenantId, deptObras, { name: 'Obras Públicas' });
    expect(await screen.findByText('Setor salvo.')).toBeInTheDocument();
  });

  it('new department shows the name taken error and then creates', async () => {
    createDepartment.mockRejectedValueOnce(new ApiError(409, { code: 'department_name_taken' }));
    const user = renderAdminPage(<DepartmentsPage />, '/categorias/setores');
    await user.click(await screen.findByRole('button', { name: 'Novo setor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo setor' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Obras');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Já existe um setor com este nome.'),
    ).toBeInTheDocument();
    createDepartment.mockResolvedValueOnce(
      dept('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Praças', [0, 0, 0]),
    );
    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'Praças');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(createDepartment).toHaveBeenLastCalledWith(tenantId, { name: 'Praças' });
    expect(await screen.findByText('Setor criado.')).toBeInTheDocument();
  });
});
