import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { LegalLinks } from './LegalLinks';
import { TermsGate } from './TermsGate';

vi.mock('../api', () => ({ api: { me: vi.fn(), acceptTerms: vi.fn(), panelCounts: vi.fn() } }));

const me = vi.mocked(api.me);
const acceptTerms = vi.mocked(api.acceptTerms);

function Panel() {
  // Uma tela interna cuja chamada pode responder 403 terms_required.
  const query = useQuery({ queryKey: ['counts'], queryFn: () => api.panelCounts('t') as never });
  return <p>Painel aberto {query.isError ? 'com erro' : ''}</p>;
}

function renderGate() {
  const panelLogout = vi.fn(async () => undefined);
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout,
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <MemoryRouter initialEntries={['/mapa']}>
          <Routes>
            <Route element={<TermsGate />}>
              <Route path="/mapa" element={<Panel />} />
            </Route>
            <Route path="/entrar" element={<p>Tela de entrada</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { panelLogout, user: userEvent.setup() };
}

beforeEach(() => {
  vi.resetAllMocks();
  me.mockResolvedValue({ termsAccepted: false } as never);
  acceptTerms.mockResolvedValue(undefined);
  vi.mocked(api.panelCounts).mockResolvedValue({} as never);
});

describe('TermsGate', () => {
  it('shows the acceptance screen and hides the panel while not accepted', async () => {
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Antes de continuar' })).toBeInTheDocument();
    expect(
      screen.getByText('Para usar o Alô Cidadão, leia e aceite os Termos de Uso.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Painel aberto/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('reading the terms and agreeing ticks the box, and Continuar accepts and opens the panel', async () => {
    const { user } = renderGate();
    await screen.findByText('Antes de continuar');
    await user.click(screen.getByRole('button', { name: 'Termos de Uso' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Li e concordo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();

    me.mockResolvedValue({ termsAccepted: true } as never);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Painel aberto')).toBeInTheDocument();
  });

  it('Sair signs out and goes to the login', async () => {
    const { user, panelLogout } = renderGate();
    await screen.findByText('Antes de continuar');
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(panelLogout).toHaveBeenCalled();
    expect(await screen.findByText('Tela de entrada')).toBeInTheDocument();
  });

  it('renders the panel straight away when the terms are already accepted', async () => {
    me.mockResolvedValue({ termsAccepted: true } as never);
    renderGate();
    expect(await screen.findByText('Painel aberto')).toBeInTheDocument();
  });

  it('a 403 terms_required from any call brings the acceptance screen back', async () => {
    me.mockResolvedValue({ termsAccepted: true } as never);
    // A chamada interna falha e, a partir daí, a API passa a dizer que falta o aceite.
    vi.mocked(api.panelCounts).mockImplementation(async () => {
      me.mockResolvedValue({ termsAccepted: false } as never);
      throw new ApiError(403, { code: 'terms_required' });
    });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Antes de continuar' })).toBeInTheDocument();
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
  });
});

describe('LegalLinks', () => {
  it('opens the text for reading only, with no Li e concordo', async () => {
    const user = userEvent.setup();
    render(<LegalLinks />);
    await user.click(screen.getByRole('button', { name: 'Política de Privacidade' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Li e concordo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Termos de Uso' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
