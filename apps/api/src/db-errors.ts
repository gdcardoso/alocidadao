/** Restrição única de `photos.storage_key` (nome gerado pelo Drizzle). */
export const PHOTO_KEY_CONSTRAINT = 'photos_storage_key_unique';

/** Drizzle embrulha o erro do Postgres em `cause`; procura o código nos dois níveis. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/** Nome da restrição violada, procurado no erro e no `cause` do Drizzle. */
export function violatedConstraint(error: unknown): string | undefined {
  const e = error as { constraint?: string; cause?: { constraint?: string } };
  return e.constraint ?? e.cause?.constraint;
}

/** Restrições únicas traduzidas em erros da API (nomes dos índices da W6). */
export const PHONE_ACTIVE_CONSTRAINT = 'users_phone_active_idx';
export const TEAM_NAME_CONSTRAINT = 'teams_tenant_name_idx';

/** Erro do Postgres com este SQLSTATE e, se dada, esta mensagem (no erro ou no `cause`). */
export function isPgError(error: unknown, code: string, message?: string): boolean {
  const e = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const matches = (item: { code?: string; message?: string } | undefined) =>
    item?.code === code && (message === undefined || item.message?.includes(message) === true);
  return matches(e) || matches(e.cause);
}

/** Restrições do painel de administração (e-mail e CPF da conta, nomes de categoria e setor). */
export const USER_EMAIL_CONSTRAINT = 'users_email_lower_idx';
export const USER_CPF_CONSTRAINT = 'users_cpf_unique';
export const CATEGORY_NAME_CONSTRAINT = 'categories_tenant_id_name_unique';
export const DEPARTMENT_NAME_CONSTRAINT = 'departments_tenant_id_name_unique';
