import { INCLUDED_USERS_MAX } from '@alocidadao/shared';

export const REQUIRED_TEXT = 'Preencha este campo.';
export const DISPLAY_NAME_TEXT = 'Informe o nome (2 a 120 caracteres).';

export type ContractFieldKey = 'includedPanelUsers' | 'startsOn' | 'endsOn';

/** Mensagem de erro de um campo do contrato, a partir de um problema do `contractTermsSchema`. */
export function contractIssueError(
  field: string,
  message: string,
): { key: ContractFieldKey; text: string } | null {
  if (field === 'endsOn') return { key: 'endsOn', text: message };
  if (field === 'includedPanelUsers') {
    return { key: 'includedPanelUsers', text: `Informe de 1 a ${INCLUDED_USERS_MAX}.` };
  }
  if (field === 'startsOn') return { key: 'startsOn', text: REQUIRED_TEXT };
  return null;
}
