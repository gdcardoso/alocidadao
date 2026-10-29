import { describe, expect, it } from 'vitest';
import { buildPushSenders } from './senders.js';

describe('buildPushSenders', () => {
  it('missing p8 file disables apns with a warning instead of crashing', async () => {
    const warns: string[] = [];
    const infos: string[] = [];
    const senders = buildPushSenders(
      {
        fcm: undefined,
        apns: {
          teamId: 't',
          keyId: 'k',
          keyFile: '/nao/existe/apns.p8',
          production: false,
          bundleId: 'br.com.alocidadao.app',
        },
      },
      { info: (_o, m) => infos.push(m), warn: (_o, m) => warns.push(m) },
    );
    expect(warns).toHaveLength(1);
    expect(senders.configured).toEqual({ android: false, ios: false });
    expect(await senders.ios.send('tok', { title: 'a', body: 'b', data: {} })).toEqual({
      kind: 'sent',
    });
    expect(infos).toEqual(['Push (log, sem provedor)']);
  });

  it('falls back to the log sender when nothing is configured', () => {
    const senders = buildPushSenders(
      { fcm: undefined, apns: undefined },
      { info: () => {}, warn: () => {} },
    );
    expect(senders.configured).toEqual({ android: false, ios: false });
  });
});
