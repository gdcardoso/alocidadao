import type { PanelNotification, PanelNotificationsResponse } from '@alocidadao/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { createPanelSession } from '../session/panel-session';
import { SessionProvider } from '../session/SessionProvider';
import { NotificationBell } from './NotificationBell';
import { PanelValueContext, type PanelValue } from './use-panel';

vi.mock('../api', () => ({
  api: {
    panelNotifications: vi.fn(),
    panelReadNotification: vi.fn(),
    panelReadAllNotifications: vi.fn(),
  },
}));

const notifications = vi.mocked(api.panelNotifications);
const readOne = vi.mocked(api.panelReadNotification);
const readAll = vi.mocked(api.panelReadAllNotifications);

const tenantId = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const occurrenceId = '11111111-1111-4111-8111-111111111111';
const workOrderId = '22222222-2222-4222-8222-222222222222';

function notification(overrides: Partial<PanelNotification> = {}): PanelNotification {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'occurrence_new',
    protocol: 'AC-2026-000123',
    text: 'Solicitação AC-2026-000123: nova, aguardando análise',
    occurrenceId,
    workOrderId: null,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    readAt: null,
    ...overrides,
  };
}

function response(items: PanelNotification[]): PanelNotificationsResponse {
  return { items, unreadCount: items.filter((item) => !item.readAt).length };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderBell(support: PanelValue['support'] = null) {
  const session = createPanelSession({
    client: {
      panelRefresh: vi.fn(async () => ({ accessToken: 't', accessExpiresInSeconds: 900 })),
      panelLogout: vi.fn(async () => undefined),
    },
  });
  session.signIn({ accessToken: 't', accessExpiresInSeconds: 900 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value = { tenantId, context: {}, counts: undefined, support } as unknown as PanelValue;
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <PanelValueContext.Provider value={value}>
          <MemoryRouter initialEntries={['/mapa']}>
            <NotificationBell />
            <Where />
          </MemoryRouter>
        </PanelValueContext.Provider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  readOne.mockResolvedValue(undefined);
  readAll.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationBell', () => {
  it('shows the unread count and the list with relative time', async () => {
    notifications.mockResolvedValue(
      response([
        notification(),
        notification({
          id: '44444444-4444-4444-8444-444444444444',
          text: 'Solicitação AC-2026-000124: cancelada pelo cidadão',
          kind: 'request_cancelled',
          readAt: new Date().toISOString(),
        }),
      ]),
    );
    renderBell();
    const bell = await screen.findByRole('button', { name: 'Avisos' });
    expect(await within(bell).findByText('1')).toBeInTheDocument();
    await userEvent.click(bell);
    expect(screen.getByText('Solicitação AC-2026-000123: nova, aguardando análise')).toBeVisible();
    expect(screen.getByText('Solicitação AC-2026-000124: cancelada pelo cidadão')).toBeVisible();
    expect(screen.getAllByText('há 5 min')).toHaveLength(2);
  });

  it.each([
    ['work_order_completed', { workOrderId }, `/revisao?atividade=${workOrderId}`],
    ['work_order_impeded', { workOrderId }, `/impedimentos?atividade=${workOrderId}`],
    ['occurrence_new', {}, `/triagem?ocorrencia=${occurrenceId}`],
    ['request_contested', {}, `/solicitacoes?ocorrencia=${occurrenceId}`],
    ['request_cancelled', {}, `/solicitacoes?ocorrencia=${occurrenceId}`],
  ] as const)(
    'clicking an item marks it read and navigates to its place (%s)',
    async (kind, extra, path) => {
      const item = notification({ kind, text: `Aviso ${kind}`, ...extra });
      notifications.mockResolvedValue(response([item]));
      renderBell();
      await userEvent.click(await screen.findByRole('button', { name: 'Avisos' }));
      await userEvent.click(await screen.findByText(`Aviso ${kind}`));
      expect(readOne).toHaveBeenCalledWith(tenantId, item.id);
      expect(screen.getByTestId('where')).toHaveTextContent(path);
    },
  );

  it('mark all as read clears the count', async () => {
    const item = notification();
    notifications.mockResolvedValueOnce(response([item]));
    notifications.mockResolvedValue(response([{ ...item, readAt: new Date().toISOString() }]));
    renderBell();
    const bell = await screen.findByRole('button', { name: 'Avisos' });
    expect(await within(bell).findByText('1')).toBeInTheDocument();
    await userEvent.click(bell);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todos como lidos' }));
    expect(readAll).toHaveBeenCalledWith(tenantId);
    await waitFor(() => expect(within(bell).queryByText('1')).not.toBeInTheDocument());
  });

  it('refetches every minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    notifications.mockResolvedValue(response([]));
    renderBell();
    await waitFor(() => expect(notifications).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(notifications).toHaveBeenCalledTimes(2));
  });

  it('hidden in support mode', () => {
    notifications.mockResolvedValue(response([]));
    renderBell({ tenantId, displayName: 'Prefeitura de Santos' });
    expect(screen.queryByRole('button', { name: 'Avisos' })).not.toBeInTheDocument();
    expect(notifications).not.toHaveBeenCalled();
  });

  it('empty list shows the empty text', async () => {
    notifications.mockResolvedValue(response([]));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Avisos' }));
    expect(await screen.findByText('Nenhum aviso por enquanto.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Marcar todos como lidos' })).toBeNull();
  });
});
