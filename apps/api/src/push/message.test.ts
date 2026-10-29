import { describe, expect, it } from 'vitest';
import { notificationPushMessage } from './message.js';

describe('notificationPushMessage', () => {
  it('notification message carries only kind, tenant and id', () => {
    expect(
      notificationPushMessage('request_in_progress', '2026-000123', {
        tenantId: 't-1',
        requestId: 'r-1',
      }),
    ).toEqual({
      title: 'Alô Cidadão',
      body: 'Solicitação 2026-000123: em atendimento',
      data: { kind: 'request_in_progress', tenantId: 't-1', requestId: 'r-1' },
    });
    expect(
      notificationPushMessage('work_order_assigned', '2026-000123', {
        tenantId: 't-1',
        workOrderId: 'w-1',
      }),
    ).toEqual({
      title: 'Alô Cidadão',
      body: 'Nova atividade: 2026-000123',
      data: { kind: 'work_order_assigned', tenantId: 't-1', workOrderId: 'w-1' },
    });
  });
});
