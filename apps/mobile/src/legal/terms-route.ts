import { ApiError } from '@alocidadao/api-client';
import type { MeResponse } from '@alocidadao/shared';

/** Só bloqueia com `me` em mãos e aceite pendente: sem rede (`me` nulo) o app segue aberto. */
export function needsTermsAcceptance(me: MeResponse | null): boolean {
  return me?.termsAccepted === false;
}

/** A API recusou a chamada porque a conta ainda não aceitou os Termos (403 `terms_required`). */
export function isTermsRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body as { code?: string } | null)?.code === 'terms_required'
  );
}
