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
