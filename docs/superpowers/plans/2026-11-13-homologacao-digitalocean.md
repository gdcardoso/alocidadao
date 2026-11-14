# Homologação na DigitalOcean (Plano 8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar a homologação (`develop`) no ar em `homolog.alocidadao.com.br` e o site em `alocidadao.com.br`, com publicação automática, rollback para a penúltima imagem, backups e APK Android por botão.

**Architecture:** Um Droplet com Docker Compose (Caddy na frente, API, Postgres + PostGIS, estáticos do painel e do site). GitHub Actions gera as imagens (ghcr.io, marcadas com o SHA), entra por SSH e roda `deploy.sh`, que faz backup no Spaces, migra e troca. Botões no GitHub para voltar versão, publicar o site e gerar o APK.

**Tech Stack:** Docker Compose, Caddy 2, GitHub Actions, ghcr.io, DigitalOcean (Droplet, Cloud Firewall, IP reservado, Spaces) via `doctl`, `pg_dump`/`pg_restore`, `s3cmd`/`aws` CLI, Expo prebuild + Gradle.

**Spec:** `docs/superpowers/specs/2026-11-13-homologacao-digitalocean-design.md`

## Global Constraints

- Branches: `develop` → homologação; `main` → produção (não existe ainda). Site publica a partir da `main`, por botão.
- Endereços: `alocidadao.com.br` (site), `www` → redireciona; `homolog.alocidadao.com.br` (painel/backoffice), `homolog.alocidadao.com.br/api/*` (API, prefixo retirado).
- Cookie de renovação: a API grava `Path=/auth/panel`; o proxy reescreve para `Path=/api/auth/panel`.
- API na homologação: `NODE_ENV=production`, `APP_ENV=homolog`, `PHONE_CODE_PROVIDER=log`, `PANEL_URL=https://homolog.alocidadao.com.br`, `CORS_ORIGIN=https://homolog.alocidadao.com.br`, `AGENT_APP_PLAY_URL=https://homolog.alocidadao.com.br/app/alocidadao-homolog.apk`, `TRUST_PROXY=true`, sem `ENABLE_DEV_ROUTES`, sem `AUTH_DEV_FIXED_CODE`.
- Código fixo: só nos fluxos do app pelo celular e só com `APP_ENV=homolog`; o painel e o backoffice nunca aceitam.
- Imagens: `ghcr.io/gdcardoso/alocidadao-{api,web,site,db}:<sha>`; manter as 2 versões mais recentes de cada.
- Backups: antes de cada migração (5 últimos) e diário (14 últimos), no Spaces, privados.
- Droplet Basic 2 GB, região `nyc3`, Ubuntu LTS, só chave SSH; firewall só 22/80/443; banco nunca exposto.
- Segredos da aplicação só no `/srv/alocidadao/.env` do servidor; nada no git.
- Conta GitHub: `gdcardoso` (SSH `github-pessoal`; `gh` com `GH_TOKEN=$(gh auth token --user gdcardoso)`). Nunca criar nada com `gabrielduofy`.
- DigitalOcean: só no time do projeto (token gerado dentro dele). Alerta de gasto US$ 30.
- Textos de interface e documentação em pt-BR.

## Review Focus

1. **Limite de login atrás do proxy:** sem `trustProxy`, todos os pedidos chegam com o IP do Caddy e o limite de 20/min em `/auth/*` vale para a equipe inteira junta. Esperado: o limite é por IP real do cliente (Task 1).
2. **Recarregar uma página interna do painel** (ex.: F5 em `/painel/mapa`): esperado o `index.html`, não 404. E `/api/rota-inexistente` responde o 404 JSON da API, não o `index.html` (Task 4).
3. **Renovação da sessão do painel pelo proxy:** o `Set-Cookie` precisa sair com `Path=/api/auth/panel`, senão a pessoa cai a cada 15 min (Task 4).
4. **Migração que falha na publicação:** os containers antigos continuam no ar e o SHA "no ar" não muda (Task 4).
5. **Backup que falha antes da migração** (credencial do Spaces errada, disco cheio): a publicação para antes de migrar (Task 4).

---

### Task 1: API pronta para rodar atrás do proxy e com código fixo do app na homologação

**Files:**

