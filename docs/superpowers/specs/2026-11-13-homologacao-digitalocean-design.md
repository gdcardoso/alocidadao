# Plano 8a — Homologação na DigitalOcean

Data: 13/11/2026. Primeira parte do Plano 8 (Infraestrutura): só o ambiente de homologação. Produção, push real, iPhone e lojas ficam para depois.

## Por quê

O Alô Cidadão está pronto para validar. A validação é a equipe usando o sistema em aparelhos reais (APK Android) e, depois, a demonstração para a Prefeitura de Goiânia. Para isso o sistema precisa estar no ar num endereço público, com HTTPS, e-mail de verdade e um jeito seguro de atualizar e de voltar atrás. Produção só será criada quando houver uma prefeitura real (evita custo de nuvem parada).

## Objetivos

- Homologação no ar em `homolog.alocidadao.com.br`: painel, backoffice e API (em `/api`), banco PostgreSQL + PostGIS e fotos no Spaces.
- Site público (apresentação, `/termos`, `/privacidade`) em `alocidadao.com.br`, com `www` redirecionando.
- Fluxo de branches: `develop` = homologação, `main` = produção (futura). Hoje `develop` nasce igual à `main`.
- Cada push na `develop` que passar no CI publica a homologação sozinho.
- Rollback: a última imagem é a que roda; a penúltima fica guardada para voltar. Backup do banco antes de cada migração.
- APK Android gerado por botão no GitHub; da `develop` aponta para a homologação, da `main` aponta para a produção (variáveis por branch).
- E-mail real pelo Resend com o domínio `alocidadao.com.br` verificado.

## Fora do escopo (não-objetivos)

- Ambiente de produção (servidor, banco e variáveis de produção). A automação nasce pronta para receber a produção, mas ela não é criada agora.
- Push real (Firebase/APNs): sem `google-services.json` o app funciona e a caixa de notificações no app continua; os avisos no celular não chegam. Entra num passo próprio quando o Firebase for criado.
- iPhone, contas Apple/Google Play e publicação nas lojas.
- WhatsApp (Meta): na homologação o código de entrada do app não é enviado; vale um código fixo (ver "Código de entrada na homologação").
- `api.alocidadao.com.br` separado: pode virar um segundo endereço da mesma API depois, sem mudar código.
- Homologação do site: o site não segue o fluxo da `develop`.

## O que não pode acontecer (anti-objetivos)

- Dado da homologação exposto: banco nunca aberto para a internet; segredos fora do git.
- Código fixo vazando para a produção ou para o painel: ele só vale no app, só num ambiente marcado explicitamente como homologação.
- Publicar versão com CI vermelho.
- Perder a chave de assinatura do APK (a Play Store exige a mesma em toda atualização futura).
- Recursos criados no time pessoal/da Duofy na DigitalOcean, ou repositório criado na conta `gabrielduofy` do GitHub.
- Custo acima de ~US$ 20/mês sem aviso (alerta de gasto no time).

## Restrições e fatos do projeto

- Monorepo pnpm + Turborepo, Node 22 (`.nvmrc`). Apps: `apps/api` (Fastify, `node dist/server.js`), `apps/web` (Vite, painel e backoffice), `apps/site` (gerador estático, `tsx src/build.ts`), `apps/mobile` (Expo, development build).
- Banco: imagem própria `docker/postgres` (Postgres 17 + PostGIS do PGDG). `docker/postgres/init.sql` cria o papel `app_user` (sem BYPASSRLS, usado pela API) e o banco de teste; a API usa `DATABASE_URL` com `app_user`; migrações e seed usam o dono (`DATABASE_OWNER_URL`, `pnpm db:migrate` → `packages/db/src/migrate.ts`, via `tsx`).
- Painel chama a API em `VITE_API_URL=/api` com `credentials: 'same-origin'`. A API grava o cookie de renovação com `Path=/auth/panel`; atrás do prefixo, o proxy precisa reescrever para `Path=/api/auth/panel` e tirar o `/api` do caminho (como faz `apps/web/vite.config.ts`).
- Site: lê o contato da API na geração (`SITE_API_URL`) e também no navegador (`/public/site-contact`, que já responde com `Access-Control-Allow-Origin: *`).
- App: `EXPO_PUBLIC_API_URL` é obrigatório e fica gravado no build.
- API em `NODE_ENV=production` exige `RESEND_API_KEY` e `PANEL_URL`, proíbe `AUTH_DEV_FIXED_CODE` e desliga as rotas `/dev/*`. O código do painel vai por e-mail.
- Seed de desenvolvimento (`pnpm db:seed:dev`) cria a prefeitura de demonstração (Goiânia) com usuários de e-mail fictício (`@alocidadao.dev`), que não recebem o código de entrada do painel.
- CI existente: `.github/workflows/ci.yml` (lint, formatação, build, tipos e testes, com Postgres e MinIO) em push na `main` e em pull requests.
- Git: hoje só local, branch `main`. Conta do GitHub: pessoal `gdcardoso` (SSH pelo alias `github-pessoal`); o `gh` local está logado como `gabrielduofy` e não deve ser usado para criar nada deste projeto.
- Domínio `alocidadao.com.br` no registro.br, em nome do usuário (CPF), vence em 21/05/2027. Registros `painel` e `api` apontam para um servidor antigo da UOL que não existe mais.
- DigitalOcean: time próprio do projeto já criado na conta do usuário.

