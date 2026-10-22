import { describe, expect, it } from 'vitest';
import { statusPushMessage } from './message.js';

describe('statusPushMessage', () => {
  it('carries only protocol and status', () => {
    const m = statusPushMessage('2026-000123', 'in_progress');
    expect(m).toEqual({
      title: 'Alô Cidadão',
      body: 'Solicitação 2026-000123: Em atendimento',
      data: { protocol: '2026-000123', status: 'in_progress' },
    });
  });
});
