import type { CitizenRow, TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { CitizensTab } from './CitizensTab';

vi.mock('../../../api', () => ({ api: { backofficeTenantCitizens: vi.fn() } }));

const load = vi.mocked(api.backofficeTenantCitizens);

const tenant = { id: '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b' } as unknown as TenantDetail;

const row = (over: Partial<CitizenRow> = {}): CitizenRow => ({
  id: crypto.randomUUID(),
  name: 'Ana Souza',
  phoneMasked: '(15) •••••-1234',
  emailMasked: 'a•••@exemplo.com',
  requestCount: 5,
  openCount: 2,
  lastRequestAt: '2026-10-21T18:40:00.000Z',
  lastActiveAt: null,
  situation: 'active',
  ...over,
});

function renderTab(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <CitizensTab tenant={tenant} isAdmin={false} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return view;
}

describe('CitizensTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    load.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 50 });
  });

  it('renders masked columns and situation badges', async () => {
    load.mockResolvedValue({
      items: [
        row(),
        row({ name: 'Bia Lima', situation: 'inactive', phoneMasked: null }),
        row({ name: 'Caio Reis', situation: 'frozen' }),
      ],
      total: 3,
      page: 1,
      pageSize: 50,
    });
    renderTab();

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    for (const header of [
      'Nome',
      'Celular',
      'E-mail',
      'Solicitações',
      'Abertas',
      'Última solicitação',
      'Último acesso',
      'Situação',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getAllByText('(15) •••••-1234')).toHaveLength(2);
    expect(screen.getAllByText('a•••@exemplo.com').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).getByText('Ativo')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Inativo')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Bloqueada')).toBeInTheDocument();
    expect(screen.getAllByText('nunca entrou').length).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledWith(tenant.id, { page: 1 });
  });

  it('filters by situation and searches by name', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Ana Souza');
    expect(screen.getByText('Situação: todas')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Situação'), 'frozen');
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(tenant.id, { page: 1, situation: 'frozen' }),
    );

    load.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    await user.type(screen.getByPlaceholderText('Buscar por nome'), 'ana');
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(tenant.id, {
        page: 1,
        q: 'ana',
        situation: 'frozen',
      }),
    );
    expect(await screen.findByText('Nenhum cidadão com estes filtros.')).toBeInTheDocument();
  });

  it('does not reload (and re-audit) when the tab remounts within the stale time', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderTab(queryClient);
    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    first.unmount();
    renderTab(queryClient);
    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the empty message when nobody asked yet', async () => {
    load.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderTab();
    expect(
      await screen.findByText('Ninguém fez solicitação nesta cidade ainda.'),
    ).toBeInTheDocument();
  });

  it('paginates by 50', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, i) => row({ name: `Pessoa ${i}` })),
      total: 120,
      page: 1,
      pageSize: 50,
    });
    renderTab();
    expect(await screen.findByText('1–50 de 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(tenant.id, { page: 2 }));
    expect(await screen.findByText('51–100 de 120')).toBeInTheDocument();
  });
});
