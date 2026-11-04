# Página de apresentação — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a raiz do `apps/site` pela página de apresentação do mockup v2 (gestor de prefeitura e cidadão), com capturas reais do sistema e o contato (WhatsApp, e-mail, frase de prazo) editável no backoffice e lido pelo site em tempo real.

**Architecture:**

- **Contato num registro único** (`site_contact`, uma linha), lido por uma rota pública sem login e alterado só pelo Admin da equipe numa rota do backoffice, com auditoria.
- **Site continua estático:** `renderHome(contact)` gera o HTML com o contato do build; um script pequeno no HTML busca a rota pública ao abrir e troca os valores. Sem API, ficam os do build.
- **Capturas por script:** Playwright fotografa o painel rodando com o seed de Goiânia; as imagens são commitadas em `apps/site/public/img/`.

**Tech Stack:** o mesmo do monorepo. `apps/site` ganha `@fontsource/lexend` e `@fontsource/source-sans-3` (mesmas versões do `apps/web`) para hospedar as fontes. Capturas com `playwright` (já usado no ambiente; entra como devDependency só do `apps/site`, na versão já presente no monorepo ou na mais recente estável).

**Spec:** `docs/superpowers/specs/2026-11-04-pagina-de-apresentacao-design.md`, aprovado em 04/11/2026. Mockup: `docs/superpowers/specs/landing/mockup-v2.html` (+ `mockup-v2.jpg`).

## Decisões deste plano (além do spec)

- **Dados do contato** (`packages/shared/src/site.ts`):
  - `siteContactSchema = z.object({ whatsapp: phoneSchema, email: z.email().transform(toLowerCase), responseNote: z.string().trim().min(1).max(60) })`
  - `DEFAULT_SITE_CONTACT = { whatsapp: '+5562982089667', email: 'gdcardoso@gmail.com', responseNote: 'Resposta no mesmo dia' }`
  - `formatWhatsapp('+5562982089667') === '(62) 98208-9667'`; `whatsappLink('+5562982089667') === 'https://wa.me/5562982089667'`.
- **Banco:** tabela `site_contact (id smallint primary key default 1 check (id = 1), whatsapp text not null, email text not null, response_note text not null, updated_at timestamptz not null default now(), updated_by uuid null references users)`. RLS: `SELECT` para `app_user` com `USING (true)`; `UPDATE` só com `app_is_platform_admin()`; sem `INSERT`/`DELETE` para `app_user`. A migração SQL insere a linha com `DEFAULT_SITE_CONTACT`.
- **Rotas:**
  - `GET /public/site-contact` → `200 SiteContact`, sem login, com `Access-Control-Allow-Origin: *` (só esta rota; o CORS das outras continua `CORS_ORIGIN`).
  - `GET /backoffice/site-contact` e `PUT /backoffice/site-contact` (corpo `SiteContact`) → só Admin (`requirePlatformStaff(..., ['admin'])`), como a P6. O `PUT` grava `updated_by` e chama `insertStaffAudit` com `tenantId: null`, ação `site.contact_update`, rótulo "Alterou o contato do site". `STAFF_AUDIT_ACTIONS` passa de 40 para 41.
- **api-client:** `publicSiteContact(): Promise<SiteContact>`, `backofficeSiteContact(): Promise<SiteContact>`, `backofficeUpdateSiteContact(body: SiteContact): Promise<SiteContact>`.
- **Backoffice:** item de menu "Site" (`/backoffice/site`, ícone `Globe` do lucide, `adminOnly: true`), página "Site" com o bloco "Contato da página de apresentação", campos "WhatsApp", "E-mail", "Frase de prazo de resposta" (ajuda: "Aparece embaixo do WhatsApp. Ex.: Resposta no mesmo dia."), botão "Salvar", aviso "Contato salvo.".
- **Site:**
  - `SITE_API_URL` (build): sem ela, ou se a busca no build falhar/demorar mais de 3 s, o build usa `DEFAULT_SITE_CONTACT` e escreve no terminal `Aviso: contato do site com os valores iniciais (API indisponível).`
  - No HTML, os pontos de contato têm `data-contact="whatsapp-link" | "whatsapp-label" | "response-note" | "email-link" | "email-label"`; o script inline busca `${SITE_API_URL}/public/site-contact` com tempo-limite de 3 s e só troca os valores se a resposta passar no `siteContactSchema` (validação simples no script, sem Zod: os três campos string e o WhatsApp no formato `+55…`).
  - Fontes: arquivos `woff2` dos pacotes `@fontsource` copiados para `dist/fonts/` no build, com `@font-face` e `font-display: swap`. Nenhuma requisição a terceiros.
  - Imagens em `apps/site/public/img/` (copiadas para `dist/img/` no build): `painel-mapa.webp`, `agente-concluir.webp`, `cidadao-lista.webp`, `cidadao-concluida.webp`, `simbolo.png`. Fotos de banco em `apps/site/public/img/fotos/` com `CREDITOS.md` (origem, autor, licença e link de cada foto).
  - Links: "Entrar no painel" → `https://portal.alocidadao.com.br/entrar`.
