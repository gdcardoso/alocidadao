import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '../auth.js';
import { LEGAL_DOCUMENTS, PRIVACY_POLICY, TERMS_OF_USE } from './index.js';
import type { LegalDocument } from './types.js';

/** Todo o texto do documento, na ordem em que aparece. */
function allText(doc: LegalDocument): string {
  return [
    doc.title,
    doc.notice,
    ...doc.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === 'paragraph' ? [block.text] : block.items,
      ),
    ]),
  ].join('\n');
}

const documents = [TERMS_OF_USE, PRIVACY_POLICY];

describe('legal documents', () => {
  it('carry the current terms version', () => {
    for (const doc of documents) expect(doc.version).toBe(TERMS_VERSION);
  });

  it('identify themselves by slug and title', () => {
    expect(TERMS_OF_USE).toMatchObject({ slug: 'termos', title: 'Termos de Uso' });
    expect(PRIVACY_POLICY).toMatchObject({ slug: 'privacidade', title: 'Política de Privacidade' });
  });

  it('show the test-version notice', () => {
    for (const doc of documents) {
      expect(doc.notice).toBe(
        'Versão de testes. Este texto é um modelo e será substituído pela versão revisada pelo jurídico antes do uso em produção.',
      );
    }
  });

  it('privacy policy lists the device details', () => {
    const text = allText(PRIVACY_POLICY);
    for (const term of ['fabricante', 'modelo', 'versão do sistema', 'navegador']) {
      expect(text).toContain(term);
    }
  });

  it('never mention a password', () => {
    for (const doc of documents) expect(allText(doc)).not.toMatch(/senha/i);
  });

  it('frame the privacy policy as notice, not consent', () => {
    expect(allText(PRIVACY_POLICY)).not.toMatch(/concordo|consentimento para o tratamento/i);
  });

  it('cite the LGPD articles in the privacy policy', () => {
    const text = allText(PRIVACY_POLICY);
    expect(text).toContain('art. 7º, III');
    expect(text).toContain('art. 23');
    expect(text).toContain('art. 18');
  });

  it('mark the points that depend on the company or the legal team', () => {
    for (const doc of documents) expect(allText(doc)).toContain('[A DEFINIR');
  });

  it('have no empty section, paragraph or list', () => {
    for (const doc of documents) {
      expect(doc.sections.length).toBeGreaterThan(0);
      for (const section of doc.sections) {
        expect(section.heading.trim()).not.toBe('');
        expect(section.blocks.length).toBeGreaterThan(0);
        for (const block of section.blocks) {
          if (block.kind === 'paragraph') expect(block.text.trim()).not.toBe('');
          else expect(block.items.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('index both documents by slug', () => {
    expect(LEGAL_DOCUMENTS.termos).toBe(TERMS_OF_USE);
    expect(LEGAL_DOCUMENTS.privacidade).toBe(PRIVACY_POLICY);
  });
});
