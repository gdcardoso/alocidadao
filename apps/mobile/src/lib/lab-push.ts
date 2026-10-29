import type { NotificationKind } from '@alocidadao/shared';

/** Protocolo e tipo do push de teste do Laboratório ("Solicitação 2026-000123: em atendimento"). */
export const LAB_PUSH_PROTOCOL = '2026-000123';
const LAB_PUSH_KIND: NotificationKind = 'request_in_progress';

/** Corpo de `POST /dev/push` para o botão "Enviar teste" do Laboratório. */
export function labPushBody(platform: 'android' | 'ios', token: string) {
  return { platform, token, kind: LAB_PUSH_KIND, protocol: LAB_PUSH_PROTOCOL };
}
