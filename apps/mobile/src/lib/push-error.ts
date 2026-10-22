export type TokenErrorKind = 'push_not_configured' | 'token_failed';

/** Firebase sem google-services.json lança "Default FirebaseApp is not initialized...". */
export function classifyTokenError(error: unknown): TokenErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  return /FirebaseApp/i.test(message) ? 'push_not_configured' : 'token_failed';
}
