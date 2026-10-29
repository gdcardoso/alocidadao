import type { CityInterestRow } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { ToastProvider } from '../../ui/Toast';
import { CityInterestPage } from './CityInterestPage';

vi.mock('../../api', () => ({
  api: {
    backofficeCityInterest: vi.fn(),
    backofficeCityInterestCsv: vi.fn(),
    backofficeSetLeadStatus: vi.fn(),
  },
}));

const list = vi.mocked(api.backofficeCityInterest);
const csv = vi.mocked(api.backofficeCityInterestCsv);
const setStatus = vi.mocked(api.backofficeSetLeadStatus);

const campinas: CityInterestRow = {
  ibgeCode: '3509502',
  name: 'Campinas',
  state: 'SP',
  requestCount: 812,
  last30Days: 214,
  firstAt: '2026-08-12T15:00:00.000Z',
  commercialStatus: 'negotiating',
  isCustomer: true,
};
const bauru: CityInterestRow = {
  ibgeCode: '3506003',
  name: 'Bauru',
  state: 'SP',
  requestCount: 122,
  last30Days: 31,
  firstAt: '2026-10-02T15:00:00.000Z',
  commercialStatus: 'new',
  isCustomer: false,
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
          <MemoryRouter>
            <CityInterestPage />
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ items: [campinas, bauru] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CityInterestPage', () => {
  it('shows ranking with +N last 30 days and Já é cliente badge', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Interesse por cidade' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Moradores que tocaram em "Quero o Alô Cidadão aqui"'),
    ).toBeInTheDocument();
    const row = (await screen.findByText('Campinas — SP')).closest('tr')!;
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('812')).toBeInTheDocument();
    expect(within(row).getByText('+214')).toBeInTheDocument();
    expect(within(row).getByText('12/08/2026')).toBeInTheDocument();
    expect(within(row).getByText('Em negociação')).toBeInTheDocument();
    expect(within(row).getByText('Já é cliente')).toBeInTheDocument();
    const other = screen.getByText('Bauru — SP').closest('tr')!;
    expect(within(other).getByText('Sem contato')).toBeInTheDocument();
    expect(within(other).queryByText('Já é cliente')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Cada pessoa conta uma vez por município. Não guardamos o local exato, só o município.',
      ),
    ).toBeInTheDocument();
  });

  it('changing status from the row menu updates the badge', async () => {
    const user = renderPage();
    setStatus.mockResolvedValue(undefined);
    const row = (await screen.findByText('Bauru — SP')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Ações de Bauru — SP' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Sem contato',
      'Contatado',
      'Proposta enviada',
      'Em negociação',
      'Fechado',
      'Perdido',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Sem contato' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    list.mockResolvedValue({ items: [campinas, { ...bauru, commercialStatus: 'proposal_sent' }] });
    await user.click(screen.getByRole('menuitem', { name: 'Proposta enviada' }));

    expect(setStatus).toHaveBeenCalledWith('3506003', 'proposal_sent');
    await waitFor(() => expect(within(row).getByText('Proposta enviada')).toBeInTheDocument());
  });

  it('export downloads interesse-por-cidade.csv', async () => {
    const user = renderPage();
    csv.mockResolvedValue('﻿Posição;Município\n');
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let download = '';
    click.mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });

    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv'));
    expect(download).toBe('interesse-por-cidade.csv');
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('empty list shows the empty text from Pencil', async () => {
    list.mockResolvedValue({ items: [] });
    renderPage();
    expect(
      await screen.findByText('Ninguém pediu o Alô Cidadão em uma cidade ainda.'),
    ).toBeInTheDocument();
  });

  it('shows an error with retry when the list fails', async () => {
    list.mockRejectedValueOnce(new Error('rede'));
    const user = renderPage();
    expect(
      await screen.findByText('Não foi possível carregar o interesse por cidade.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Campinas — SP')).toBeInTheDocument();
  });
});
