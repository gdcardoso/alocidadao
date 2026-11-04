import { ApiError } from '@alocidadao/api-client';
import { errorCode } from '../occurrence/use-occurrence-actions';
import { apiErrorField, generalErrorMessage } from '../teams/team-errors';

/** Aviso depois de reenviar o convite. */
export const inviteSentMessage = (maskedEmail: string) => `Convite reenviado para ${maskedEmail}.`;

/** Mensagem do convite (cadastro, troca de e-mail ou reenvio) para um erro da API. */
export function inviteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    return typeof seconds === 'number'
      ? `Aguarde ${Math.max(1, Math.ceil(seconds))} s para reenviar o convite.`
      : 'Aguarde um instante para reenviar o convite.';
  }
  switch (errorCode(error)) {
    case 'email_missing':
      return 'Cadastre um e-mail para enviar o convite.';
    case 'email_mismatch':
      return `Esta pessoa já tem outro e-mail cadastrado (${apiErrorField(error, 'maskedEmail') ?? ''}). Use esse e-mail.`;
    case 'email_change_not_allowed':
      return 'O e-mail desta pessoa só pode ser trocado pelo suporte do Alô Cidadão.';
    case 'tenant_not_active':
      return 'O convite do agente é enviado quando a prefeitura for ativada.';
    case 'invite_not_allowed':
      return 'Esta conta não está ativa.';
    default:
      return generalErrorMessage(error);
  }
}
