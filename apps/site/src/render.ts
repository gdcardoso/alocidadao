import {
  formatWhatsapp,
  whatsappLink,
  type LegalDocument,
  type SiteContact,
} from '@alocidadao/shared';
import { contactScript } from './contact-script.js';

const NAME = 'Alô Cidadão';
const PANEL_LOGIN_URL = 'https://portal.alocidadao.com.br/entrar';

/** Escapa texto para HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Moldura comum das páginas legais: cabeçalho com a marca, conteúdo e rodapé. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/img/simbolo.png" type="image/png">
<link rel="stylesheet" href="/fonts.css">
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

/** Imagem estática do site, com tamanho declarado para não pular o layout. */
interface SiteImage {
  src: string;
  width: number;
  height: number;
  alt: string;
}

const PANEL_MAP: Omit<SiteImage, 'alt'> = {
  src: '/img/painel-mapa.webp',
  width: 2160,
  height: 1350,
};
const AGENT_FINISH: SiteImage = {
  src: '/img/agente-concluir.webp',
  width: 780,
  height: 1436,
  alt: 'App do agente concluindo um atendimento',
};
/** Foto de banco (ver scripts/fixtures/CREDITOS.md) na tela desenhada do serviço concluído. */
const SERVICE_PHOTO: SiteImage = {
  src: '/img/fotos/iluminacao-poste.webp',
  width: 600,
  height: 900,
  alt: '',
};
/**
 * Telas do app do cidadão. Enquanto não há captura, os celulares são desenhados em HTML (como no
 * mockup); quando a captura existir, basta trocar `null` pela imagem, por exemplo
 * `{ src: '/img/cidadao-lista.webp', width: 780, height: 1688, alt: '…' }`.
 */
const CITIZEN_LIST: SiteImage | null = null;
const CITIZEN_DONE: SiteImage | null = null;

function img(image: SiteImage, extra = ''): string {
  return `<img src="${image.src}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}"${extra}>`;
}

/** Ícone SVG no estilo Lucide (traço, sem preenchimento). */
function icon(paths: string, size = 28, stroke = 'currentColor', width = 2): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const ICON = {
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  mapPin:
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  circleCheck: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  clock: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  map: '<path d="M14.1 6 9.9 4 3 7v13l6.9-3 4.2 2L21 16V3z"/><path d="M9.9 4v13M14.1 6v13"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
};

const STEPS = [
  {
    n: '01',
    tone: 'blue',
    icon: ICON.camera,
    title: 'O cidadão avisa',
    text: 'Tira a foto, o app marca o local e ele escolhe a categoria. Leva menos de um minuto.',
  },
  {
    n: '02',
    tone: 'yellow',
    icon: ICON.mapPin,
    title: 'A prefeitura organiza',
    text: 'O pedido aparece no mapa, relatos repetidos viram um só e a equipe certa recebe com prazo.',
  },
  {
    n: '03',
    tone: 'green',
    icon: ICON.circleCheck,
    title: 'A equipe resolve',
    text: 'O agente registra o serviço com foto e o cidadão recebe o aviso para conferir.',
  },
];

const BENEFITS = [
  {
    tone: 'blue',
    icon: ICON.message,
    title: 'Canal direto com a sua cidade',
    text: 'O pedido vai para quem resolve, sem intermediário.',
  },
  {
    tone: 'yellow',
    icon: ICON.clock,
    title: 'Acompanhe cada passo',
    text: 'Protocolo, situação e prazo na palma da mão.',
  },
  {
    tone: 'green',
    icon: ICON.image,
    title: 'Veja a foto do serviço feito',
    text: 'Quando termina, você recebe o aviso e confere com os próprios olhos.',
  },
];

/** Tela "Minhas solicitações" do app do cidadão (desenho ou captura). */
function citizenListScreen(): string {
  if (CITIZEN_LIST) return img(CITIZEN_LIST, ' loading="lazy"');
  const card = (tag: string, tone: string, title: string, detail: string) =>
    `<div class="card"><span class="tag tag-${tone}">${tag}</span><div class="card-body"><b>${title}</b><br><small>${detail}</small></div></div>`;
  return `<div class="ph" role="img" aria-label="App do cidadão com a lista de solicitações">
<b class="lex ph-title">Minhas solicitações</b>
${card('Em atendimento', 'blue', 'Buraco na via', 'Av. T-63 · prazo 12/11')}
${card('Concluída', 'green', 'Lâmpada queimada', 'Rua 9 · confira a foto')}
${card('Recebida', 'gray', 'Lixo na calçada', 'Setor Oeste')}
</div>`;
}