- Modify: `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/.env.example`
- Test: `apps/api/src/env.test.ts`, `apps/api/src/auth/app-routes.test.ts`, `apps/api/src/auth/panel-routes.test.ts` (ou o arquivo onde estiverem os testes de login do painel)

**Interfaces:**

- Produces: `ApiEnv.trustProxy: boolean`; `ApiEnv.auth.appFixedCode?: string`; `AuthOptions.appFixedCode?: string`; `AppOptions.trustProxy?: boolean`. Variáveis novas: `APP_ENV` (`homolog` é o único valor com efeito), `AUTH_APP_FIXED_CODE` (6 dígitos), `TRUST_PROXY` (`true`).

- [ ] **Step 1: Testes de ambiente que falham** em `env.test.ts`:
  - `aceita AUTH_APP_FIXED_CODE em produção só com APP_ENV=homolog`: com `NODE_ENV=production, RESEND_API_KEY, PANEL_URL, AUTH_SECRET(32+), APP_ENV=homolog, AUTH_APP_FIXED_CODE=246810` → `auth.appFixedCode === '246810'`; sem `APP_ENV` → lança `/AUTH_APP_FIXED_CODE/`.
  - `AUTH_APP_FIXED_CODE precisa de 6 dígitos` → `'12345'` lança.
  - `AUTH_DEV_FIXED_CODE continua proibida em produção mesmo com APP_ENV=homolog`.
  - `TRUST_PROXY=true vira trustProxy true; ausente vira false`.
- [ ] **Step 2: Rodar** `pnpm --filter @alocidadao/api test -- env` → FAIL.
- [ ] **Step 3: Implementar em `env.ts`** os três campos no schema e as regras acima (mesmo estilo de `missing`/`problems`).
- [ ] **Step 4: Testes de rota que falham:**
  - `app-routes.test.ts` — `aceita o código fixo do app (appFixedCode) na entrada pelo celular`: `buildApp` com `auth: { secret, appFixedCode: '246810', phoneCode, email }` (sem `devFixedCode`); iniciar e confirmar com `246810` → 200 com tokens.
  - Teste de painel — `o painel não aceita o appFixedCode`: mesmo `auth`, login do painel por CPF com `246810` → recusado (o mesmo código de erro de código inválido que os testes atuais esperam).
  - `me` — troca de número aceita `246810` com `appFixedCode`.
- [ ] **Step 5: Rodar** → FAIL.
- [ ] **Step 6: Implementar em `app.ts`:** `AuthOptions.appFixedCode`; nas rotas do app (`registerAppAuthRoutes`) e em `registerMeRoutes`, passar `devFixedCode: auth.appFixedCode ?? auth.devFixedCode`; painel e backoffice continuam só com `auth.devFixedCode`. `AppOptions.trustProxy` → `Fastify({ logger, trustProxy })`. Em `server.ts`, passar `trustProxy: env.trustProxy` e logar um aviso `AUTH_APP_FIXED_CODE ligado (homologação)` quando presente.
- [ ] **Step 7: Teste de proxy** em `app.test.ts`: com `trustProxy: true`, `app.inject({ headers: { 'x-forwarded-for': '203.0.113.9' } })` em uma rota que expõe `request.ip` — se nenhuma expõe, testar pelo limite: 21 pedidos a `/auth/app/start` com IPs diferentes no `x-forwarded-for` não recebem 429 (limite configurado `max: 20`). Rodar → PASS.
- [ ] **Step 8: Documentar** as três variáveis em `apps/api/.env.example` (comentadas, com o aviso de que `AUTH_APP_FIXED_CODE` é só homologação).
- [ ] **Step 9: Rodar tudo da API** `pnpm --filter @alocidadao/api test && pnpm --filter @alocidadao/api typecheck && pnpm lint` → PASS.
- [ ] **Step 10: Commit** `feat(api): código fixo do app só na homologação e trustProxy atrás do Caddy`.

### Task 2: Script para criar o admin da plataforma

**Files:**

- Create: `packages/db/src/platform-admin.ts`, `packages/db/src/create-admin.ts`, `packages/db/src/platform-admin.test.ts`
- Modify: `packages/db/package.json` (script `db:create-admin`), `packages/db/src/index.ts` se o padrão do pacote exportar

**Interfaces:**

