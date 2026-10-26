import type { RequestRow } from '@alocidadao/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { RequestsPage } from './RequestsPage';
import { renderListPage, tenantId } from './test-render';

vi.mock('../api', () => ({
  api: { panelRequests: vi.fn(), panelOccurrence: vi.fn(), panelCategoryOptions: vi.fn() },
}));

const panelRequests = vi.mocked(api.panelRequests);

const holesCategory = '44444444-4444-4444-8444-444444444444';

const rows: RequestRow[] = [
  {
    requestId: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    occurrenceId: '22222222-2222-4222-8222-222222222222',
    protocol: '2026-000123',
    categoryId: holesCategory,
    categoryName: 'Buraco na via',
    icon: 'construction',
    iconGroup: 'infrastructure',
    address: 'Rua das Flores, 120',
    status: 'in_progress',
    createdAt: '2026-10-20T15:00:00.000Z',
  },
  {
    requestId: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    occurrenceId: '11111111-1111-4111-8111-111111111111',
    protocol: '2026-000088',
    categoryId: '66666666-6666-4666-8666-666666666666',
    categoryName: 'Iluminação',
    icon: 'lightbulb',
    iconGroup: 'infrastructure',
    address: null,
    status: 'open',
    createdAt: '2026-10-19T15:00:00.000Z',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.panelCategoryOptions).mockResolvedValue({
    items: [
      { id: holesCategory, name: 'Buraco na via' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Iluminação' },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Zeladoria' },
    ],
  });
  panelRequests.mockImplementation(async (_tenant, params) => ({
    total: 120,
    page: params.page,
    pageSize: 50,
    items: rows,
  }));
});

describe('requests page', () => {
  it('category options come from the scope route, not from the rows', async () => {
    renderListPage(<RequestsPage />, '/solicitacoes');
    await screen.findByText('2026-000123');
    const select = screen.getByLabelText('Categoria') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'todas',
      'Buraco na via',
      'Iluminação',
      'Zeladoria',
    ]);
  });

  it('requests page reads filters and page from the URL and resets the page on filter change', async () => {
    const user = renderListPage(
      <RequestsPage />,
      `/solicitacoes?status=open&categoria=${holesCategory}&periodo=7&q=flores&pagina=2`,
    );
    await screen.findByText('2026-000123');
    expect(panelRequests).toHaveBeenCalledWith(tenantId, {
      status: 'open',
      categoryId: holesCategory,
      days: 7,
      q: 'flores',
      page: 2,
    });
    expect(screen.getByText('120 solicitações · últimos 7 dias')).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar endereço ou protocolo')).toHaveValue('flores');

    await user.selectOptions(screen.getByLabelText('Status'), 'completed');
    const location = screen.getByTestId('location').textContent ?? '';
    expect(location).toContain('status=completed');
    expect(location).not.toContain('pagina');
    expect(location).toContain('periodo=7');
  });

  it('requests footer shows the range and disables the ends', async () => {
    // Uma página cheia tem 50 linhas; a última, o que sobra.
    panelRequests.mockImplementation(async (_tenant, params) => {
      const count = Math.min(50, 120 - (params.page - 1) * 50);
      const items = Array.from({ length: count }, (_, index) => ({
        ...rows[0]!,
        requestId: `00000000-0000-4000-8000-${String(params.page * 100 + index).padStart(12, '0')}`,
      }));
      return { total: 120, page: params.page, pageSize: 50, items };
    });
    const user = renderListPage(<RequestsPage />, '/solicitacoes');
    expect(await screen.findByText('1–50 de 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?pagina=2');
    expect(await screen.findByText('51–100 de 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('101–120 de 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });

  it('page beyond the last goes back to the last page', async () => {
    panelRequests.mockImplementation(async (_tenant, params) => ({
      total: 120,
      page: params.page,
      pageSize: 50,
      items: params.page > 3 ? [] : rows,
    }));
    renderListPage(<RequestsPage />, '/solicitacoes?pagina=9');
    await screen.findByText('2026-000123');
    expect(screen.getByTestId('location')).toHaveTextContent('?pagina=3');
  });

  it('shows status badge and date, and the default period is 30 days', async () => {
    renderListPage(<RequestsPage />, '/solicitacoes');
    const row = (await screen.findByText('2026-000123')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Em atendimento')).toBeInTheDocument();
    expect(within(row).getByText('20 out 2026')).toBeInTheDocument();
    expect(panelRequests).toHaveBeenCalledWith(tenantId, { days: 30, q: '', page: 1 });
    expect(screen.getByText('120 solicitações · últimos 30 dias')).toBeInTheDocument();
  });

  it('requests table never shows citizen data', async () => {
    renderListPage(<RequestsPage />, '/solicitacoes');
    await screen.findByText('2026-000123');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Protocolo', 'Categoria', 'Local', 'Status', 'Aberta em']);
  });

  it('empty result shows the empty text', async () => {
    panelRequests.mockResolvedValue({ total: 0, page: 1, pageSize: 50, items: [] });
    renderListPage(<RequestsPage />, '/solicitacoes?periodo=todo');
    expect(await screen.findByText('Nenhuma solicitação com estes filtros.')).toBeInTheDocument();
    expect(screen.getByText('0 solicitações · todo o período')).toBeInTheDocument();
  });
});
