/** Um trecho de texto: parágrafo ou lista de itens. */
export type LegalBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/** Uma seção do documento, com título e trechos. */
export type LegalSection = { heading: string; blocks: LegalBlock[] };

/**
 * Termos de Uso ou Política de Privacidade. É a fonte única do texto: app, painel e site
 * mostram este mesmo conteúdo.
 */
export type LegalDocument = {
  slug: 'termos' | 'privacidade';
  title: string;
  /** Versão vigente, igual a `TERMS_VERSION`. */
  version: string;
  /** Aviso mostrado no topo enquanto o texto for modelo. */
  notice: string;
  sections: LegalSection[];
};

/** Aviso do topo enquanto o texto não passa pelo jurídico. */
export const LEGAL_NOTICE =
  'Versão de testes. Este texto é um modelo e será substituído pela versão revisada pelo jurídico antes do uso em produção.';

export function paragraph(text: string): LegalBlock {
  return { kind: 'paragraph', text };
}

export function list(...items: string[]): LegalBlock {
  return { kind: 'list', items };
}
