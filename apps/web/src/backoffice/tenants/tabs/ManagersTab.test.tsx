import type { TenantDetail } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@alocidadao/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { createPanelSession } from '../../../session/panel-session';
import { SessionProvider } from '../../../session/SessionProvider';
import { ToastProvider } from '../../../ui/Toast';
import { ManagersTab } from './ManagersTab';

vi.mock('../../../api', () => ({
  api: { backofficeTenantManagers: vi.fn(), backofficeResendTenantManagerInvite: vi.fn() },
}));

const load = vi.mocked(api.backofficeTenantManagers);
const resendInvite = vi.mocked(api.backofficeResendTenantManagerInvite);

const tenant = { id: '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b' } as unknown as TenantDetail;

function renderTab(onOpenPanel = vi.fn()) {
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
          <ManagersTab tenant={tenant} isAdmin={false} onOpenPanel={onOpenPanel} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return onOpenPanel;
}

describe('ManagersTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the rows read-only and opens the panel at /equipes/gestores', async () => {
    load.mockResolvedValue({
      items: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Gestora de Obras',
          cpfMasked: '•••.982.247-••',
          emailMasked: 'g•••@exemplo.com',
          role: 'manager',
          status: 'active',
          departments: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Obras' }],
        },
      ],
    });
    const onOpenPanel = renderTab();

    expect(await screen.findByText('Gestora de Obras')).toBeInTheDocument();
    expect(screen.getByText('g•••@exemplo.com')).toBeInTheDocument();
    expect(screen.getByText('•••.982.247-••')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(tenant.id);
    expect(screen.queryByRole('button', { name: /editar/i })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir no painel' }));
    expect(onOpenPanel).toHaveBeenCalledWith('/equipes/gestores');
  });

  it('resends the invite from the row menu, admins included', async () => {
    load.mockResolvedValue({
      items: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Gestora de Obras',
          cpfMasked: null,
          emailMasked: 'g•••@exemplo.com',
          role: 'tenant_admin',
          status: 'active',
          departments: [],
        },
      ],
    });
    resendInvite.mockResolvedValueOnce({ maskedEmail: 'g•••@exemplo.com' });
    resendInvite.mockRejectedValueOnce(new ApiError(409, { code: 'email_missing' }));
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ações de Gestora de Obras' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reenviar convite' }));
    expect(resendInvite).toHaveBeenCalledWith(tenant.id, '11111111-1111-4111-8111-111111111111');
    expect(await screen.findByText('Convite reenviado para g•••@exemplo.com.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ações de Gestora de Obras' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reenviar convite' }));
    expect(
      await screen.findByText('Cadastre um e-mail para enviar o convite.'),
    ).toBeInTheDocument();
  });

  it('offers the resend only to active rows with an e-mail', async () => {
    const row = (
      userId: string,
      name: string,
      emailMasked: string | null,
      status: 'active' | 'inactive',
    ) => ({
      userId,
      name,
      cpfMasked: null,
      emailMasked,
      role: 'manager' as const,
      status,
      departments: [],
    });
    load.mockResolvedValue({
      items: [
        row('11111111-1111-4111-8111-111111111111', 'Com Email', 'c•••@exemplo.com', 'active'),
        row('22222222-2222-4222-8222-222222222222', 'Sem Email', null, 'active'),
        row('33333333-3333-4333-8333-333333333333', 'Desativado', 'd•••@exemplo.com', 'inactive'),
      ],
    });
    renderTab();
    await screen.findByText('Com Email');
    expect(screen.getByRole('button', { name: 'Ações de Com Email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ações de Sem Email' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ações de Desativado' })).toBeNull();
  });

  it('shows an alert when loading fails', async () => {
    load.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
  });
});
