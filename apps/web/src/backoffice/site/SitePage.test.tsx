import { ApiError } from '@alocidadao/api-client';
import { DEFAULT_SITE_CONTACT } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { ToastProvider } from '../../ui/Toast';
import { SitePage } from './SitePage';

vi.mock('../../api', () => ({
  api: {
    backofficeContext: vi.fn(),
    backofficeSiteContact: vi.fn(),
    backofficeUpdateSiteContact: vi.fn(),
  },
}));

const context = vi.mocked(api.backofficeContext);
const read = vi.mocked(api.backofficeSiteContact);
const update = vi.mocked(api.backofficeUpdateSiteContact);

const userId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';

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
          <MemoryRouter initialEntries={['/backoffice/site']}>
            <Routes>
              <Route path="/backoffice/prefeituras" element={<p>tela prefeituras</p>} />
              <Route path="/backoffice/site" element={<SitePage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  context.mockResolvedValue({ user: { id: userId, name: 'Lucas Prado' }, platformRole: 'admin' });
  read.mockResolvedValue(DEFAULT_SITE_CONTACT);
  update.mockImplementation(async (body) => body);
});

describe('SitePage', () => {
  it('loads the contact with the WhatsApp formatted', async () => {
    renderPage();
    expect(await screen.findByLabelText('WhatsApp')).toHaveValue('(62) 98208-9667');
    expect(screen.getByLabelText('E-mail')).toHaveValue(DEFAULT_SITE_CONTACT.email);
    expect(screen.getByLabelText('Frase de prazo de resposta')).toHaveValue(
      DEFAULT_SITE_CONTACT.responseNote,
    );
    expect(
      screen.getByText('Aparece embaixo do WhatsApp. Ex.: Resposta no mesmo dia.'),
    ).toBeInTheDocument();
  });

  it('saves the typed WhatsApp as E.164 and shows the success toast', async () => {
    const user = renderPage();
    const whatsapp = await screen.findByLabelText('WhatsApp');
    await user.clear(whatsapp);
    await user.type(whatsapp, '11988771020');
    expect(whatsapp).toHaveValue('(11) 98877-1020');
    const email = screen.getByLabelText('E-mail');
    await user.clear(email);
    await user.type(email, 'Contato@Exemplo.com');
    const note = screen.getByLabelText('Frase de prazo de resposta');
    await user.clear(note);
    await user.type(note, 'Resposta em 1 dia útil.');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        whatsapp: '+5511988771020',
        email: 'contato@exemplo.com',
        responseNote: 'Resposta em 1 dia útil.',
      }),
    );
    expect(await screen.findByText('Contato salvo.')).toBeInTheDocument();
  });

  it('shows validation errors under the fields and does not save', async () => {
    const user = renderPage();
    const whatsapp = await screen.findByLabelText('WhatsApp');
    await user.clear(whatsapp);
    await user.type(whatsapp, '1198');
    await user.clear(screen.getByLabelText('E-mail'));
    await user.type(screen.getByLabelText('E-mail'), 'sem-arroba');
    await user.clear(screen.getByLabelText('Frase de prazo de resposta'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText('Informe um celular com DDD, como (62) 98208-9667.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(screen.getByText('Escreva a frase com até 60 caracteres.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('shows an alert when the API refuses the save', async () => {
    update.mockRejectedValue(new ApiError(400, { code: 'invalid_body' }));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Contato salvo.')).not.toBeInTheDocument();
  });

  it('support goes back to the tenants list', async () => {
    context.mockResolvedValue({ user: { id: userId, name: 'Rafa' }, platformRole: 'support' });
    renderPage();
    expect(await screen.findByText('tela prefeituras')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
});
