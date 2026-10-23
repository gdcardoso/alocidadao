import type { LocateResponse } from '@alocidadao/shared';
import { apiErrorCode, apiErrorMessage } from '../auth/login-flow';
import type { OutboxStatus } from '../offline/outbox';

// Regras do Perfil e do chip de cidade, sem nada nativo (testável em Node).

/** Aviso do "Sair da conta" quando há envios na fila (decisões do plano). */
export function signOutWarning(count: number): string {
  const uploads = count === 1 ? 'envio' : 'envios';
  return `Você tem ${count} ${uploads} aguardando internet. Se sair agora, eles serão apagados.`;
}

/** Itens da fila que ainda vão ser enviados (de qualquer tipo). */
export function pendingCount(items: readonly { status: OutboxStatus }[]): number {
  return items.filter((item) => item.status === 'pending' || item.status === 'sending').length;
}

/** Erro da troca de número; o número de outra conta não pede para "entrar de novo". */
export function phoneChangeErrorMessage(error: unknown): string {
  if (apiErrorCode(error) === 'phone_in_use') return 'Este número já está em outra conta.';
  return apiErrorMessage(error);
}

/** Cidade do chip "Você está em": a da prefeitura ou a do município sem prefeitura. */
export function cityFromLocate(locate: LocateResponse): string | null {
  if (locate.status === 'served') return locate.tenant.city;
  return locate.municipality?.name ?? null;
}
