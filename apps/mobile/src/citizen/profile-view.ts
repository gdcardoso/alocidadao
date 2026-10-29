import type { LocateResponse } from '@alocidadao/shared';
import { apiErrorCode, apiErrorMessage } from '../auth/login-flow';
import type { OutboxStatus } from '../offline/outbox';

// Regras do Perfil e do chip de cidade, sem nada nativo (testável em Node).

/** Aviso do "Sair da conta" quando há envios na fila (decisões do plano). */
export function signOutWarning(count: number): string {
  if (count === 1) return 'Você tem 1 envio aguardando internet. Se sair agora, ele será apagado.';
  return `Você tem ${count} envios aguardando internet. Se sair agora, eles serão apagados.`;
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

/** Erro do "Excluir minha conta"; o último Admin da equipe precisa passar o papel antes. */
export function deleteAccountErrorMessage(error: unknown): string {
  if (apiErrorCode(error) === 'last_platform_admin') {
    return 'Você é o último Admin da equipe Alô Cidadão. Passe o papel a outra pessoa antes de excluir a conta.';
  }
  return apiErrorMessage(error);
}

/** Cidade do chip "Você está em": a da prefeitura ou a do município sem prefeitura. */
export function cityFromLocate(locate: LocateResponse): string | null {
  if (locate.status === 'served') return locate.tenant.city;
  return locate.municipality?.name ?? null;
}
