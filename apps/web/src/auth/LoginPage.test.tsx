import { ApiError } from '@alocidadao/api-client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { LoginPage } from './LoginPage';

vi.mock('../api', () => ({
  api: { panelStart: vi.fn(), panelVerify: vi.fn(), me: vi.fn() },
}));

const panelStart = vi.mocked(api.panelStart);
const panelVerify = vi.mocked(api.panelVerify);
const me = vi.mocked(api.me);

const challenge = {
  challengeId: '7d9f0c2e-4b1a-4c3d-9e8f-1a2b3c4d5e6f',
  expiresInSeconds: 600,
  resendInSeconds: 45,
  maskedEmail: 'c••••••@prefeitura.sp.gov.br',
};

function renderLogin() {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () =>
        Promise.reject(new ApiError(401, { code: 'session_expired' })),
      ),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(
    <SessionProvider session={session}>
      <MemoryRouter initialEntries={['/entrar']}>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/mapa" element={<p>Página do mapa</p>} />
          <Route path="/backoffice/prefeituras" element={<p>Página do backoffice</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
  return { user, session };
}

async function sendCpf(user: ReturnType<typeof userEvent.setup>, cpf = '52998224725') {
  await user.type(await screen.findByLabelText('CPF'), cpf);
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  panelStart.mockReset();
  panelVerify.mockReset();
  me.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LoginPage', () => {
  it('masks the cpf while typing', async () => {
    const { user } = renderLogin();
    await user.type(await screen.findByLabelText('CPF'), '1234567890999');
    expect(screen.getByLabelText('CPF')).toHaveValue('123.456.789-09');
  });

  it('login rejects an invalid cpf without calling the api', async () => {
    const { user } = renderLogin();
    await sendCpf(user, '12345678900');

    expect(await screen.findByText('Confira o CPF.')).toBeInTheDocument();
    expect(panelStart).not.toHaveBeenCalled();
  });

  it('login shows the masked email and counts down to the resend link', async () => {
    panelStart.mockResolvedValue(challenge);
    const { user } = renderLogin();
    await sendCpf(user);

    expect(panelStart).toHaveBeenCalledWith({ cpf: '52998224725' });
    expect(
      await screen.findByText(
        'Enviamos um código de 6 dígitos para c••••••@prefeitura.sp.gov.br. Ele vale por 10 minutos.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Não chegou? Veja o spam ou reenvie em 0:45.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    const resend = await screen.findByRole('button', { name: 'reenvie o código' });
    await user.click(resend);

    expect(panelStart).toHaveBeenCalledTimes(2);
    expect(panelStart).toHaveBeenLastCalledWith({ cpf: '52998224725' });
    expect(
      await screen.findByText('Não chegou? Veja o spam ou reenvie em 0:45.'),
    ).toBeInTheDocument();
  });

  it('six pasted digits submit the code', async () => {
    panelStart.mockResolvedValue(challenge);
    panelVerify.mockResolvedValue({ session: { accessToken: 'tok', accessExpiresInSeconds: 900 } });
    me.mockResolvedValue({ platformRole: null } as never);
    const { user, session } = renderLogin();
    await sendCpf(user);

    await user.click(await screen.findByLabelText('Dígito 1 de 6'));
    await user.paste('731942');

    expect(panelVerify).toHaveBeenCalledWith({
      challengeId: challenge.challengeId,
      code: '731942',
    });
    expect(await screen.findByText('Página do mapa')).toBeInTheDocument();
    expect(session.getAccessToken()).toBe('tok');
  });

  it('staff lands on the backoffice after login and others on the map', async () => {
    panelStart.mockResolvedValue(challenge);
    panelVerify.mockResolvedValue({ session: { accessToken: 'tok', accessExpiresInSeconds: 900 } });
    me.mockResolvedValue({ platformRole: 'support' } as never);
    const { user } = renderLogin();
    await sendCpf(user);

    await user.click(await screen.findByLabelText('Dígito 1 de 6'));
    await user.paste('731942');

    expect(await screen.findByText('Página do backoffice')).toBeInTheDocument();
  });

  it('code_invalid shows the message and keeps the step', async () => {
    panelStart.mockResolvedValue(challenge);
    panelVerify.mockRejectedValue(new ApiError(400, { code: 'code_invalid' }));
    const { user } = renderLogin();
    await sendCpf(user);

    await user.click(await screen.findByLabelText('Dígito 1 de 6'));
    await user.keyboard('123456');

    expect(
      await screen.findByText('Código incorreto. Confira e tente de novo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confira seu e-mail' })).toBeInTheDocument();
  });

  it('panel_access_not_found shows the message', async () => {
    panelStart.mockRejectedValue(new ApiError(404, { code: 'panel_access_not_found' }));
    const { user } = renderLogin();
    await sendCpf(user);

    expect(
      await screen.findByText(
        'Não encontramos acesso ao painel para este CPF. Fale com o administrador do Alô Cidadão na sua prefeitura.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('shows the expired session banner', async () => {
    const session = createPanelSession({
      client: {
        panelRefresh: vi.fn(async () => Promise.reject(new ApiError(401, {}))),
        panelLogout: vi.fn(async () => undefined),
      },
    });
    session.signIn({ accessToken: 'old', accessExpiresInSeconds: 900 });
    await session
      .withAuth(async () => Promise.reject(new ApiError(401, {})))
      .catch(() => undefined);
    render(
      <SessionProvider session={session}>
        <MemoryRouter initialEntries={['/entrar']}>
          <LoginPage />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(await screen.findByText('Sua sessão expirou. Entre de novo.')).toBeInTheDocument();
  });
});