- **Capturas do app (cidadão e agente):** o app não roda na web (sem `react-native-web`). O script `apps/site/scripts/capture-app.sh` usa `xcrun simctl io booted screenshot` com o simulador iOS ligado; quando não houver simulador, as duas telas do cidadão ficam como no mockup (desenhadas em HTML) e a do agente usa a captura do Pencil `docs/superpowers/specs/telas-agente/A3-concluir-atendimento.png`. **O executor não precisa de simulador**; deixa o script pronto e a página funcionando com o substituto.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4, pnpm 9. Dependências novas só as do Tech Stack acima, e só no `apps/site`.
- Código em inglês; textos em português copiados do spec, do mockup v2 e das Decisões sem mudar o sentido. Comentários em português. Testes em inglês, exceto `packages/db` (português).
- Fidelidade ao mockup v2: cores `#0057B8`, `#009E60`, `#F2C300`, `#F5F7FA`, `#062a5c`; Lexend nos títulos, Source Sans 3 no texto; ícones SVG estilo Lucide; sem emoji.
- Acessibilidade: contraste 4,5:1, foco visível, `alt` nas imagens, `prefers-reduced-motion` desliga as animações, sem rolagem horizontal em 375 / 768 / 1024 / 1440.
- Isolamento (decisão 0001): RLS na tabela nova; não editar migrações 0000–0043.
- Erros da API `{ code }` em snake_case; toda rota declara schema de resposta.
- Commits: mensagem curta em português terminando com uma linha em branco e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antes de cada commit: `pnpm lint`, `pnpm format:check`, testes e typecheck dos pacotes tocados.

## Review Focus

1. **API fora do ar ou lenta ao abrir a página:** os cartões continuam com o contato do build e nada quebra (sem erro no console visível ao usuário, sem cartão vazio). Teste na Task 3.
2. **Resposta da rota pública com formato estranho** (campo faltando, HTML no texto): o script não troca os valores e o texto nunca é inserido como HTML. Teste na Task 3.
3. **Suporte (não Admin) tentando salvar o contato:** 403 na API e o item "Site" não aparece no menu. Teste nas Tasks 1 e 2.
4. **Origem da página no CORS:** a rota pública responde `*` mesmo com `CORS_ORIGIN` restrito ao painel, e as outras rotas não. Teste na Task 1.
5. **Celular de 375 px:** topo, celulares inclinados e a grade de blocos sem rolagem horizontal. Conferido na Task 5 com Playwright em 375 px.

---

### Task 1: Contato do site no banco e na API

**Files:**

- Create: `packages/shared/src/site.ts` (+ export no `index.ts`), `packages/shared/src/site.test.ts`
- Modify: `packages/shared/src/backoffice.ts` (ação e rótulo; teste de tamanho → 41)
- Modify: `packages/db/src/schema.ts`; Create: migração estrutural `0044_*` (`drizzle-kit generate`) e `0045_site_contact.sql` (`--custom`: RLS, grants, linha inicial); Test: `packages/db/src/site-contact.test.ts`
- Create: `apps/api/src/site/routes.ts` (+ `.test.ts`); Modify: `apps/api/src/app.ts` (registrar)
- Modify: `packages/api-client/src/index.ts` (+ teste)

**Interfaces:**

- Produces: `SiteContact`, `siteContactSchema`, `DEFAULT_SITE_CONTACT`, `formatWhatsapp(e164: string): string`, `whatsappLink(e164: string): string` (shared); rotas e métodos do api-client das Decisões.