/** Tela "Serviço concluído" do app do cidadão (desenho ou captura). */
function citizenDoneScreen(): string {
  if (CITIZEN_DONE) return img(CITIZEN_DONE, ' loading="lazy"');
  return `<div class="ph ph-done" role="img" aria-label="App do cidadão com um serviço concluído e a foto">
<b class="lex ph-title">Serviço concluído</b>
<div class="ph-photo">${img(SERVICE_PHOTO, ' loading="lazy"')}</div>
<div class="card"><b>Lâmpada queimada</b><br><small>Resolvido pela equipe de Iluminação</small></div>
<div class="ph-confirm">Confirmar</div>
</div>`;
}

export interface RenderHomeOptions {
  /** Endereço da API (`SITE_API_URL`); com ele, a página atualiza o contato ao abrir. */
  apiUrl?: string;
}

/** Página de apresentação (alocidadao.com.br), com o contato gravado no build. */
export function renderHome(contact: SiteContact, options: RenderHomeOptions = {}): string {
  const waHref = escapeHtml(whatsappLink(contact.whatsapp));
  const waLabel = escapeHtml(formatWhatsapp(contact.whatsapp));
  const note = escapeHtml(contact.responseNote);
  const email = escapeHtml(contact.email);
  const script = options.apiUrl ? `\n<script>\n${contactScript(options.apiUrl)}\n</script>` : '';

  const steps = STEPS.map(
    (step) => `<div class="step">
<span class="n" aria-hidden="true">${step.n}</span>
<div class="ico ico-${step.tone}">${icon(step.icon)}</div>
<h3>${step.title}</h3>
<p>${step.text}</p>
</div>`,
  ).join('\n');

  const benefits = BENEFITS.map(
    (benefit) => `<div class="benefit">
<div class="ico ico-${benefit.tone}">${icon(benefit.icon)}</div>
<div>
<h3>${benefit.title}</h3>
<p>${benefit.text}</p>
</div>
</div>`,
  ).join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME} · Conexão que transforma sua cidade</title>
<meta name="description" content="O morador avisa pelo celular. A prefeitura vê no mapa, manda a equipe certa e mostra a foto do serviço feito.">
<link rel="icon" href="/img/simbolo.png" type="image/png">
<link rel="preload" href="/fonts/lexend-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/home.css">
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<nav aria-label="Principal">
<div class="wrap">
<a class="brand" href="/"><img src="/img/simbolo.png" alt="" width="36" height="36">${NAME}</a>
<div class="links">
<a href="#como">Como funciona</a>
<a href="#cidadao">Para o cidadão</a>
<a href="#prefeitura">Para prefeituras</a>
<a href="${PANEL_LOGIN_URL}">Entrar no painel</a>
<a class="btn btn-green btn-sm" href="#contato">Fale com a gente</a>
</div>
</div>
</nav>

<header class="hero">
<div class="sun" aria-hidden="true"></div>
<div class="wrap">
<div>
<div class="pill"><i aria-hidden="true"></i>Você faz uma cidade melhor</div>
<h1>Conexão que <span>transforma</span> sua cidade.</h1>
<p class="lead">O morador avisa pelo celular. A prefeitura vê no mapa, manda a equipe certa e mostra a foto do serviço feito.</p>
<div class="cta-row">
<a class="btn btn-green" href="#prefeitura">Sou da prefeitura ${icon(ICON.arrowRight, 18, 'currentColor', 2.2)}</a>
<a class="btn btn-ghost" href="#cidadao">Sou cidadão</a>
</div>
<div class="trust">
<div><b>3 passos</b>do aviso à foto</div>
<div><b>1 mapa</b>com toda a cidade</div>
<div><b>0</b>ronda para achar problema</div>
</div>
</div>
<div class="stage">
<div class="laptop">${img({ ...PANEL_MAP, alt: 'Painel da prefeitura com o mapa de ocorrências' }, ' fetchpriority="high"')}</div>
<div class="phone">${img(AGENT_FINISH)}</div>
<div class="glass g1"><b><span class="dot dot-yellow"></span>Novo relato</b>Buraco na via · Setor Bueno</div>
<div class="glass g2"><b><span class="dot dot-green"></span>Concluído com foto</b>Iluminação · Jardim Goiás</div>
</div>
</div>
</header>
<svg class="wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<path d="M0 60 C 360 0 720 110 1440 30 L1440 90 L0 90Z" fill="#fff"/>
<path d="M0 70 C 400 20 760 100 1440 50" stroke="#f2c300" stroke-width="4" fill="none" opacity=".9"/>
<path d="M0 78 C 420 36 800 104 1440 62" stroke="#009e60" stroke-width="4" fill="none" opacity=".8"/>
</svg>

