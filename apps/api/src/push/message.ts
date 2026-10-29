import { notificationText, PUSH_TITLE, type NotificationKind } from '@alocidadao/shared';
import type { PushMessage } from './types.js';

/**
 * O push leva só o título, o protocolo e o texto do tipo. Os dados escondidos são o tipo, a
 * prefeitura e o id da solicitação (cidadão) ou da atividade (agente): nada de nome, endereço
 * ou descrição.
 */
export function notificationPushMessage(
  kind: NotificationKind,
  protocol: string,
  data: { tenantId: string; requestId?: string; workOrderId?: string },
  details?: { withPhotos?: boolean },
): PushMessage {
  const hidden: Record<string, string> = { kind, tenantId: data.tenantId };
  if (data.requestId) hidden.requestId = data.requestId;
  if (data.workOrderId) hidden.workOrderId = data.workOrderId;
  return { title: PUSH_TITLE, body: notificationText(kind, protocol, details), data: hidden };
}
