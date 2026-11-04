import type { MeResponse } from '@alocidadao/shared';

/** Só bloqueia com `me` em mãos e aceite pendente: sem rede (`me` nulo) o app segue aberto. */
export function needsTermsAcceptance(me: MeResponse | null): boolean {
  return me?.termsAccepted === false;
}

/** Corpo de resposta 403 `terms_required`: a conta ainda não aceitou os Termos. */
export function isTermsRequiredBody(body: unknown): boolean {
  return (body as { code?: unknown } | null)?.code === 'terms_required';
}
