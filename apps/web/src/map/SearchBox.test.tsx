import type { PanelSearchResult } from '@alocidadao/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { renderListPage } from '../lists/test-render';
import { SearchBox } from './SearchBox';

vi.mock('../api', () => ({ api: { panelSearch: vi.fn() } }));
const panelSearch = vi.mocked(api.panelSearch);

function result(id: string, protocol: string, status: PanelSearchResult['status']) {
  return {
    occurrenceId: id,
    protocol,
    categoryName: 'Buraco na via',
    address: 'Rua das Flores, 120',
    location: { lat: -23.55, lng: -46.63 },
    status,
  } satisfies PanelSearchResult;
}

beforeEach(() => {
  vi.resetAllMocks();
  panelSearch.mockResolvedValue({
    items: [
      result('11111111-1111-4111-8111-111111111111', '2026-000001', 'completed'),
      result('22222222-2222-4222-8222-222222222222', '2026-000002', 'in_progress'),
      result('33333333-3333-4333-8333-333333333333', '2026-000003', 'triage'),
    ],
  });
});

describe('search box', () => {
  it('search result shows the status badge', async () => {
    const user = renderListPage(<SearchBox onSelect={vi.fn()} />, '/mapa');
    await user.type(screen.getByRole('combobox'), '2026');
    const options = await screen.findAllByRole('option');
    // A ordem é a da API.
    expect(options[0]).toHaveTextContent('2026-000001');
    expect(within(options[0]!).getByText('Concluída')).toBeInTheDocument();
    expect(within(options[1]!).getByText('Em atendimento')).toBeInTheDocument();
    expect(within(options[2]!).getByText('Aberta')).toBeInTheDocument();
  });
});