- Produces: `ensurePlatformAdmin(db: Database, values: { cpf: string; email: string; name: string }): Promise<{ id: string; created: boolean }>`; CLI `node dist/create-admin.js --cpf 11144477735 --email x@y --name "Nome"` (usa `DATABASE_OWNER_URL`).

- [ ] **Step 1: Testes que falham** (`platform-admin.test.ts`, mesmo padrão de `platform.test.ts` com `TEST_OWNER_URL`):
  - `cria a conta com platform_role admin` → `created: true`, linha com `platformRole: 'admin'`, e-mail em minúsculas.
  - `repetir com o mesmo CPF não duplica e promove a admin` → `created: false`, mesmo `id`.
  - `recusa CPF com pontuação ou inválido` → lança antes de gravar.
- [ ] **Step 2: Rodar** `pnpm --filter @alocidadao/db test -- platform-admin` → FAIL.
- [ ] **Step 3: Implementar `ensurePlatformAdmin`** (mesma lógica de `ensureUser` do seed, numa transação; o validador de CPF que o pacote já usa, se existir em `@alocidadao/shared`).
- [ ] **Step 4: CLI `create-admin.ts`:** lê `--cpf/--email/--name`, imprime `Admin criado` ou `Admin já existia (promovido)`, sai 1 com uso em caso de argumento faltando. Script `db:create-admin`: `tsx src/create-admin.ts`.
- [ ] **Step 5: Rodar** testes, typecheck e lint do pacote → PASS.
- [ ] **Step 6: Commit** `feat(db): script para criar o admin da plataforma`.

### Task 3: Imagens Docker

**Files:**

- Create: `deploy/docker/api.Dockerfile`, `deploy/docker/web.Dockerfile`, `deploy/docker/site.Dockerfile`, `.dockerignore`

**Interfaces:**

- Produces:
  - `api`: Node 22 slim, usuário não-root, `WORKDIR /app/apps/api`, `CMD ["node","dist/server.js"]`, porta 3333. Contém também `packages/db/dist`, `packages/db/migrations` e `packages/db/data`, para rodar `node /app/packages/db/dist/{migrate,seed-dev,create-admin,import-municipalities}.js` com `docker compose run --rm api ...`.
  - `web`: estáticos do painel em `/srv/web` (build com `VITE_API_URL=/api`), imagem mínima (`busybox`), `CMD` que copia `/srv/web` para o volume `/out` e sai.
  - `site`: igual ao `web`, estáticos em `/srv/site`; build arg `SITE_API_URL`.
  - `db`: o `docker/postgres` existente, sem mudança.

- [ ] **Step 1: Escrever os três Dockerfiles** multi-stage com `pnpm install --frozen-lockfile`, `pnpm turbo run build --filter=<app>...` e, para a API, `pnpm deploy --filter @alocidadao/api --prod` (ou cópia equivalente dos `dist` e `node_modules` de produção). `.dockerignore` exclui `node_modules`, `.git`, `**/.env`, `apps/mobile`, `design`, `docs`.
- [ ] **Step 2: Construir local para amd64:** `docker buildx build --platform linux/amd64 -f deploy/docker/api.Dockerfile -t aloc-api:local --load .` (e `web`, `site`) → as três terminam sem erro.
- [ ] **Step 3: Conferir a API:** `docker run --rm -e PORT=3333 aloc-api:local node -e "import('/app/apps/api/dist/app.js').then(()=>console.log('ok'))"` → `ok`; `docker run --rm aloc-api:local ls /app/packages/db/migrations | tail -1` → `meta` presente junto de `0047_discard_code.sql`.
- [ ] **Step 4: Conferir os estáticos:** `docker run --rm -v /tmp/out:/out aloc-web:local && ls /tmp/out/index.html` → existe (usar o scratchpad no lugar de `/tmp`).
- [ ] **Step 5: Commit** `build: imagens Docker da API, do painel e do site`.

### Task 4: Pilha do servidor (Compose, Caddy, publicação, backup, rollback)

**Files:**

- Create: `deploy/homolog/compose.yml`, `deploy/homolog/Caddyfile`, `deploy/homolog/.env.example`, `deploy/scripts/deploy.sh`, `deploy/scripts/backup.sh`, `deploy/scripts/restore.sh`, `deploy/scripts/rollback.sh`, `deploy/scripts/publish-static.sh`, `deploy/scripts/smoke-local.sh`, `deploy/README.md`

**Interfaces:**