<main id="conteudo">
<section id="como">
<div class="wrap">
<div class="eyebrow">Como funciona</div>
<h2>Do aviso à solução, em três passos.</h2>
<p class="sub">Cada pedido vira um ponto no mapa, com dono, prazo e prova de que foi resolvido.</p>
<div class="steps">
${steps}
</div>
</div>
</section>

<section id="cidadao" class="cit">
<div class="wrap">
<div>
<div class="eyebrow">Para o cidadão</div>
<h2>Sua voz chega direto na prefeitura.</h2>
<p class="sub">Nada de ligar, esperar e repetir. Você avisa uma vez e acompanha até o fim.</p>
${benefits}
</div>
<div class="phones">
<div class="phone p1">${citizenListScreen()}</div>
<div class="phone p2">${citizenDoneScreen()}</div>
</div>
</div>
</section>

<section id="prefeitura" class="dark">
<div class="wrap">
<div class="eyebrow">Para prefeituras</div>
<p class="quote">O cidadão vira os <span>olhos da prefeitura</span> na rua. Você sabe onde está cada problema sem mandar ninguém procurar.</p>
<div class="bento">
<div class="b b1">
<div class="txt">
${icon(ICON.map, 26, '#f2c300')}
<h3>A cidade inteira em um mapa</h3>
<p>Cada relato vira um ponto, com a situação do prazo por cor e filtro por bairro.</p>
</div>
${img({ ...PANEL_MAP, alt: 'Mapa do painel com os pinos coloridos pela situação do prazo' }, ' loading="lazy"')}
</div>
<div class="b b2">
<div class="big">1</div>
<h3>relato, mesmo com 20 avisos</h3>
<p>Avisos parecidos no mesmo ponto viram uma ocorrência só.</p>
</div>
<div class="b b3">
${icon(ICON.users, 26, '#5fd3a0')}
<h3>Equipes no app do agente</h3>
<p>A tarefa chega no celular de quem vai à rua, até sem internet.</p>
</div>
<div class="b b4">
${icon(ICON.clock, 26, '#f2c300')}
<h3>Prazo à vista</h3>
<p>No prazo, vencendo e atrasado, em tempo real.</p>
<span class="chip"><span class="dot dot-green"></span>No prazo</span><span class="chip"><span class="dot dot-yellow"></span>Vencendo</span><span class="chip"><span class="dot dot-red"></span>Atrasada</span>
</div>
<div class="b b5">
${icon(ICON.image, 26, '#5fd3a0')}
<h3>Prova com foto</h3>
<p>Todo serviço termina com a foto do agente, e o gestor revisa antes de fechar.</p>
</div>
<div class="b b6">
${icon(ICON.shield, 26, '#f2c300')}
<h3>Dados protegidos</h3>
<p>Acesso por código, sem senha, e LGPD desde o primeiro dia.</p>
</div>
</div>
</div>
</section>

<section class="cta" id="contato">
<div class="wrap">
<div class="ctabox">
<div class="cta-text">
<h2>Quer o Alô Cidadão na sua cidade?</h2>
<p>Fale com a gente. Mostramos o sistema funcionando com os bairros da sua cidade.</p>
</div>
<div class="contact">
<a href="${waHref}" data-contact="whatsapp-link" target="_blank" rel="noopener">${icon(ICON.message)}<span>WhatsApp<small><span data-contact="whatsapp-label">${waLabel}</span> · <span data-contact="response-note">${note}</span></small></span></a>
<a href="mailto:${email}" data-contact="email-link">${icon(ICON.mail)}<span>E-mail<small data-contact="email-label">${email}</small></span></a>
</div>
</div>
</div>
</section>
</main>

<footer>
<div class="wrap">
<span>© ${NAME} · Você faz uma cidade melhor</span>
<span><a href="/termos">Termos de Uso</a> · <a href="/privacidade">Política de Privacidade</a> · <a href="${PANEL_LOGIN_URL}">Entrar no painel</a></span>
</div>
</footer>${script}
</body>
</html>
`;
}