- [ ] **Step 1: Testes**
  - shared: `formatWhatsapp`/`whatsappLink` com os valores das Decisões; `siteContactSchema` recusa WhatsApp fixo (`+556232221234`), e-mail inválido, frase vazia e frase com 61 caracteres; aceita `DEFAULT_SITE_CONTACT`.
  - db: "app_user lê o contato sem contexto"; "admin da plataforma altera"; "suporte não altera"; "gestor de prefeitura não altera"; "não dá para inserir segunda linha"; "linha inicial tem os valores de teste".
  - api: `GET /public/site-contact` sem token → 200 com `DEFAULT_SITE_CONTACT` e header `access-control-allow-origin: *` com `buildApp({ corsOrigin: 'https://portal.alocidadao.com.br' })` e `Origin: https://alocidadao.com.br`; nessa mesma app, `GET /health` com essa origem **não** devolve `*` (Review Focus 4). `PUT /backoffice/site-contact` como Admin → 200, grava, e a auditoria tem `site.contact_update` com `tenantId` nulo; como Suporte → 403 (Review Focus 3); corpo inválido → 400; depois do PUT, `GET /public/site-contact` devolve o novo valor.
- [ ] **Step 2:** rodar os testes focados → FAIL.
- [ ] **Step 3:** implementar (schema + `drizzle-kit generate` + `--custom`; rotas; api-client).
- [ ] **Step 4:** `pnpm db:migrate`; testes de shared, db, api e api-client → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** "Contato do site no banco e na API".

### Task 2: Tela "Site" no backoffice

**Files:**

- Modify: `apps/web/src/backoffice/backoffice-menu.ts`, `apps/web/src/App.tsx` (rota `/backoffice/site`)
- Create: `apps/web/src/backoffice/site/SitePage.tsx` (+ `.module.css` se precisar, + `SitePage.test.tsx`)

**Interfaces:**

- Consumes: Task 1 (`backofficeSiteContact`, `backofficeUpdateSiteContact`, `siteContactSchema`, `formatWhatsapp`).

