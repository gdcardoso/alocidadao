import type { InProgressRow, OccurrenceDetail } from '@alocidadao/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_NEIGHBORHOOD } from '@alocidadao/shared';
import { api } from '../api';
import { InProgressPage } from './InProgressPage';
import { renderListPage, tenantId } from './test-render';

vi.mock('../api', () => ({
  api: {
    panelInProgress: vi.fn(),
    panelOccurrence: vi.fn(),
    panelCategoryOptions: vi.fn(),
    panelNeighborhoods: vi.fn(),
  },
}));

const panelInProgress = vi.mocked(api.panelInProgress);
const panelOccurrence = vi.mocked(api.panelOccurrence);

const holeId = '22222222-2222-4222-8222-222222222222';
const lightId = '11111111-1111-4111-8111-111111111111';
const holesCategory = '44444444-4444-4444-8444-444444444444';

const day = 86_400_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const rows: InProgressRow[] = [
  {
    occurrenceId: holeId,
    protocol: '2026-000123',
    categoryId: holesCategory,
    categoryName: 'Buraco na via',
    icon: 'construction',
    iconGroup: 'infrastructure',
    address: 'Rua das Flores, 120',
    teamName: 'Equipe Pavimentação',
    workOrderStatus: 'in_execution',
    dueAt: new Date(Date.now() - 2 * day).toISOString(),
    statusSince: hoursAgo(50),
  },
  {
    occurrenceId: lightId,
    protocol: '2026-000088',
    categoryId: '66666666-6666-4666-8666-666666666666',
    categoryName: 'Iluminação',
    icon: 'lightbulb',
    iconGroup: 'infrastructure',
    address: 'Av. Brasil, 1450',
    teamName: 'Equipe Elétrica',
    workOrderStatus: 'assigned',
    dueAt: null,
    statusSince: hoursAgo(5),
  },
];

function detail(): OccurrenceDetail {
  return {
    id: holeId,
    status: 'in_progress',
    statusSince: hoursAgo(50),
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
    requests: [],
    suggestions: [],
    activeWorkOrder: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.panelNeighborhoods).mockResolvedValue({
    items: ['Centro', 'Vila Nova'],
    source: 'tenant',
  });
  vi.mocked(api.panelCategoryOptions).mockResolvedValue({
    items: [{ id: holesCategory, name: 'Buraco na via' }],
  });
  panelInProgress.mockImplementation(async (_tenant, params) => {
    let items = rows;
    if (params.categoryId) items = items.filter((r) => r.categoryId === params.categoryId);
    if (params.workOrderStatus) {
      items = items.filter((r) => r.workOrderStatus === params.workOrderStatus);
    }
    return { total: items.length, items };
  });
  panelOccurrence.mockResolvedValue(detail());
});

describe('in progress page', () => {
  it('in progress shows team, activity badge and overdue date in danger', async () => {
    renderListPage(<InProgressPage />, '/em-atendimento');
    await screen.findByText('2026-000123');
    const [hole, light] = screen.getAllByRole('row').slice(1) as [HTMLElement, HTMLElement];
    expect(within(hole).getByText('Equipe Pavimentação')).toBeInTheDocument();
    expect(within(hole).getByText('Em execução')).toBeInTheDocument();
    expect(within(hole).getByText('2 dias')).toBeInTheDocument();
    const due = within(hole).getByText(/^\d{1,2} [a-z]{3}$/);
    expect(due).toHaveAttribute('data-overdue', 'true');
    expect(within(light).getByText('Atribuída')).toBeInTheDocument();
    expect(within(light).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('2 ocorrências em atendimento')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 2 de 2')).toBeInTheDocument();
    for (const header of ['Ocorrência', 'Local', 'Equipe', 'Atividade', 'Prazo']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole('columnheader', { name: 'Em atendimento há' })).toBeInTheDocument();
  });

  it('clicking a row opens the drawer with the occurrence', async () => {
    const user = renderListPage(<InProgressPage />, '/em-atendimento');
    const row = (await screen.findByText('2026-000123')).closest('tr') as HTMLElement;
    await user.click(row);
    expect(screen.getByTestId('location')).toHaveTextContent(`?ocorrencia=${holeId}`);
    expect(await screen.findByRole('complementary', { name: 'Painel do ponto' })).toBeVisible();
    expect(panelOccurrence).toHaveBeenCalledWith(tenantId, holeId);
  });

  it('filters go through the api and the activity options are the active statuses', async () => {
    const user = renderListPage(<InProgressPage />, '/em-atendimento');
    const activity = await screen.findByLabelText('Atividade');
    expect([...(activity as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'todas',
      'Atribuída',
      'Em execução',
      'Aguardando revisão',
      'Ajuste pedido',
      'Impedida',
    ]);
    await user.selectOptions(activity, 'assigned');
    expect(panelInProgress).toHaveBeenCalledWith(tenantId, { workOrderStatus: 'assigned' });
    expect(await screen.findByText('1 ocorrência em atendimento')).toBeInTheDocument();
  });

  it('empty list shows the empty text', async () => {
    panelInProgress.mockResolvedValue({ total: 0, items: [] });
    renderListPage(<InProgressPage />, '/em-atendimento');
    expect(await screen.findByText('Nenhuma ocorrência em atendimento.')).toBeInTheDocument();
  });

  it('sends neighborhood to the API', async () => {
    const user = renderListPage(<InProgressPage />, '/em-atendimento');
    const select = (await screen.findByLabelText('Bairro')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'todos',
      'Centro',
      'Vila Nova',
      'Sem bairro',
    ]);
    await user.selectOptions(select, 'Centro');
    expect(screen.getByTestId('location')).toHaveTextContent('bairro=Centro');
    await waitFor(() =>
      expect(panelInProgress).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ neighborhood: 'Centro' }),
      ),
    );
    await user.selectOptions(select, NO_NEIGHBORHOOD);
    await waitFor(() =>
      expect(panelInProgress).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ neighborhood: NO_NEIGHBORHOOD }),
      ),
    );
  });

  it('hides the filter and ignores ?bairro when the tenant has no neighborhoods', async () => {
    vi.mocked(api.panelNeighborhoods).mockResolvedValue({ items: [], source: null });
    renderListPage(<InProgressPage />, '/em-atendimento?bairro=Centro');
    await waitFor(() => expect(panelInProgress).toHaveBeenCalled());
    expect(screen.queryByLabelText('Bairro')).not.toBeInTheDocument();
    for (const call of panelInProgress.mock.calls) {
      expect(call[1]).not.toHaveProperty('neighborhood');
    }
  });
});
