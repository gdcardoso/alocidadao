import { errorCode } from '../../occurrence/use-occurrence-actions';
import { generalErrorMessage } from '../../teams/team-errors';

/** Recusas da API da equipe (troca de papel, remoção e edição) em texto. */
export function staffErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'last_platform_admin':
      return 'A equipe precisa de ao menos um Admin. Passe o papel de Admin a outra pessoa antes.';
    case 'self_change_not_allowed':
      return 'Você não pode trocar o próprio papel nem se remover da equipe.';
    case 'staff_not_found':
      return 'Esta pessoa não está mais na equipe.';
    default:
      return generalErrorMessage(error);
  }
}