- [ ] **Step 1: Testes:** menu mostra "Site" só para `platformRole === 'admin'` (Suporte não vê); a página carrega os valores e mostra o WhatsApp formatado `(62) 98208-9667`; salvar envia `{ whatsapp: '+55…', email, responseNote }` (o campo aceita digitar `(62) 98208-9667` e converte para E.164, como o cadastro de agente faz com o celular); sucesso mostra "Contato salvo."; erro de validação aparece embaixo do campo.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test -- site` → FAIL.
- [ ] **Step 3:** implementar com os componentes de `apps/web/src/ui/*`, no layout das outras páginas do backoffice (ex.: `StaffPage`).
- [ ] **Step 4:** testes e typecheck do web → PASS.
- [ ] **Step 5: Commit** "Backoffice: contato do site".

### Task 3: Página de apresentação no site

**Files:**

- Modify: `apps/site/src/render.ts` (`renderHome(contact: SiteContact): string`; `renderLegalPage` passa a usar as fontes locais), `apps/site/src/build.ts`, `apps/site/src/styles.css` (ou `home.css` separado), `apps/site/package.json`
- Create: `apps/site/src/contact-script.ts` (exporta o texto do script inline), `apps/site/src/load-contact.ts` (`loadBuildContact(apiUrl: string | undefined, fetchFn?): Promise<SiteContact>`), `apps/site/public/img/simbolo.png` (cópia de `apps/web/src/assets/simbolo.png`)
- Test: `apps/site/src/render.test.ts`, `apps/site/src/load-contact.test.ts`, `apps/site/src/contact-script.test.ts`

**Interfaces:**

- Consumes: Task 1 (`SiteContact`, `DEFAULT_SITE_CONTACT`, `formatWhatsapp`, `whatsappLink`).
- Produces: `renderHome(contact)`; a página referencia `/img/painel-mapa.webp`, `/img/agente-concluir.webp`, `/img/cidadao-lista.webp`, `/img/cidadao-concluida.webp` (a Task 4 gera; até lá, usar as cópias provisórias descritas nas Decisões, com os mesmos nomes).

- [ ] **Step 1: Testes:**
  - `renderHome(DEFAULT_SITE_CONTACT)`: contém o título "Conexão que", "transforma", "sua cidade."; as seções `id="como"`, `id="cidadao"`, `id="prefeitura"`, `id="contato"`; `href="https://wa.me/5562982089667"`, `(62) 98208-9667`, `mailto:gdcardoso@gmail.com`, "Resposta no mesmo dia"; os cinco `data-contact`; `https://portal.alocidadao.com.br/entrar`; links `/termos` e `/privacidade`; nenhuma ocorrência de `fonts.googleapis.com`; toda `<img>` com `alt`, `width` e `height`; nenhum emoji.
  - Escape: contato com `<script>` na frase sai escapado.
  - `loadBuildContact(undefined)` → `DEFAULT_SITE_CONTACT` e o aviso no console; com `fetchFn` que demora 4 s → defaults; que devolve JSON válido → o JSON; inválido → defaults.
  - Script inline (rodado num DOM de teste, ex. `happy-dom` se já houver no monorepo, senão `jsdom` do web): resposta válida troca os cinco pontos; resposta com campo faltando não troca nada (Review Focus 2); rede falha → nada muda e nada é lançado (Review Focus 1); texto com `<b>` aparece como texto (usa `textContent`).
- [ ] **Step 2:** `pnpm --filter @alocidadao/site test` → FAIL.
- [ ] **Step 3: Implementar** a página fiel ao mockup v2 (estrutura, textos, efeitos, responsivo e `prefers-reduced-motion` como no `mockup-v2.html`), trocando `/files/*` pelos caminhos `/img/*`, as telas do cidadão pelas imagens (ou, sem captura, os celulares desenhados do mockup), e o Google Fonts pelas fontes locais. `build.ts` copia `public/` e as fontes para `dist/`.
- [ ] **Step 4:** testes → PASS; `pnpm --filter @alocidadao/site build` gera `dist/index.html`, `dist/img/*`, `dist/fonts/*`, `dist/termos/index.html`, `dist/privacidade/index.html`; typecheck, lint e format.
- [ ] **Step 5: Commit** "Site: página de apresentação".

### Task 4: Capturas do sistema e fotos de banco

**Files:**

- Create: `apps/site/scripts/capture-panel.ts` (Playwright), `apps/site/scripts/capture-app.sh`, `apps/site/scripts/demo-scenario.ts` (prepara uma solicitação concluída com foto no ambiente local, pelas rotas da API e as rotas `/dev/*` que já existem), `apps/site/public/img/fotos/*` + `CREDITOS.md`, `apps/site/README.md` (como rodar)
- Modify: `apps/site/package.json` (scripts `capture:panel`, `capture:app`, `demo:scenario`), `apps/site/public/img/*.webp`

**Interfaces:**

- Consumes: Task 3 (nomes das imagens).

- [ ] **Step 1:** escolher 2 a 4 fotos de banco gratuito com licença de uso comercial sem atribuição obrigatória (ex.: Unsplash ou Pexels) de serviço urbano (asfalto tapado, poste/iluminação), baixar, otimizar e registrar origem, autor, licença e link em `CREDITOS.md`.
- [ ] **Step 2:** `demo-scenario.ts`: com API local (seed de Goiânia), cria pelo fluxo normal uma solicitação de cidadão com foto "antes", atribui, conclui como agente com foto "depois" (usando o que as rotas `/dev/*` já permitem) e deixa pronta para a captura. Não altera `packages/db/src/seed-dev-data.ts`.
- [ ] **Step 3:** `capture-panel.ts`: entra como gestor do seed (código fixo de desenvolvimento), passa pelo aceite dos termos se aparecer, abre o mapa de Goiânia a 1440×900 e grava `painel-mapa.webp` (sem faixa de modo suporte, sem dado pessoal real).
- [ ] **Step 4:** `capture-app.sh`: com simulador iOS ligado, grava as três telas do app com `xcrun simctl io booted screenshot` e converte para WebP; sem simulador, sai com mensagem explicando o passo manual. Sem simulador neste ambiente, manter os substitutos das Decisões.
- [ ] **Step 5:** rodar `demo:scenario` e `capture:panel` com o sistema local; conferir a imagem; `pnpm --filter @alocidadao/site build`.
- [ ] **Step 6: Commit** "Site: capturas do painel e fotos de banco".

### Task 5: Verificação final

- [ ] **Step 1:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` → tudo verde.
- [ ] **Step 2:** com o sistema local: alterar o contato na tela "Site" do backoffice como Admin; abrir o site (`vite preview`) com `SITE_API_URL` apontando para a API local e ver o contato novo; parar a API e recarregar o site: o contato do build continua aparecendo.
- [ ] **Step 3:** capturas da página em 1440 e 375 px com Playwright (sem rolagem horizontal; Review Focus 5) para mostrar ao usuário.
- [ ] **Step 4:** atualizar `docs/planejamento-mvp.md` (página de apresentação feita; antes do lançamento: trocar o contato de teste, trocar fotos de banco por reais, capturas do app no simulador) e commitar.
