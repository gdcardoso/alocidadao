import { ApiError } from '@alocidadao/api-client';
import type { PanelContext } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import App from '../App';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { Dialog } from '../ui/Dialog';

vi.mock('../api', () => ({
  api: { me: vi.fn(), panelContext: vi.fn(), panelCounts: vi.fn(), panelOccurrences: vi.fn() },
}));
// O MapLibre precisa de WebGL, que o jsdom não tem.
vi.mock('../map/OccurrenceMap', () => ({ OccurrenceMap: () => null }));

const me = vi.mocked(api.me);
const panelContext = vi.mocked(api.panelContext);
const panelCounts = vi.mocked(api.panelCounts);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const userId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';

function meResponse(
  panelTenants: unknown[] = [
    { tenantId, tenantName: 'Prefeitura de São Paulo', role: 'manager', status: 'active' },
  ],
) {
  return { panelTenants } as never;
}

function context(overrides: Partial<PanelContext> = {}): PanelContext {
  return {
    tenant: {
      id: tenantId,
      displayName: 'Prefeitura de São Paulo',
      status: 'active',
      bounds: null,
    },
    user: { id: userId, name: 'Carlos Almeida' },
    role: 'manager',
    departments: [{ id: userId, name: 'Obras' }],
    ...overrides,
  };
}

async function renderApp(path = '/mapa') {
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
          <App />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { session };
}

beforeEach(() => {
  vi.resetAllMocks();
  me.mockResolvedValue(meResponse());
  panelContext.mockResolvedValue(context());
  panelCounts.mockResolvedValue({ triage: 12, awaitingReview: 5, impeded: 2 });
  vi.mocked(api.panelOccurrences).mockResolvedValue({ total: 0, items: [] });
});

describe('sidebar', () => {
  it('sidebar shows tenant name, role with departments and counters', async () => {
    await renderApp();
    expect(await screen.findByText('Prefeitura de São Paulo')).toBeInTheDocument();
    expect(screen.getByText('Carlos Almeida')).toBeInTheDocument();
    expect(screen.getByText('Gestor · Obras')).toBeInTheDocument();
    expect(screen.getByText('CA')).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(panelContext).toHaveBeenCalledWith(tenantId);
    expect(screen.getByRole('link', { name: /Mapa/ })).toHaveAttribute('aria-current', 'page');
  });

  it('zero counters are hidden', async () => {
    panelCounts.mockResolvedValue({ triage: 0, awaitingReview: 3, impeded: 0 });
    await renderApp();
    const nav = await screen.findByRole('navigation');
    expect(await within(nav).findByText('3')).toBeInTheDocument();
    expect(within(nav).queryByText('0')).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Triagem' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Impedimentos' })).toBeInTheDocument();
  });

  it('admin role reads Admin da prefeitura', async () => {
    panelContext.mockResolvedValue(context({ role: 'tenant_admin', departments: [] }));
    await renderApp();
    expect(await screen.findByText('Admin da prefeitura')).toBeInTheDocument();
  });

  it('manager without departments reads Gestor', async () => {
    panelContext.mockResolvedValue(context({ departments: [] }));
    await renderApp();
    expect(await screen.findByText('Gestor')).toBeInTheDocument();
  });

  it('sair signs out and goes to the login', async () => {
    const { session } = await renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(session.getState().status).toBe('signed_out');
  });
});

describe('no access', () => {
  it('403 not_a_member shows the no-access page', async () => {
    panelContext.mockRejectedValue(new ApiError(403, { code: 'not_a_member' }));
    await renderApp();
    expect(await screen.findByText('Seu acesso ao painel não está ativo')).toBeInTheDocument();
    expect(
      screen.getByText('Fale com o administrador do Alô Cidadão na sua prefeitura.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });

  it('user without panel tenants sees the no-access page', async () => {
    me.mockResolvedValue(meResponse([]));
    await renderApp();
    expect(await screen.findByText('Seu acesso ao painel não está ativo')).toBeInTheDocument();
    expect(panelContext).not.toHaveBeenCalled();
  });

  it('403 on a later counters call shows the no-access page', async () => {
    panelCounts.mockRejectedValue(new ApiError(403, { code: 'not_a_member' }));
    await renderApp();
    expect(await screen.findByText('Seu acesso ao painel não está ativo')).toBeInTheDocument();
  });
});

describe('coming soon pages', () => {
  it.each([
    ['/revisao', 'Aguardando revisão'],
    ['/impedimentos', 'Impedimentos'],
    ['/em-atendimento', 'Em atendimento'],
    ['/solicitacoes', 'Todas as solicitações'],
    ['/equipes', 'Equipes e agentes'],
    ['/categorias', 'Categorias'],
  ])('coming soon pages show the menu title and the notice (%s)', async (path, title) => {
    await renderApp(path);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Esta tela chega na próxima etapa do painel.')).toBeInTheDocument();
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open ? (
        <Dialog title="Recusar ocorrência" subtitle="Apoio" onClose={() => setOpen(false)}>
          <label>
            Motivo
            <input />
          </label>
        </Dialog>
      ) : null}
    </>
  );
}

describe('dialog', () => {
  it('dialog closes on escape and returns focus', async () => {
    render(<DialogHarness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Recusar ocorrência' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Motivo')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes with the x button', async () => {
    render(<DialogHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('toast', () => {
  it('shows the text for 4 seconds', async () => {
    vi.useFakeTimers();
    try {
      const { ToastProvider, useToast } = await import('../ui/Toast');
      function Trigger() {
        const { show } = useToast();
        return <button onClick={() => show('Ocorrência recusada.')}>Mostrar</button>;
      }
      render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      act(() => screen.getByRole('button', { name: 'Mostrar' }).click());
      expect(screen.getByRole('status')).toHaveTextContent('Ocorrência recusada.');
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText('Ocorrência recusada.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
