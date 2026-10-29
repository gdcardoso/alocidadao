import { z } from 'zod';

/** Avisos do sistema: o tipo diz para quem vai, por qual canal e qual é o texto. */
export const NOTIFICATION_KINDS = [
  'request_in_progress',
  'request_rejected',
  'request_awaiting_confirmation',
  'request_reopened',
  'work_order_assigned',
  'work_order_rework',
  'work_order_completed',
  'work_order_impeded',
  'request_contested',
  'occurrence_new',
  'request_cancelled',
] as const;

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** Avisos por push ao cidadão (`request_awaiting_confirmation` também vai por e-mail). */
export const CITIZEN_PUSH_KINDS = [
  'request_in_progress',
  'request_rejected',
  'request_awaiting_confirmation',
  'request_reopened',
] as const satisfies readonly NotificationKind[];

/** Avisos por push aos agentes da equipe da atividade. */
export const AGENT_PUSH_KINDS = [
  'work_order_assigned',
  'work_order_rework',
] as const satisfies readonly NotificationKind[];

/** Avisos do sino do painel, para gestores e admins. */
export const PANEL_NOTIFICATION_KINDS = [
  'work_order_completed',
  'work_order_impeded',
  'request_contested',
  'occurrence_new',
  'request_cancelled',
] as const satisfies readonly NotificationKind[];

/** Título de todo push. */
export const PUSH_TITLE = 'Alô Cidadão';

/** Texto do aviso. `details.withPhotos` só conta para `work_order_completed`. */
export function notificationText(
  kind: NotificationKind,
  protocol: string,
  details?: { withPhotos?: boolean },
): string {
  switch (kind) {
    case 'request_in_progress':
      return `Solicitação ${protocol}: em atendimento`;
    case 'request_rejected':
      return `Solicitação ${protocol}: recusada. Veja o motivo no app`;
    case 'request_awaiting_confirmation':
      return `Solicitação ${protocol}: concluída. Confira as fotos`;
    case 'request_reopened':
      return `Solicitação ${protocol}: voltou para análise`;
    case 'work_order_assigned':
      return `Nova atividade: ${protocol}`;
    case 'work_order_rework':
      return `Ajuste pedido: ${protocol}`;
    case 'work_order_completed':
      return details?.withPhotos
        ? `Solicitação ${protocol}: concluída com fotos`
        : `Solicitação ${protocol}: concluída sem fotos`;
    case 'work_order_impeded':
      return `Solicitação ${protocol}: impedimento registrado`;
    case 'request_contested':
      return `Solicitação ${protocol}: contestada pelo cidadão`;
    case 'occurrence_new':
      return `Solicitação ${protocol}: nova, aguardando análise`;
    case 'request_cancelled':
      return `Solicitação ${protocol}: cancelada pelo cidadão`;
  }
}

/** E-mail da conclusão (só texto). */
export function completionEmail(protocol: string): { subject: string; text: string } {
  return {
    subject: `Solicitação ${protocol}: concluída`,
    text: `A prefeitura concluiu o atendimento da sua solicitação ${protocol}. Abra o app Alô Cidadão, confira as fotos e diga se o problema foi resolvido. Sem resposta em 7 dias, a solicitação é confirmada automaticamente.`,
  };
}

export const panelNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(PANEL_NOTIFICATION_KINDS),
  protocol: z.string(),
  text: z.string(),
  occurrenceId: z.uuid(),
  workOrderId: z.uuid().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type PanelNotification = z.infer<typeof panelNotificationSchema>;

export const panelNotificationsResponseSchema = z.object({
  items: z.array(panelNotificationSchema),
  unreadCount: z.number().int().min(0),
});
export type PanelNotificationsResponse = z.infer<typeof panelNotificationsResponseSchema>;
