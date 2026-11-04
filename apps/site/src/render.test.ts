import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY, TERMS_OF_USE, type LegalDocument } from '@alocidadao/shared';
import { renderHome, renderLegalPage } from './render.js';

describe('renderLegalPage', () => {
  const html = renderLegalPage(TERMS_OF_USE);

  it('has title, language, notice and version', () => {
    expect(html).toContain('<title>Termos de Uso · Alô Cidadão</title>');
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain(TERMS_OF_USE.notice);
    expect(html).toContain(TERMS_OF_USE.version);
    expect(html).toContain('href="/"');
  });

  it('renders every heading as h2', () => {
    for (const html2 of [html, renderLegalPage(PRIVACY_POLICY)]) {
      expect(html2).toContain('<h2>');
    }
    for (const section of TERMS_OF_USE.sections) {
      expect(html).toContain(`<h2>${section.heading.replace(/&/g, '&amp;')}</h2>`);
    }
  });

  it('escapes < and & in the text', () => {
    const doc: LegalDocument = {
      ...TERMS_OF_USE,
      sections: [
        {
          heading: 'A & B',
          blocks: [
            { kind: 'paragraph', text: '1 < 2 & <b>x</b>' },
            { kind: 'list', items: ['<i>y</i>'] },
          ],
        },
      ],
    };
    const out = renderLegalPage(doc);
    expect(out).toContain('1 &lt; 2 &amp; &lt;b&gt;x&lt;/b&gt;');
    expect(out).toContain('<h2>A &amp; B</h2>');
    expect(out).toContain('<li>&lt;i&gt;y&lt;/i&gt;</li>');
    expect(out).not.toContain('<b>x</b>');
  });
});

describe('renderHome', () => {
  it('links to terms, privacy and the panel', () => {
    const html = renderHome();
    expect(html).toContain('href="/termos"');
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain('href="https://portal.alocidadao.com.br"');
  });
});
