import { REQUEST_STATUS_LABELS, type RequestStatus } from '@alocidadao/shared';
import type { PushMessage } from './types.js';

/** O push leva só o protocolo e o status: nada de nome, endereço ou descrição. */
export function statusPushMessage(protocol: string, status: RequestStatus): PushMessage {
  return {
    title: 'Alô Cidadão',
    body: `Solicitação ${protocol}: ${REQUEST_STATUS_LABELS[status]}`,
    data: { protocol, status },
  };
}