- Consumes: imagens da Task 3; variáveis da Task 1.
- Produces (no servidor, em `/srv/alocidadao`):
  - `compose.yml` com `proxy` (caddy:2), `api`, `db`; volumes `db-data`, `caddy-data`, `web-root`, `site-root`, `apk`; rede interna; só o `proxy` publica 80/443. `API_IMAGE`, `DB_IMAGE` vêm de `state/current.env`.
  - `deploy.sh <sha>`: `docker compose pull` das imagens do SHA → `backup.sh pre-deploy-<sha anterior>` → `run --rm api node /app/packages/db/dist/migrate.js` → copia estáticos do `web:<sha>` para `web-root` → `up -d api` → espera `GET http://api:3333/health` 200 (até 60 s) → grava `state/current.env` e move o antigo para `state/previous.env`. Qualquer passo que falhe: sai ≠ 0 sem gravar o estado; se já trocou a API, volta para a imagem de `current.env`.
  - `rollback.sh [--restore-db]`: troca para `state/previous.env`; com `--restore-db`, restaura o backup `pre-deploy-<sha anterior>` antes de subir.
  - `backup.sh <rótulo>`: `pg_dump -Fc` via `docker compose exec db`, envia para `s3://<bucket-backups>/<pre-deploy|daily>/<data>-<rótulo>.dump`, apaga além de 5 (pre-deploy) / 14 (daily); sai ≠ 0 se o envio falhar.
  - `restore.sh <chave-no-spaces>`: baixa, para a API, `pg_restore --clean --if-exists`, sobe a API.
  - `publish-static.sh site <sha>` e `publish-static.sh apk <arquivo>`: trocam `site-root` ou `apk/alocidadao-homolog.apk`.
  - Caddyfile: `alocidadao.com.br` → `site-root`; `www.alocidadao.com.br` → redirect 308; `homolog.alocidadao.com.br` → `handle_path /api/*` com `reverse_proxy api:3333` e `header_down Set-Cookie "Path=/auth/panel" "Path=/api/auth/panel"`; `handle /app/*` → volume `apk`; resto → `web-root` com `try_files {path} /index.html`. Cabeçalhos: HSTS, `X-Content-Type-Options`.

- [ ] **Step 1: Escrever `smoke-local.sh`** que sobe a pilha local com as imagens `:local`, Caddy com `local_certs` e os nomes em `/etc/hosts` (ou `--resolve` do curl), e verifica:
  - `curl https://homolog.alocidadao.com.br/api/health` → 200 JSON;
  - `curl https://homolog.alocidadao.com.br/api/rota-inexistente` → 404 JSON, não HTML;
  - `curl https://homolog.alocidadao.com.br/painel/qualquer` → 200 com `<div id="root">`;
  - login do painel pelo admin criado com `create-admin` (código lido do log, porque localmente não há Resend: rodar a API sem `NODE_ENV=production` só neste teste) → o `Set-Cookie` de renovação contém `Path=/api/auth/panel`;
  - `curl https://www.alocidadao.com.br` → 308 para `https://alocidadao.com.br/`;
  - `deploy.sh` com uma migração que falha de propósito (variável `FAIL_MIGRATION=1` no teste injeta um SQL inválido numa pasta temporária) → sai ≠ 0 e `/api/health` continua 200 com o SHA anterior;
  - `backup.sh` com credencial do Spaces inválida → sai ≠ 0 e o `deploy.sh` não migra.
- [ ] **Step 2: Rodar** `bash deploy/scripts/smoke-local.sh` → falha (arquivos ainda não existem).
- [ ] **Step 3: Escrever `compose.yml`, `Caddyfile`, `.env.example` e os scripts** conforme as interfaces acima. Para o smoke local, o S3 de backup aponta para o MinIO do `docker-compose.yml` da raiz.
- [ ] **Step 4: Rodar** o smoke → todas as verificações passam; também `shellcheck deploy/scripts/*.sh` sem avisos.
- [ ] **Step 5: `deploy/README.md`** (pt-BR): o que roda onde, como publicar, voltar, restaurar, ver logs, ler o código fixo e o valor dele (no `.env` do servidor), e onde está cada segredo.
- [ ] **Step 6: Commit** `feat(deploy): pilha da homologação com Caddy, publicação, backup e rollback`.

### Task 5: Workflows do GitHub