## Abordagens consideradas

1. **GitHub + build no próprio servidor:** o servidor baixa o código e gera tudo. Simples, mas pesa no Droplet de 2 GB (precisa de swap) e cada publicação leva minutos.
2. **Cópia do Mac por rsync, sem GitHub:** sem conta nova, mas o código continua só no Mac e não há registro da versão no ar.
3. **GitHub Actions gera as imagens, servidor só baixa e troca (escolhida):** o servidor não faz esforço, a troca leva segundos, a penúltima imagem permite rollback e a mesma automação serve à produção. Imagens no ghcr.io (hoje sem cobrança de armazenamento e tráfego; o GitHub avisa com um mês de antecedência). Alternativa se isso mudar: registro da DigitalOcean, plano Basic, US$ 5/mês.

Descartados: App Platform e banco gerenciado da DigitalOcean (mais caros, fogem do planejamento de um Droplet com Docker Compose). `api.` em subdomínio separado (exigiria mudar o login do painel para cookie entre origens e CORS com credenciais, sem ganho na validação).

## Decisões do usuário

- Só homologação agora (cenário A, ~US$ 20/mês).
- Abordagem 3, guardando só a última e a penúltima imagem, pensando em rollback.
- Painel e API no mesmo endereço, API em `/api`.
- Site direto em `alocidadao.com.br`, sem homologação e fora do fluxo da `develop`.
- `develop` → homologação; `main` → produção; APK usa as variáveis da branch de origem.
- Repositório na conta pessoal `gdcardoso`; o usuário cria o repositório.
- Resend: conta será criada (plano gratuito).
- Registros antigos da UOL (`painel`, `api`) podem ser apagados.

## Desenho

### Endereços

| Endereço                          | O quê                                         |
| --------------------------------- | --------------------------------------------- |
| `alocidadao.com.br`               | Site estático                                 |
| `www.alocidadao.com.br`           | Redireciona para `alocidadao.com.br`          |
| `homolog.alocidadao.com.br`       | Painel e backoffice (estáticos do `apps/web`) |
| `homolog.alocidadao.com.br/api/*` | API (prefixo retirado antes de chegar à API)  |

`painel`, `api` e `www` (como site próprio) ficam reservados para a produção.

### Recursos na DigitalOcean (no time do projeto)

- 1 Droplet Basic 2 GB / 1 vCPU, Ubuntu LTS, região NYC (a mais próxima do Brasil com Spaces), com backup semanal do Droplet ligado. Acesso só por chave SSH, sem senha, sem login de root por senha.
- Cloud Firewall: entrada só 22, 80 e 443. Postgres e API não ficam expostos.
- Spaces (mesma região), um bucket privado para fotos da homologação e um prefixo/bucket privado para backups do banco.
- Alerta de gasto no time (ex.: US$ 30).

Custo esperado: ~US$ 12 (Droplet) + ~US$ 2,40 (backup) + US$ 5 (Spaces) ≈ US$ 20/mês, mais IOF.

### No servidor

Docker Compose com:

- `proxy`: Caddy com HTTPS automático (Let's Encrypt). Serve o site e o painel, encaminha `/api/*` para a API retirando o prefixo e reescreve o `Path` do cookie de renovação para `/api/auth/panel`. Fallback do painel para `index.html` (rotas do React Router).
- `api`: imagem da API (`NODE_ENV=production`, `ENABLE_DEV_ROUTES` desligada, `PHONE_CODE_PROVIDER=log`, código fixo do app ligado (seção abaixo), `AGENT_APP_PLAY_URL` com o link do APK, `PANEL_URL=https://homolog.alocidadao.com.br`, `CORS_ORIGIN` igual, S3 apontando para o Spaces).
- `db`: imagem `docker/postgres` com volume persistente; só na rede interna.
- Painel e site entregues como imagens só com os arquivos estáticos (ou volume preenchido por elas) para o Caddy servir. Site e painel são imagens separadas, porque são publicados por fluxos diferentes.

Variáveis e segredos da aplicação (senhas do banco, `AUTH_SECRET`, chave do Resend, chaves do Spaces) ficam num `.env` só no servidor, fora do git. Senhas novas e fortes; nada dos valores de desenvolvimento (inclusive a senha de `app_user` do `init.sql`).

### Imagens e publicação (GitHub Actions)

- Repositório privado `gdcardoso/alocidadao`; remoto pelo alias SSH `github-pessoal`. Criar a `develop` a partir da `main` e enviar as duas.
- CI passa a rodar também em push na `develop`.
- **Publicar homologação** (push na `develop`, depois do CI verde): gera as imagens `api`, `web` (painel com `VITE_API_URL=/api`) e `db` (só quando `docker/postgres` mudar, ou sempre, a critério de quem implementa), marca com o SHA do commit, envia ao ghcr.io e entra no servidor por SSH para:
  1. baixar as imagens do SHA novo;
  2. fazer backup do banco (`pg_dump`) no Spaces, marcado com o SHA anterior;
  3. aplicar as migrações com o dono do banco;
  4. trocar os containers e conferir se a API responde (`/health` ou equivalente);
  5. registrar no servidor qual SHA está no ar e qual era o anterior.
- **Limpeza:** depois de publicar, manter só as duas versões mais recentes de cada imagem no ghcr.io.
- **Voltar versão** (botão no GitHub): volta para o SHA anterior. Se a versão desfeita tiver migração, restaura o backup tirado antes dela (com confirmação explícita no botão, porque apaga o que foi gravado depois).
- **Publicar site** (botão no GitHub, a partir da `main`): gera o site com `SITE_API_URL=https://homolog.alocidadao.com.br/api` (enquanto não houver produção) e troca no servidor.
- **Gerar APK** (botão no GitHub, escolhendo a branch): `develop` → `EXPO_PUBLIC_API_URL=https://homolog.alocidadao.com.br/api`; `main` → URL da produção (definida quando a produção existir; até lá o botão recusa a `main`). APK de release assinado. O da `develop` é publicado no link fixo `https://homolog.alocidadao.com.br/app/alocidadao-homolog.apk` (sempre a versão mais nova; arquivo público, sem segredos), que também vai no e-mail de convite do agente (`AGENT_APP_PLAY_URL`). Fica também como artefato da execução.
- Segredos no GitHub em ambientes (`homolog`, depois `producao`): chave SSH de publicação e endereço do servidor; chave de assinatura do Android e senhas dela. Token do ghcr.io: o próprio `GITHUB_TOKEN`; no servidor, um token só de leitura de pacotes.

### Banco: dados iniciais da homologação

- Migrações, importação de municípios e dos bairros de Goiânia.
- Prefeitura de demonstração (seed), para testes e para a demo.
- Um admin da plataforma com o e-mail e o CPF reais do usuário, para entrar no painel recebendo o código por e-mail. Dele, os demais gestores e agentes entram por convite, como no fluxo real.

### Backups

- Antes de cada migração (acima) e um diário automático, ambos no Spaces.
- Retenção: 14 diários e os 5 últimos de publicação.
- Backup semanal do Droplet pela DigitalOcean.
- Restauração testada uma vez durante a montagem.

### DNS (registro.br) e e-mail

- O DNS é o do próprio registro.br (servidores `*.sec.dns.br`). Conferido em 13/11/2026: não há MX, SPF/TXT nem outro registro em uso além de `painel` e `api`; os registros do Resend entram sem juntar com nada.
- Apagar `painel` e `api` (servidor da UOL).
- Criar `A` de `alocidadao.com.br`, `www` e `homolog` para o IP do Droplet (IP reservado da DigitalOcean, para não mudar se o Droplet for recriado).
- Registros do Resend (SPF, DKIM e, se pedido, MX de retorno) para o domínio, e um DMARC simples. `EMAIL_FROM=Alô Cidadão <nao-responda@alocidadao.com.br>`.

### Código de entrada na homologação

Decisão do usuário: código fixo na homologação, para a equipe entrar sem depender de ninguém. Risco aceito: quem souber o celular de um testador entra como ele, num endereço público com dados de teste.

Decisão do agente, para conter o risco: o código fixo vale **só nos fluxos do app pelo celular** (entrada, troca de número e o que mais usar o código por celular). O painel e o backoffice continuam com o código por e-mail, porque dão acesso de gestor e de admin. Hoje `AUTH_DEV_FIXED_CODE` vale para app e painel e é proibido com `NODE_ENV=production` (`apps/api/src/env.ts`); a mudança é uma variável nova e explícita de homologação (nome a critério de quem implementa), aceita em produção só junto com uma marca de ambiente de homologação, com testes de que: sem a marca a API não sobe; com a marca o painel não aceita o código fixo; a produção nunca tem a marca. O valor do código fica no `.env` do servidor e é passado à equipe por você, não no git.

### O que o usuário faz (e o que o agente faz)

Credenciais (decisão do agente): o usuário adiciona a conta `gdcardoso` ao `gh` local (que aceita várias contas); o agente usa o token dela só nos comandos deste projeto (`GH_TOKEN=$(gh auth token --user gdcardoso)`), sem trocar a conta ativa, que continua `gabrielduofy` para o trabalho da Duofy. O token do servidor para baixar imagens do ghcr.io é um token clássico com só `read:packages`, criado pelo usuário.

Minutos do GitHub Actions (decisão do agente): o plano gratuito tem 2.000 min/mês em repositório privado e, sem limite de gasto configurado, para de rodar em vez de cobrar. Para caber: cache do pnpm e das camadas Docker; imagens geradas só se o CI passou; APK só por botão. Estimativa de ~15 min por push na `develop`, ou seja, uns 100 pushes/mês antes do teto.

Usuário: criar o repositório `alocidadao` na conta `gdcardoso`; adicionar `gdcardoso` ao `gh`; criar o token `read:packages`; gerar um token de API da DigitalOcean **dentro do time do projeto**; criar a conta do Resend; cadastrar os registros DNS no registro.br; informar e-mail e CPF do admin; guardar uma cópia da chave de assinatura do APK num lugar seguro fora do Mac.

Agente: todo o resto (Droplet, firewall, Spaces, Compose, Caddy, workflows, segredos no GitHub, primeira publicação, seed, teste de rollback e de restauração, APK de homologação).

## Pronto quando

- `https://alocidadao.com.br` mostra o site com o contato vindo da homologação; `www` redireciona.
- `https://homolog.alocidadao.com.br` abre o painel; o admin entra com o código recebido por e-mail; a sessão renova (cookie) sem cair.
- Um push na `develop` publica sozinho; o botão "voltar versão" volta para a penúltima e a homologação continua funcionando.
- Um backup foi restaurado com sucesso.
- O APK da `develop` instalado num Android real: cidadão entra com o código fixo, abre solicitação com foto; o gestor vê no painel; o agente conclui.
- Custo no painel da DigitalOcean coerente com ~US$ 20/mês.

## Fica a critério de quem implementa

- Dockerfiles (multi-stage com pnpm `deploy`/filtro), como rodar a migração na imagem (compilada ou com `tsx`), e se o `db` é republicado a cada push.
- Forma exata do health check, do registro do SHA no servidor e do script de publicação.
- Ferramenta do backup diário (cron no host ou container) e da limpeza de imagens.
- Como entregar os estáticos ao Caddy (imagem com volume compartilhado ou Caddy com os arquivos embutidos).
- Configuração do build Android de release no CI (prebuild do Expo + Gradle, ou EAS), desde que fique no botão do GitHub e use a chave de assinatura guardada como segredo.
