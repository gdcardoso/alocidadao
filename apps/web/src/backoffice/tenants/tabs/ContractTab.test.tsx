import { ApiError } from '@alocidadao/api-client';
import type { TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { ToastProvider } from '../../../ui/Toast';
import { ContractTab } from './ContractTab';

vi.mock('../../../api', () => ({
  api: {
    backofficeUpdateContract: vi.fn(),
    backofficeNeighborhoods: vi.fn(),
    backofficePutNeighborhoods: vi.fn(),
    backofficeResetNeighborhoods: vi.fn(),
  },
}));

const updateContract = vi.mocked(api.backofficeUpdateContract);
const getNeighborhoods = vi.mocked(api.backofficeNeighborhoods);
const putNeighborhoods = vi.mocked(api.backofficePutNeighborhoods);
const resetNeighborhoods = vi.mocked(api.backofficeResetNeighborhoods);

const id = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const FORMAT_MESSAGE =
  'O arquivo precisa ser GeoJSON com um polígono por bairro e o nome em `nome` ou `name`.';

const tenant = {
  id,
  displayName: 'Prefeitura de São Paulo',
  centralPhone: '156',
  contract: {
    plan: 'complete',
    includedPanelUsers: 50,
    startsOn: '2026-11-01',
    endsOn: '2027-10-31',
  },
} as unknown as TenantDetail;

function renderTab(isAdmin = true, value: TenantDetail = tenant) {
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
          <ContractTab tenant={value} isAdmin={isAdmin} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

function geojsonFile(content: string) {
  const file = new File([content], 'bairros.geojson', { type: 'application/geo+json' });
  // O jsdom não implementa `File.text()`.
  Object.defineProperty(file, 'text', { value: async () => content });
  return file;
}

beforeEach(() => {
  vi.resetAllMocks();
  getNeighborhoods.mockResolvedValue({ count: 0, source: null });
});

describe('ContractTab', () => {
  it('saves the edited contract and shows the toast', async () => {
    updateContract.mockResolvedValue(tenant);
    renderTab();
    const user = userEvent.setup();
    const name = screen.getByLabelText('Nome de exibição');
    await user.clear(name);
    await user.type(name, 'Prefeitura Nova');
    const included = screen.getByLabelText('Agentes e gestores incluídos');
    await user.clear(included);
    await user.type(included, '80');
    await user.clear(screen.getByLabelText('Fim da vigência'));
    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(updateContract).toHaveBeenCalledWith(id, {
      displayName: 'Prefeitura Nova',
      centralPhone: '156',
      plan: 'complete',
      startsOn: '2026-11-01',
      endsOn: null,
      includedPanelUsers: 80,
    });
    expect(await screen.findByText('Contrato salvo.')).toBeInTheDocument();
  });

  it('validates the dates and included users like the signup form', async () => {
    renderTab();
    const user = userEvent.setup();
    const included = screen.getByLabelText('Agentes e gestores incluídos');
    await user.clear(included);
    await user.type(included, '0');
    fireEnds('2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(screen.getByText('Informe de 1 a 10000.')).toBeInTheDocument();
    expect(screen.getByText('O fim da vigência não pode ser antes do início.')).toBeInTheDocument();
    expect(updateContract).not.toHaveBeenCalled();
  });

  it('uploading a file shows "Bairros carregados: {n}."', async () => {
    putNeighborhoods.mockResolvedValue({ count: 7, source: 'tenant' });
    renderTab();
    const user = userEvent.setup();
    const collection = { type: 'FeatureCollection', features: [] };
    await user.upload(
      screen.getByLabelText('Arquivo de bairros'),
      geojsonFile(JSON.stringify(collection)),
    );
    expect(putNeighborhoods).toHaveBeenCalledWith(id, collection);
    expect(await screen.findByText('Bairros carregados: 7.')).toBeInTheDocument();
    expect(await screen.findByText('7 bairros · enviados pela prefeitura')).toBeInTheDocument();
  });

  it('invalid file shows the format message without calling the API', async () => {
    renderTab();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Arquivo de bairros'), geojsonFile('{não é json'));
    expect(await screen.findByText(FORMAT_MESSAGE)).toBeInTheDocument();
    expect(putNeighborhoods).not.toHaveBeenCalled();
  });

  it('shows the format message when the API answers invalid_neighborhoods', async () => {
    putNeighborhoods.mockRejectedValue(new ApiError(422, { code: 'invalid_neighborhoods' }));
    renderTab();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Arquivo de bairros'), geojsonFile('{}'));
    expect(await screen.findByText(FORMAT_MESSAGE)).toBeInTheDocument();
  });

  it('reset asks for confirmation', async () => {
    getNeighborhoods.mockResolvedValue({ count: 7, source: 'tenant' });
    resetNeighborhoods.mockResolvedValue({ count: 40, source: 'ibge' });
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Voltar para a malha do IBGE' }));
    const dialog = screen.getByRole('dialog', { name: 'Voltar para a malha do IBGE?' });
    expect(
      within(dialog).getByText(
        'Os bairros enviados pela prefeitura são apagados e as ocorrências são recalculadas.',
      ),
    ).toBeInTheDocument();
    expect(resetNeighborhoods).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Voltar para a malha do IBGE' }));
    expect(resetNeighborhoods).toHaveBeenCalledWith(id);
    expect(
      await screen.findByText('A prefeitura voltou para a malha do IBGE.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Voltar para a malha do IBGE' })).toBeNull();
  });

  it('hides reset when the neighborhoods come from IBGE', async () => {
    getNeighborhoods.mockResolvedValue({ count: 40, source: 'ibge' });
    renderTab();
    expect(await screen.findByText('40 bairros · malha do IBGE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar para a malha do IBGE' })).toBeNull();
  });
});

function fireEnds(value: string) {
  const input = screen.getByLabelText('Fim da vigência') as HTMLInputElement;
  // `userEvent.type` em campo de data é frágil: define o valor como o navegador faria.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