**Files:**

- Modify: `.github/workflows/ci.yml` (push em `main` e `develop`; `workflow_call` para reuso)
- Create: `.github/workflows/homolog-publish.yml`, `.github/workflows/homolog-rollback.yml`, `.github/workflows/site-publish.yml`, `.github/workflows/apk-build.yml`

**Interfaces:**

- Consumes: Dockerfiles (Task 3), scripts no servidor (Task 4).
- Produces: segredos esperados no ambiente `homolog` do GitHub: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

- [ ] **Step 1: `homolog-publish.yml`:** em push na `develop`: job `ci` (reusa `ci.yml`) → job `images` (buildx amd64, cache `type=gha`, push `alocidadao-{api,web,db}:${{ github.sha }}` com `GITHUB_TOKEN`, `packages: write`) → job `deploy` (ambiente `homolog`, SSH com `DEPLOY_SSH_KEY`, `sudo -u deploy /srv/alocidadao/deploy.sh <sha>`) → job `prune` (`actions/delete-package-versions` com `min-versions-to-keep: 2` em `alocidadao-api`, `-web` e `-db`; o `site-publish` faz o mesmo com `alocidadao-site`). `concurrency: homolog-deploy`, sem cancelar o que está rodando.
- [ ] **Step 2: `homolog-rollback.yml`:** `workflow_dispatch` com input booleano `restaurar_banco` (descrição: "Apaga o que foi gravado depois da versão desfeita") e input texto `confirmar` que precisa ser `VOLTAR`; roda `rollback.sh` com ou sem `--restore-db`.
- [ ] **Step 3: `site-publish.yml`:** `workflow_dispatch`, recusa se `github.ref != refs/heads/main`; gera `alocidadao-site:<sha>` com `SITE_API_URL=https://homolog.alocidadao.com.br/api` e roda `publish-static.sh site <sha>`.
- [ ] **Step 4: `apk-build.yml`:** `workflow_dispatch`; `develop` → `EXPO_PUBLIC_API_URL=https://homolog.alocidadao.com.br/api`; `main` → falha com "Produção ainda não existe"; `npx expo prebuild --platform android --clean`, `./gradlew assembleRelease` com `-Pandroid.injected.signing.*` a partir dos segredos; `versionCode` = `github.run_number`; envia o APK como artefato e, para a `develop`, por SCP + `publish-static.sh apk`.
- [ ] **Step 5: Validar** `actionlint` em todos os arquivos → sem erros.
- [ ] **Step 6: Commit** `ci: publicação da homologação, rollback, site e APK`.

### Task 6: Infraestrutura na DigitalOcean (com o usuário)

Sem código; executado pelo agente com `doctl`, usando o token do time do projeto. Cada passo confere o resultado.

- [ ] **Step 1: Pré-requisitos do usuário:** token da DigitalOcean (time do projeto), `gh auth login` da conta `gdcardoso`, token clássico `read:packages`, conta no Resend. Conferir: `doctl account get` mostra o time do projeto; `gh api user --jq .login` com o token da `gdcardoso` → `gdcardoso`.
- [ ] **Step 2: Criar** chave SSH de administração e de publicação (ed25519, guardadas no scratchpad e depois em segredo), Droplet `alocidadao-homolog` (2 GB, `nyc3`, Ubuntu LTS, backups ligados, monitoramento), IP reservado, Cloud Firewall (22, 80, 443), alerta de gasto US$ 30 (se o `doctl` não fizer, pedir ao usuário pelo painel).
- [ ] **Step 3: Spaces** em `nyc3`: buckets privados `alocidadao-homolog-fotos` e `alocidadao-homolog-backups`; chave de acesso restrita a eles; CORS do bucket de fotos liberando `https://homolog.alocidadao.com.br` para `GET`/`PUT` (se o app ou o painel enviarem direto por URL assinada).
- [ ] **Step 4: Preparar o servidor:** atualizar pacotes, Docker + plugin compose, usuário `deploy` (no grupo docker, só a chave de publicação), SSH sem senha e sem root, `unattended-upgrades`, 2 GB de swap, `/srv/alocidadao` com `compose.yml`, `Caddyfile`, scripts, `state/` e `.env` (senhas novas geradas com `openssl rand`, `AUTH_SECRET` de 48 bytes, `AUTH_APP_FIXED_CODE` de 6 dígitos aleatórios), `docker login ghcr.io` com o token `read:packages`, cron diário do `backup.sh daily` às 03:00 de Brasília.
- [ ] **Step 5: Senha do `app_user`:** depois da primeira subida do `db`, `ALTER ROLE app_user PASSWORD '<nova>'` e a mesma senha no `DATABASE_URL`. Conferir que `psql` com `app_user/app_user` falha.
- [ ] **Step 6: Segredos no GitHub** (ambiente `homolog` do repositório `gdcardoso/alocidadao`) com `gh secret set --env homolog`.

