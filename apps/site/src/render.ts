import type { LegalDocument } from '@alocidadao/shared';

const NAME = 'Alô Cidadão';
const PANEL_URL = 'https://portal.alocidadao.com.br';

/** Escapa texto para HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Moldura comum das páginas: cabeçalho com a marca, conteúdo e rodapé. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header><a class="brand" href="/">${NAME}</a></header>
<main>
${body}
</main>
<footer><p>${NAME}</p></footer>
</body>
</html>
`;
}

/** Página de um documento legal (Termos de Uso ou Política de Privacidade). */
export function renderLegalPage(doc: LegalDocument): string {
  const sections = doc.sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) =>
          block.kind === 'paragraph'
            ? `<p>${escapeHtml(block.text)}</p>`
            : `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
        )
        .join('\n');
      return `<section>\n<h2>${escapeHtml(section.heading)}</h2>\n${blocks}\n</section>`;
    })
    .join('\n');
  const body = `<p><a href="/">&larr; Voltar ao início</a></p>
<h1>${escapeHtml(doc.title)}</h1>
<p class="notice">${escapeHtml(doc.notice)}</p>
<p class="meta">Versão ${escapeHtml(doc.version)}</p>
${sections}`;
  return layout(`${doc.title} · ${NAME}`, body);
}

/** Página inicial mínima, até a página de apresentação ficar pronta. */
export function renderHome(): string {
  const body = `<h1>${NAME}</h1>
<ul class="links">
<li><a href="/termos">Termos de Uso</a></li>
<li><a href="/privacidade">Política de Privacidade</a></li>
<li><a href="${PANEL_URL}">Painel da prefeitura</a></li>
</ul>`;
  return layout(NAME, body);
}
