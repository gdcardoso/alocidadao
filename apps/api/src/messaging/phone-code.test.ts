import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createLogPhoneCodeSender, maskPhone } from './phone-code.js';

describe('maskPhone', () => {
  it('shows only the area code and the last four digits', () => {
    expect(maskPhone('+5562982089667')).toBe('+55 62 9****-9667');
  });
});

describe('createLogPhoneCodeSender', () => {
  it('writes the phone and the code to the log', async () => {
    const info = vi.fn();
    const sender = createLogPhoneCodeSender({ info } as unknown as FastifyBaseLogger);
    await sender.send('+5562982089667', '123456');
    expect(info).toHaveBeenCalledWith(
      { phone: '+5562982089667', code: '123456' },
      'Código pelo celular (log, sem provedor)',
    );
  });
});
