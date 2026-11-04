import { PRIVACY_POLICY } from './privacy.js';
import { TERMS_OF_USE } from './terms.js';
import type { LegalDocument } from './types.js';

export type { LegalBlock, LegalDocument, LegalSection } from './types.js';
export { PRIVACY_POLICY, TERMS_OF_USE };

/** Os dois documentos pelo endereço que usam no app, no painel e no site. */
export const LEGAL_DOCUMENTS: Record<LegalDocument['slug'], LegalDocument> = {
  termos: TERMS_OF_USE,
  privacidade: PRIVACY_POLICY,
};
