import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '@alocidadao/db';

const discardCode = vi.hoisted(() => vi.fn());
vi.mock('@alocidadao/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discardCode,
}));

import { deliverPhoneCode } from './codes.js';

const db = {} as Database;
const challenge = { challengeId: 'desafio-1', code: '123456' };

function fakeLog() {
  return { warn: vi.fn() } as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> };
}

describe('deliverPhoneCode', () => {
  it('devolve true e não descarta quando o envio funciona', async () => {
    discardCode.mockReset();
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    expect(await deliverPhoneCode(db, sender, fakeLog(), '+5562999990000', challenge)).toBe(true);
    expect(discardCode).not.toHaveBeenCalled();
  });

  it('descarta o código e devolve false quando o envio falha', async () => {
    discardCode.mockReset();
    discardCode.mockResolvedValue(undefined);
    const sender = { send: vi.fn().mockRejectedValue(new Error('falhou')) };
    const log = fakeLog();
    expect(await deliverPhoneCode(db, sender, log, '+5562999990000', challenge)).toBe(false);
    expect(discardCode).toHaveBeenCalledWith(db, 'desafio-1');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('devolve false mesmo se o descarte também falhar', async () => {
    discardCode.mockReset();
    discardCode.mockRejectedValue(new Error('banco fora'));
    const sender = { send: vi.fn().mockRejectedValue(new Error('falhou')) };
    const log = fakeLog();
    expect(await deliverPhoneCode(db, sender, log, '+5562999990000', challenge)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
