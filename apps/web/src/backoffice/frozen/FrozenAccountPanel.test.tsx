import { ApiError } from '@alocidadao/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { createPanelSession } from '../../session/panel-session';
import { SessionProvider } from '../../session/SessionProvider';
import { FrozenAccountPanel } from './FrozenAccountPanel';

vi.mock('../../api', () => ({
  api: {
    backofficeFrozenAccountCode: vi.fn(),
    backofficeRecoverFrozenAccount: vi.fn(),
    backofficeReleaseFrozenCpf: vi.fn(),
  },
}));

const sendCode = vi.mocked(api.backofficeFrozenAccountCode);
const recover = vi.mocked(api.backofficeRecoverFrozenAccount);
const release = vi.mocked(api.backofficeReleaseFrozenCpf);
const challengeId = '7c1d2e3f-4a5b-4c6d-8e7f-901234567891';

function renderPanel(tenantId: string | null = null) {
  const onResolved = vi.fn();
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
        <FrozenAccountPanel
          cpf="52998224725"
          email="nova@alocidadao.com.br"
          tenantId={tenantId}
          onResolved={onResolved}
        />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { onResolved };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FrozenAccountPanel', () => {
  it('frozen account panel recovers with a code and calls onResolved', async () => {
    const user = userEvent.setup();
    sendCode.mockResolvedValue({
      challengeId,
      maskedEmail: 'a***@exemplo.com',
      retryAfterSeconds: 60,
    });
    recover.mockResolvedValue(undefined);
    const { onResolved } = renderPanel();

    expect(screen.getByText('Este CPF está numa conta bloqueada.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recuperar conta antiga' }));
    expect(sendCode).toHaveBeenCalledWith({ cpf: '52998224725', tenantId: null });
    // Só o e-mail mascarado da conta antiga aparece.
    expect(
      await screen.findByText(
        'Enviamos um código para a***@exemplo.com, o e-mail da conta antiga.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dígito 1 de 6'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: 'Recuperar conta' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(recover).toHaveBeenCalledWith({
      challengeId,
      code: '123456',
      email: 'nova@alocidadao.com.br',
      tenantId: null,
    });
  });

  it('wrong code shows the error and does not resolve', async () => {
    const user = userEvent.setup();
    sendCode.mockResolvedValue({
      challengeId,
      maskedEmail: 'a***@exemplo.com',
      retryAfterSeconds: 60,
    });
    recover.mockRejectedValue(new ApiError(400, { code: 'invalid_code' }));
    const { onResolved } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Recuperar conta antiga' }));
    await user.click(await screen.findByLabelText('Dígito 1 de 6'));
    await user.paste('654321');
    await user.click(screen.getByRole('button', { name: 'Recuperar conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Código incorreto ou expirado. Confira ou peça um novo.',
    );
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('frozen account panel without email offers only a new account', async () => {
    const user = userEvent.setup();
    sendCode.mockRejectedValue(new ApiError(409, { code: 'frozen_account_without_email' }));
    release.mockResolvedValue(undefined);
    const tenantId = '5a4d3f2b-8c1e-4e6f-8a7b-9c0d1e2f3a4b';
    const { onResolved } = renderPanel(tenantId);

    await user.click(screen.getByRole('button', { name: 'Recuperar conta antiga' }));
    expect(
      await screen.findByText(
        'A conta antiga não tem e-mail para receber o código. Só dá para criar uma conta nova.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Recuperar conta antiga' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Criar conta nova' }));
    // Pede confirmação antes de liberar o CPF.
    const dialog = await screen.findByRole('dialog', { name: 'Criar conta nova?' });
    expect(release).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Criar conta nova' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(release).toHaveBeenCalledWith({ cpf: '52998224725', tenantId });
  });
});
