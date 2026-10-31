import type { TenantProfile } from '@alocidadao/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { renderAdminPage } from '../test/render-page';
import { TenantProfilePage } from './TenantProfilePage';

vi.mock('../api', () => ({ api: { panelTenantProfile: vi.fn() } }));

const profileCall = vi.mocked(api.panelTenantProfile);

const profile: TenantProfile = {
  displayName: 'Prefeitura de Cambé',
  city: 'Cambé',
  state: 'PR',
  ibgeCode: '4103503',
  centralPhone: '(43) 3333-4444',
  status: 'onboarding',
  contract: {
    plan: 'complete',
    startsOn: '2026-02-01',
    endsOn: '2027-02-01',
    includedPanelUsers: 10,
  },
  panelUserCount: 4,
  neighborhoods: { count: 12, source: 'tenant' },
};

beforeEach(() => vi.resetAllMocks());

describe('TenantProfilePage', () => {
  it('renders the three blocks and the support note', async () => {
    profileCall.mockResolvedValue(profile);
    renderAdminPage(<TenantProfilePage />, '/dados');

    expect(await screen.findByRole('heading', { name: 'Dados da prefeitura' })).toBeInTheDocument();
    expect(
      screen.getByText('Para alterar estes dados, fale com o suporte do Alô Cidadão.'),
    ).toBeInTheDocument();

    const city = await screen.findByRole('region', { name: 'Prefeitura' });
    expect(within(city).getByText('Prefeitura de Cambé')).toBeInTheDocument();
    expect(within(city).getByText('Cambé · PR')).toBeInTheDocument();
    expect(within(city).getByText('4103503')).toBeInTheDocument();
    expect(within(city).getByText('(43) 3333-4444')).toBeInTheDocument();
    expect(within(city).getByText('Em implantação')).toBeInTheDocument();

    const contract = screen.getByRole('region', { name: 'Contrato' });
    expect(within(contract).getByText('Completo')).toBeInTheDocument();
    expect(within(contract).getByText('01/02/2026 a 01/02/2027')).toBeInTheDocument();
    expect(within(contract).getByText('4 de 10 incluídos')).toBeInTheDocument();

    const neighborhoods = screen.getByRole('region', { name: 'Bairros' });
    expect(
      within(neighborhoods).getByText('12 bairros cadastrados · enviados pela prefeitura'),
    ).toBeInTheDocument();
  });

  it('shows "Nenhum bairro cadastrado" and "Sem contrato cadastrado"', async () => {
    profileCall.mockResolvedValue({
      ...profile,
      contract: null,
      neighborhoods: { count: 0, source: null },
    });
    renderAdminPage(<TenantProfilePage />, '/dados');
    expect(await screen.findByText('Nenhum bairro cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Sem contrato cadastrado')).toBeInTheDocument();
  });

  it('shows the singular and the IBGE source', async () => {
    profileCall.mockResolvedValue({ ...profile, neighborhoods: { count: 1, source: 'ibge' } });
    renderAdminPage(<TenantProfilePage />, '/dados');
    expect(await screen.findByText('1 bairro cadastrado · IBGE')).toBeInTheDocument();
  });
});
