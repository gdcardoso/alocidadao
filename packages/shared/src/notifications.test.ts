import { describe, expect, it } from 'vitest';
import {
  AGENT_PUSH_KINDS,
  CITIZEN_PUSH_KINDS,
  NOTIFICATION_KINDS,
  PANEL_NOTIFICATION_KINDS,
  PUSH_TITLE,
  completionEmail,
  notificationText,
  panelNotificationSchema,
  panelNotificationsResponseSchema,
  type NotificationKind,
} from './notifications.js';

describe('notificationText', () => {
  const cases: Array<[NotificationKind, string]> = [
    ['request_in_progress', 'Solicitação 2026-000123: em atendimento'],
    ['request_rejected', 'Solicitação 2026-000123: recusada. Veja o motivo no app'],
    ['request_awaiting_confirmation', 'Solicitação 2026-000123: concluída. Confira as fotos'],
    ['request_reopened', 'Solicitação 2026-000123: voltou para análise'],
    ['work_order_assigned', 'Nova atividade: 2026-000123'],
    ['work_order_rework', 'Ajuste pedido: 2026-000123'],
    ['work_order_impeded', 'Solicitação 2026-000123: impedimento registrado'],
    ['request_contested', 'Solicitação 2026-000123: contestada pelo cidadão'],
    ['occurrence_new', 'Solicitação 2026-000123: nova, aguardando análise'],
    ['request_cancelled', 'Solicitação 2026-000123: cancelada pelo cidadão'],
  ];

  it.each(cases)('returns the text of %s', (kind, text) => {
    expect(notificationText(kind, '2026-000123')).toBe(text);
  });

  it('says whether the completed work order has photos', () => {
    expect(notificationText('work_order_completed', '2026-000123', { withPhotos: true })).toBe(
      'Solicitação 2026-000123: concluída com fotos',
    );
    expect(notificationText('work_order_completed', '2026-000123', { withPhotos: false })).toBe(
      'Solicitação 2026-000123: concluída sem fotos',
    );
    expect(notificationText('work_order_completed', '2026-000123')).toBe(
      'Solicitação 2026-000123: concluída sem fotos',
    );
  });

  it('ignores details for other kinds', () => {
    expect(notificationText('request_in_progress', '1', { withPhotos: true })).toBe(
      'Solicitação 1: em atendimento',
    );
  });
});

describe('push title and completion e-mail', () => {
  it('uses the app name as the push title', () => {
    expect(PUSH_TITLE).toBe('Alô Cidadão');
  });

  it('builds the completion e-mail', () => {
    expect(completionEmail('2026-000123')).toEqual({
      subject: 'Solicitação 2026-000123: concluída',
      text: 'A prefeitura concluiu o atendimento da sua solicitação 2026-000123. Abra o app Alô Cidadão, confira as fotos e diga se o problema foi resolvido. Sem resposta em 7 dias, a solicitação é confirmada automaticamente.',
    });
  });
});

describe('notification kind groups', () => {
  it('has the 11 kinds', () => {
    expect(NOTIFICATION_KINDS).toHaveLength(11);
  });

  it('splits the kinds into three groups without overlap', () => {
    const all = [...CITIZEN_PUSH_KINDS, ...AGENT_PUSH_KINDS, ...PANEL_NOTIFICATION_KINDS];
    expect(new Set(all).size).toBe(all.length);
    expect(all.toSorted()).toEqual(NOTIFICATION_KINDS.toSorted());
  });
});

describe('panel notification schemas', () => {
  const item = {
    id: '6f1c1c1e-0000-4000-8000-000000000001',
    kind: 'work_order_completed',
    protocol: '2026-000123',
    text: 'Solicitação 2026-000123: concluída com fotos',
    occurrenceId: '6f1c1c1e-0000-4000-8000-000000000002',
    workOrderId: null,
    createdAt: '2026-10-29T12:00:00.000Z',
    readAt: null,
  };

  it('accepts an item and the list response', () => {
    expect(panelNotificationSchema.parse(item)).toEqual(item);
    expect(panelNotificationsResponseSchema.parse({ items: [item], unreadCount: 1 })).toEqual({
      items: [item],
      unreadCount: 1,
    });
  });

  it('rejects a kind that is not for the panel', () => {
    expect(
      panelNotificationSchema.safeParse({ ...item, kind: 'request_in_progress' }).success,
    ).toBe(false);
  });
});
