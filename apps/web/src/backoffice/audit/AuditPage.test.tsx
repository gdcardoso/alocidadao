import { ApiError } from '@alocidadao/api-client';
import type { AuditRow } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { AuditPage } from './AuditPage';

vi.mock('../../api', () => ({
  api: {
    backofficeContext: vi.fn(),
    backofficeAudit: vi.fn(),
    backofficeTenants: vi.fn(),
    backofficeStaff: vi.fn(),
  },
}));

const context = vi.mocked(api.backofficeContext);
const audit = vi.mocked(api.backofficeAudit);
const tenants = vi.mocked(api.backofficeTenants);
const staff = vi.mocked(api.backofficeStaff);

const selfId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';
const marinaId = '7c1d2e3f-4a5b-4c6d-8e7f-901234567891';
const tenantId = '3b2a1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    at: '2026-10-21T18:40:00.000Z',
    staffName: 'Lucas Prado',
    tenantId,
    tenantName: 'Prefeitura de Atibaia',
    action: 'support.enter',
    targetType: null,
    targetLabel: '—',
    ...overrides,
  };
}

function Location() {
  const location = useLocation();
  return <p data-testid="search">{location.search}</p>;
}

function renderPage(path = '/backoffice/auditoria') {
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
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/backoffice/prefeituras" element={<p>tela prefeituras</p>} />
            <Route
              path="/backoffice/auditoria"
              element={
                <>
                  <AuditPage />
                  <Location />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  context.mockResolvedValue({ user: { id: selfId, name: 'Lucas Prado' }, platformRole: 'admin' });
  tenants.mockResolvedValue({
    overview: {},
    items: [{ id: tenantId, displayName: 'Prefeitura de Atibaia' }],
  } as never);
  staff.mockResolvedValue({
    items: [
      { userId: selfId, name: 'Lucas Prado' },
      { userId: marinaId, name: 'Marina Dias' },
    ],
  } as never);
  audit.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 50 });
});

describe('AuditPage', () => {
  it('lists events with action labels and dash for backoffice actions', async () => {
    audit.mockResolvedValue({
      items: [
        row(),
        row({
          id: '22222222-2222-4222-8222-222222222222',
          staffName: 'Marina Dias',
          tenantId: null,
          tenantName: null,
          action: 'staff.role_change',
          targetType: 'staff',
          targetLabel: 'Bia Lima',
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
    const first = (
      await screen.findByText('Prefeitura de Atibaia', { selector: 'td *, td' })
    ).closest('tr')!;
    expect(within(first).getByText('21/10/2026, 15:40')).toBeInTheDocument();
    expect(within(first).getByText('Lucas Prado')).toBeInTheDocument();
    expect(within(first).getByText('Entrou no painel (suporte)')).toBeInTheDocument();
    expect(within(first).getByText('—')).toBeInTheDocument();
    const second = screen.getByText('Marina Dias', { selector: 'td *, td' }).closest('tr')!;
    expect(within(second).getByText('Trocou o papel de uma pessoa da equipe')).toBeInTheDocument();
    expect(within(second).getByText('Bia Lima')).toBeInTheDocument();
    // Sem prefeitura e com alvo: só o traço da prefeitura.
    expect(within(second).getAllByText('—')).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith({ page: 1 });
  });

  it('unknown action shows Fez uma alteração', async () => {
    audit.mockResolvedValue({
      items: [row({ action: 'something.new' })],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderPage();
    expect(await screen.findByText('Fez uma alteração')).toBeInTheDocument();
  });

  it('filters by tenant, person and period and resets to page 1', async () => {
    audit.mockResolvedValue({ items: [row()], total: 120, page: 3, pageSize: 50 });
    const user = renderPage('/backoffice/auditoria?pagina=3');
    await screen.findByText('Prefeitura de Atibaia', { selector: 'td *, td' });
    expect(audit).toHaveBeenLastCalledWith({ page: 3 });

    await user.selectOptions(screen.getByLabelText('Prefeitura'), tenantId);
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ page: 1, tenantId }));
    expect(screen.getByTestId('search')).toHaveTextContent(`prefeitura=${tenantId}`);
    expect(screen.getByTestId('search')).not.toHaveTextContent('pagina');

    await user.selectOptions(screen.getByLabelText('Pessoa'), marinaId);
    await waitFor(() =>
      expect(audit).toHaveBeenLastCalledWith({ page: 1, tenantId, staffUserId: marinaId }),
    );

    await user.type(screen.getByLabelText('De'), '2026-10-01');
    await user.type(screen.getByLabelText('Até'), '2026-10-31');
    await waitFor(() =>
      expect(audit).toHaveBeenLastCalledWith({
        page: 1,
        tenantId,
        staffUserId: marinaId,
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
  });

  it('reads the filters from the url', async () => {
    renderPage(`/backoffice/auditoria?pessoa=${marinaId}&de=2026-10-01&ate=2026-10-31`);
    await waitFor(() =>
      expect(audit).toHaveBeenCalledWith({
        page: 1,
        staffUserId: marinaId,
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
    expect(screen.getByLabelText('Pessoa')).toHaveValue(marinaId);
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-01');
  });

  it('paginates', async () => {
    audit.mockResolvedValue({ items: [row()], total: 120, page: 1, pageSize: 50 });
    const user = renderPage();
    expect(await screen.findByText('1–1 de 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ page: 2 }));
    expect(screen.getByTestId('search')).toHaveTextContent('pagina=2');
    await user.click(await screen.findByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ page: 1 }));
  });

  it('shows the empty state', async () => {
    audit.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderPage();
    expect(await screen.findByText('Nenhuma ação com estes filtros.')).toBeInTheDocument();
  });

  it('shows a loading state, then an error with retry that recovers', async () => {
    audit.mockRejectedValueOnce(new ApiError(500, { code: 'boom' }));
    const user = renderPage();
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByText('Não foi possível carregar a auditoria.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByText('Prefeitura de Atibaia', { selector: 'td *, td' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar a auditoria.')).not.toBeInTheDocument();
  });

  it('support goes back to prefeituras and nothing is fetched', async () => {
    context.mockResolvedValue({
      user: { id: selfId, name: 'Rafa Souza' },
      platformRole: 'support',
    });
    renderPage();
    expect(await screen.findByText('tela prefeituras')).toBeInTheDocument();
    expect(audit).not.toHaveBeenCalled();
    expect(staff).not.toHaveBeenCalled();
    expect(tenants).not.toHaveBeenCalled();
  });

  it('goes back to page 1 when the page is beyond the last', async () => {
    audit.mockImplementation(async (query) =>
      query?.page === 1
        ? { items: [row()], total: 1, page: 1, pageSize: 50 }
        : { items: [], total: 0, page: query?.page ?? 1, pageSize: 50 },
    );
    renderPage('/backoffice/auditoria?pagina=9');
    expect(await screen.findByText('1–1 de 1')).toBeInTheDocument();
    expect(screen.getByTestId('search')).not.toHaveTextContent('pagina');
    expect(audit).toHaveBeenLastCalledWith({ page: 1 });
  });

  it('ignores invalid url params', async () => {
    renderPage('/backoffice/auditoria?prefeitura=x&pessoa=y&de=2026-13-45&ate=ontem');
    await screen.findByText('Prefeitura de Atibaia', { selector: 'td *, td' });
    expect(audit).toHaveBeenCalledWith({ page: 1 });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
