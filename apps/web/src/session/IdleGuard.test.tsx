import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleGuard } from './IdleGuard';
import { LAST_ACTIVITY_KEY } from './idle';
import { createPanelSession } from './panel-session';
import { SessionProvider } from './SessionProvider';

const MIN = 60_000;
let clock = 0;

function setup() {
  const client = {
    panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
    panelLogout: vi.fn(async () => undefined),
  };
  const session = createPanelSession({ client });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  render(
    <SessionProvider session={session}>
      <IdleGuard now={() => clock} />
    </SessionProvider>,
  );
  return { session, client };
}

/** Avança o relógio da conta de uso e deixa o timer de conferência rodar. */
function advance(ms: number) {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
}

beforeEach(() => {
  clock = 0;
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IdleGuard', () => {
  it('warns 2 min before and signs out after 1 h without action', async () => {
    const { session, client } = setup();

    advance(57 * MIN);
    expect(screen.queryByRole('dialog')).toBeNull();

    advance(1 * MIN);
    expect(screen.getByRole('dialog', { name: 'Sua sessão vai encerrar' })).toBeTruthy();
    expect(screen.getByText('2:00')).toBeTruthy();

    advance(2 * MIN);
    await act(async () => {});
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: true });
    expect(client.panelLogout).toHaveBeenCalledTimes(1);
  });

  it('"Continuar conectado" restarts the hour', () => {
    const { session } = setup();
    advance(59 * MIN);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar conectado' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    advance(30 * MIN);
    expect(session.getState().status).toBe('signed_in');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a key press counts as use', () => {
    const { session } = setup();
    advance(40 * MIN);
    fireEvent.keyDown(window, { key: 'a' });

    advance(40 * MIN);
    expect(session.getState().status).toBe('signed_in');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('use in another tab keeps this tab open', () => {
    const { session } = setup();
    advance(50 * MIN);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(clock));

    advance(20 * MIN);
    expect(session.getState().status).toBe('signed_in');
  });

  it('"Sair agora" signs out without the expired notice', async () => {
    const { session } = setup();
    advance(59 * MIN);
    fireEvent.click(screen.getByRole('button', { name: 'Sair agora' }));
    await act(async () => {});
    expect(session.getState()).toEqual({ status: 'signed_out', expiredNotice: false });
  });
});
