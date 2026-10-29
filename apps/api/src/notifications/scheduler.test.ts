import type { Database } from '@alocidadao/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  claimNotifications: vi.fn(async () => []),
  autoConfirmRequests: vi.fn(async () => 0),
  cleanupNotifications: vi.fn(async () => {}),
}));

vi.mock('@alocidadao/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...db,
}));

const { startScheduler } = await import('./scheduler.js');
const { buildApp } = await import('../app.js');

function deps() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sender = { send: vi.fn() };
  return {
    db: {} as Database,
    push: { android: sender, ios: sender },
    email: { send: vi.fn() },
    log,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  db.claimNotifications.mockReset().mockResolvedValue([]);
  db.autoConfirmRequests.mockReset().mockResolvedValue(0);
  db.cleanupNotifications.mockReset().mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notification scheduler', () => {
  it('scheduler runs auto confirm and cleanup on its interval', async () => {
    const scheduler = startScheduler(deps(), {
      dispatchEveryMs: 5_000,
      maintenanceEveryMs: 600_000,
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(db.claimNotifications).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(db.claimNotifications).toHaveBeenCalledTimes(1);
    expect(db.claimNotifications).toHaveBeenCalledWith(expect.anything(), 50);
    expect(db.autoConfirmRequests).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600_000 - 5_000);
    expect(db.claimNotifications).toHaveBeenCalledTimes(120);
    expect(db.autoConfirmRequests).toHaveBeenCalledTimes(1);
    expect(db.cleanupNotifications).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(db.autoConfirmRequests).toHaveBeenCalledTimes(2);
    expect(db.cleanupNotifications).toHaveBeenCalledTimes(2);

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(db.autoConfirmRequests).toHaveBeenCalledTimes(2);
    expect(db.claimNotifications).toHaveBeenCalledTimes(240);
  });

  it('does not overlap runs and waits for the running one on stop', async () => {
    let release!: () => void;
    db.claimNotifications.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const scheduler = startScheduler(deps(), {
      dispatchEveryMs: 5_000,
      maintenanceEveryMs: 600_000,
    });

    await vi.advanceTimersByTimeAsync(20_000);
    // A primeira rodada ainda roda: as batidas seguintes são puladas.
    expect(db.claimNotifications).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('an error in a run is logged and the scheduler keeps going', async () => {
    db.claimNotifications.mockRejectedValueOnce(new Error('banco fora'));
    db.autoConfirmRequests.mockRejectedValueOnce(new Error('trava'));
    const d = deps();
    const scheduler = startScheduler(d, { dispatchEveryMs: 5_000, maintenanceEveryMs: 10_000 });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(d.log.error).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(db.claimNotifications).toHaveBeenCalledTimes(4);
    expect(db.autoConfirmRequests).toHaveBeenCalledTimes(2);
    // A limpeza não depende da confirmação automática.
    expect(db.cleanupNotifications).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it('closing the app waits for the running dispatch before the onClose hooks', async () => {
    // Só os intervalos são falsos: o fechamento do Fastify usa os timers de verdade.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const order: string[] = [];
    let release!: () => void;
    db.claimNotifications.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            order.push('dispatch finished');
            resolve([]);
          };
        }),
    );
    const sender = { send: vi.fn() };
    const app = await buildApp({
      database: {} as Database,
      auth: {
        secret: 'segredo-de-teste-da-api-com-mais-de-32-caracteres',
        email: { send: vi.fn() },
      },
      push: { android: sender, ios: sender },
      notifications: { scheduler: true },
    });
    // Como o server.ts: o pool fecha num onClose registrado depois do buildApp.
    app.addHook('onClose', async () => {
      order.push('pool closed');
    });
    await app.ready();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(db.claimNotifications).toHaveBeenCalledTimes(1);

    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    release();
    await closing;
    expect(order).toEqual(['dispatch finished', 'pool closed']);
  });
});
