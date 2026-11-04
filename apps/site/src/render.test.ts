import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_CONTACT,
  PRIVACY_POLICY,
  TERMS_OF_USE,
  type LegalDocument,
} from '@alocidadao/shared';
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

  it('uses the self-hosted fonts', () => {
    expect(html).toContain('href="/fonts.css"');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
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
  const html = renderHome(DEFAULT_SITE_CONTACT);

  it('has the hero title and every section', () => {
    expect(html).toContain('Conexão que');
    expect(html).toContain('<span>transforma</span>');
    expect(html).toContain('sua cidade.');
    for (const id of ['como', 'cidadao', 'prefeitura', 'contato']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('renders the contact from the given values', () => {
    expect(html).toContain('href="https://wa.me/5562982089667"');
    expect(html).toContain('(62) 98208-9667');
    expect(html).toContain('href="mailto:gdcardoso@gmail.com"');
    expect(html).toContain('>gdcardoso@gmail.com<');
    expect(html).toContain('Resposta no mesmo dia');
    for (const point of [
      'whatsapp-link',
      'whatsapp-label',
      'response-note',
      'email-link',
      'email-label',
    ]) {
      expect(html).toContain(`data-contact="${point}"`);
    }
  });

  it('links to the panel and the legal pages', () => {
    expect(html).toContain('href="https://portal.alocidadao.com.br/entrar"');
    expect(html).toContain('href="/termos"');
    expect(html).toContain('href="/privacidade"');
  });

  it('makes no request to third parties for fonts', () => {
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(html).toContain('href="/fonts.css"');
  });

  it('declares alt, width and height on every image', () => {
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img).toMatch(/\salt="[^"]*"/);
      expect(img).toMatch(/\swidth="\d+"/);
      expect(img).toMatch(/\sheight="\d+"/);
    }
    expect(html).toContain('src="/img/painel-mapa.webp"');
    expect(html).toContain('src="/img/agente-concluir.webp"');
  });

  it('shows a stock service photo on the drawn "concluded" phone', () => {
    expect(html).toMatch(/<div class="ph-photo"><img src="\/img\/fotos\/iluminacao-poste\.webp"/);
  });

  it('has no emoji', () => {
    // © e ® são pictográficos no Unicode, mas não emoji
    expect(html).not.toMatch(/(?![©®])\p{Extended_Pictographic}/u);
    expect(html).not.toContain('\uFE0F');
  });

  it('escapes the contact values', () => {
    const out = renderHome({
      ...DEFAULT_SITE_CONTACT,
      responseNote: '<script>alert(1)</script>',
    });
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>alert(1)</script>');
  });

  it('includes the refresh script only when the API address is known', () => {
    expect(html).not.toContain('/public/site-contact');
    const withApi = renderHome(DEFAULT_SITE_CONTACT, { apiUrl: 'https://api.alocidadao.com.br' });
    expect(withApi).toContain('<script>');
    expect(withApi).toContain('https://api.alocidadao.com.br');
  });
});