### Task 7: DNS, e-mail e primeira publicação

- [ ] **Step 1: Lista para o usuário cadastrar no registro.br:** apagar `painel` e `api`; `A` de `@`, `www` e `homolog` para o IP reservado; os registros que o Resend mostrar para `alocidadao.com.br`; `_dmarc` `v=DMARC1; p=none;`. Conferir com `dig +short` até propagar.
- [ ] **Step 2: Domínio verificado no Resend**; chave de API só de envio no `.env` do servidor.
- [ ] **Step 3: Enviar a `develop`** com as Tasks 1–5 (merge) → `homolog-publish` verde do começo ao fim; `curl https://homolog.alocidadao.com.br/api/health` → 200 com certificado válido.
- [ ] **Step 4: Dados iniciais** pelo `docker compose run --rm api node /app/packages/db/dist/...`: `import-municipalities.js`, `seed-dev.js`, `create-admin.js --cpf <do usuário> --email <do usuário> --name <do usuário>`.
- [ ] **Step 5: Site:** rodar `site-publish` na `main` → `https://alocidadao.com.br` mostra o site com o contato; `www` redireciona.
- [ ] **Step 6: Painel:** o usuário entra em `https://homolog.alocidadao.com.br` com o código recebido por e-mail; fica 20 min parado com a aba aberta e continua logado (renovação pelo cookie).

### Task 8: Provar backup, restauração e rollback

- [ ] **Step 1:** `backup.sh daily` manual → arquivo aparece no bucket de backups.
- [ ] **Step 2:** Restaurar esse backup num banco temporário no próprio servidor (`createdb restore_check` + `pg_restore`) e contar linhas de `municipalities` e `users` iguais às do banco principal; apagar o banco temporário.
- [ ] **Step 3:** Commit trivial na `develop` (ex.: texto no `deploy/README.md`) → publicação automática; rodar `homolog-rollback` sem restaurar banco → `state/current.env` volta ao SHA anterior e `/api/health` 200.
- [ ] **Step 4:** Publicar de novo a `develop` atual para não ficar para trás.

### Task 9: APK de homologação e validação ponta a ponta

- [ ] **Step 1: Chave de assinatura:** `keytool -genkeypair` (RSA 2048, validade 10.000 dias, alias `alocidadao`), segredos `ANDROID_*` no GitHub, e o usuário guarda o `.jks` e as senhas num cofre fora do Mac. Conferir com o usuário que a cópia existe antes de seguir.
- [ ] **Step 2:** Rodar `apk-build` na `develop` → artefato e `https://homolog.alocidadao.com.br/app/alocidadao-homolog.apk` baixam o mesmo arquivo (`sha256sum` igual).
- [ ] **Step 3:** No Android real: cidadão entra com o código fixo, abre uma solicitação com foto; o gestor (convidado pelo e-mail, que traz o link do APK) vê e atribui no painel; o agente conclui com foto; o cidadão vê o atendimento. Conferir que a foto está no bucket do Spaces.
- [ ] **Step 4:** Confirmar que o painel **não** aceita o código fixo (tentar entrar com ele → recusado).

### Task 10: Documentação e fechamento

- [ ] **Step 1:** `docs/planejamento-mvp.md`, item 11: marcar a homologação como feita, listar o que falta da infraestrutura (produção, push, iPhone, lojas, domínio no CNPJ).
- [ ] **Step 2:** Atualizar `README.md` com o fluxo `develop`/`main` e o link para `deploy/README.md`.
- [ ] **Step 3:** Commit na `develop` e merge na `main` (as duas iguais de novo); push das duas pelo `github-pessoal`.
- [ ] **Step 4:** Conferir no painel da DigitalOcean o custo projetado (~US$ 20/mês) e informar o usuário.
