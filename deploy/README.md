# Homologação: como roda e como operar

Homologação num Droplet Ubuntu da DigitalOcean, com Docker Compose. As imagens são geradas no
GitHub Actions e publicadas em `ghcr.io/gdcardoso/alocidadao-{api,web,site,db}:<sha>`.

## O que roda onde

| Endereço                                                       | O quê                                      | De onde vem                                   |
| -------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| `https://alocidadao.com.br`                                    | Site de apresentação                       | volume `site-root` (imagem `alocidadao-site`) |
| `https://www.alocidadao.com.br`                                | Redireciona (308) para `alocidadao.com.br` | Caddyfile                                     |
| `https://homolog.alocidadao.com.br`                            | Painel e backoffice                        | volume `web-root` (imagem `alocidadao-web`)   |
| `https://homolog.alocidadao.com.br/api/*`                      | API (o Caddy retira o `/api`)              | container `api`                               |
| `https://homolog.alocidadao.com.br/app/alocidadao-homolog.apk` | APK de homologação                         | volume `apk`                                  |

No servidor, tudo fica em `/srv/alocidadao` (o GitHub Actions sincroniza `deploy/homolog/*` e
`deploy/scripts/*.sh` para lá antes de cada publicação):

```
/srv/alocidadao/
  compose.yml  Caddyfile          pilha (deploy/homolog)
  .env                            segredos e configuração (SÓ no servidor, chmod 600)
  deploy.sh rollback.sh backup.sh restore.sh publish-static.sh lib.sh   (deploy/scripts)
  state/current.env               versão no ar (SHA e imagens)
  state/previous.env              versão anterior (para o rollback)
  state/site.env                  versão do site no ar
  state/history.log               histórico de publicações e rollbacks
```

Serviços do `compose.yml` (projeto `alocidadao-homolog`):

- `proxy`: Caddy 2, único com portas abertas (80/443). HTTPS automático (Let's Encrypt), HSTS e
  `X-Content-Type-Options`. Reescreve o `Path` do cookie de renovação do painel de
  `/auth/panel` para `/api/auth/panel`. Rotas do painel que não são arquivo caem no `index.html`.
- `api`: imagem `alocidadao-api:<sha>` (`NODE_ENV=production`, `APP_ENV=homolog`,
  `TRUST_PROXY=true`, `PHONE_CODE_PROVIDER=log`, rotas `/dev` desligadas). Usa o papel
  `app_user` (sujeito ao RLS).
- `db`: Postgres 17 + PostGIS (`alocidadao-db`), volume `db-data`, só na rede interna.
- Ferramentas (só com `run`): `dbtools` (scripts do banco com o dono), `web-publish`,
  `site-publish` e `files` (copiam os estáticos e o APK para os volumes).

## Comandos avulsos

Os scripts passam o `.env` e o `state/current.env` ao Compose. Para comandos à mão:

```sh
cd /srv/alocidadao
alias dc='docker compose -p alocidadao-homolog --env-file .env --env-file state/current.env'
dc ps
dc logs -f api            # logs da API (o código de entrada pelo celular sai aqui)
dc logs -f proxy          # logs do Caddy (certificados, erros de proxy)
dc exec db psql -U alocidadao -d alocidadao
```

Scripts do banco (rodam com o dono do banco, na imagem da API no ar):

```sh
dc run --rm dbtools node dist/create-admin.js --cpf <11 dígitos> --email <e-mail> --name "<nome>"
dc run --rm dbtools node dist/seed-dev.js
dc run --rm dbtools node dist/import-municipalities.js
```

## Publicar

Normalmente pelo GitHub Actions (push na `develop`). À mão, no servidor:

```sh
/srv/alocidadao/deploy.sh <sha>            # API + painel do commit <sha>
/srv/alocidadao/deploy.sh <sha> <sha-db>   # idem, trocando também a imagem do banco
```

Passos: confere o Caddyfile, baixa as imagens, faz o backup `pre-deploy-<sha anterior>` no
Spaces, aplica as migrações com o dono do banco, aplica a senha do `app_user`, troca os
estáticos do painel, troca a API, espera `GET /health` responder 200 (até 60 s), aplica
mudanças do Caddyfile/compose.yml no proxy e grava `state/current.env` (o anterior vira
`state/previous.env`).

Se algum passo falha, o script sai ≠ 0 sem gravar o estado. Se a API ou o painel já tinham
sido trocados, volta para a versão de `state/current.env`. Se o backup falha, nada muda (as
migrações não rodam). Uma migração que falha não muda o banco (o Drizzle aplica numa transação).

Site e APK:

```sh
/srv/alocidadao/publish-static.sh site <sha>                       # alocidadao-site:<sha>
/srv/alocidadao/publish-static.sh apk /caminho/app-release.apk     # /app/alocidadao-homolog.apk
```

O painel e o site são trocados apagando o conteúdo do volume e copiando o novo (durante um
ou dois segundos, uma página pode dar 404).

Para mudar o Caddyfile ou o compose.yml: altere em `deploy/homolog/`, faça commit na `develop`;
a próxima publicação aplica (o proxy é recriado quando o Caddyfile muda).

## Voltar versão

```sh
/srv/alocidadao/rollback.sh               # volta API, painel e db para state/previous.env
/srv/alocidadao/rollback.sh --restore-db  # idem, restaurando antes o backup pre-deploy-<sha anterior>
```

Use `--restore-db` quando a versão desfeita tiver migração: o banco volta ao momento logo
antes dela, e **tudo o que foi gravado depois se perde**. Sem `--restore-db`, o código anterior
roda sobre o banco já migrado. Depois do rollback, `current` e `previous` trocam de lugar.

## Backups e restauração

- `backup.sh <rótulo>`: `pg_dump -Fc` enviado para
  `s3://<BACKUP_S3_BUCKET>/[<BACKUP_S3_PREFIX>/]<pre-deploy|daily>/<data>-<rótulo>.dump`.
  Rótulos que começam com `pre-deploy` guardam os 5 últimos; os demais (`daily`), os 14 últimos.
  Sai ≠ 0 se o dump ou o envio falhar. O envio usa a imagem `amazon/aws-cli` (nada a instalar no
  host).
- Backup diário: cron do usuário de deploy no servidor:

  ```
  15 6 * * * /srv/alocidadao/backup.sh daily >> /srv/alocidadao/state/backup.log 2>&1
  ```

- Listar os backups:

  ```sh
  docker run --rm -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... amazon/aws-cli:2.31.0 \
    --endpoint-url https://nyc3.digitaloceanspaces.com s3 ls --recursive s3://<bucket-dos-backups>/
  ```

  (ou pelo painel da DigitalOcean, em Spaces).

- Restaurar: `restore.sh <chave>` (a chave como o `backup.sh` imprime, ex.:
  `daily/20261113T061500Z-daily.dump`). Baixa o arquivo, para a API, restaura num banco novo
  (`pg_restore --clean --if-exists`), troca pelo atual (o anterior fica como
  `alocidadao_anterior` até a próxima restauração) e sobe a API. **Apaga o que foi gravado
  depois do backup.**
- Backup semanal do Droplet inteiro: ligado no painel da DigitalOcean.

## Código de entrada na homologação

- **App pelo celular** (cidadão e agente): vale o código fixo de 6 dígitos de
  `AUTH_APP_FIXED_CODE`, no `/srv/alocidadao/.env`. Vale na entrada, na troca de número e
  também na recuperação de conta do app. O código real não é enviado (`PHONE_CODE_PROVIDER=log`:
  sai no log da API, `dc logs api`).
- **Painel e backoffice**: nunca aceitam o código fixo; o código vai por e-mail (Resend).
- Para ler o valor: `ssh` no servidor e `grep AUTH_APP_FIXED_CODE /srv/alocidadao/.env`. Ele não
  fica no git; quem administra o servidor passa à equipe. Para trocar: edite o `.env` e rode
  `deploy.sh` com o SHA no ar (`grep SHA state/current.env`) para recriar a API.
- Risco aceito: quem souber o celular de um testador entra como ele. Use só dados de teste.

## Onde está cada segredo

| Segredo                                                                                                                                              | Onde                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Senhas do banco (`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`), `AUTH_SECRET`, `AUTH_APP_FIXED_CODE`, `RESEND_API_KEY`, chaves do Spaces (fotos e backups) | `/srv/alocidadao/.env` (modelo: `deploy/homolog/.env.example`)        |
| Token só de leitura do ghcr.io (`read:packages`)                                                                                                     | `~/.docker/config.json` do usuário de deploy (`docker login ghcr.io`) |
| Chave SSH de publicação e endereço do servidor                                                                                                       | GitHub, ambiente `homolog`                                            |
| Chave de assinatura do Android e senhas                                                                                                              | GitHub, ambiente `homolog` (cópia guardada fora do Mac)               |
| Certificados HTTPS                                                                                                                                   | volume `caddy-data` (o Caddy renova sozinho)                          |

Senhas do banco: só letras e números (`openssl rand -hex 32`), porque entram numa URL. Para
trocar `APP_DB_PASSWORD`, edite o `.env` e rode `deploy.sh` com o SHA no ar: o banco é recriado
com a variável nova (mesmo volume) e o script aplica a senha ao `app_user`.

## Teste local

```sh
pnpm infra:up                         # MinIO do docker-compose.yml da raiz (S3 dos backups)
bash deploy/scripts/smoke-local.sh    # gera as imagens e testa a pilha
SMOKE_SKIP_BUILD=1 bash deploy/scripts/smoke-local.sh   # reaproveita as imagens :base
```

O teste sobe a pilha com o projeto `alocidadao-smoke`, Caddy com certificados internos nas
portas 18080/18443 e `curl --resolve` (sem sudo e sem `/etc/hosts`). Confere as rotas do
proxy, o login do painel e o cookie, o site, o APK, publicação, migração que falha, API que não
sobe, backup com credencial errada, rollback com restauração e retenção. No fim, apaga
containers, volumes e os backups do teste.

## Workflows do GitHub

| Workflow               | Quando                  | O que faz                                                                                                                                                                                                                           |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homolog-publish.yml`  | push na `develop`       | CI -> imagens `api`/`web` (e `db`, só se `docker/postgres/**` mudou) -> sincroniza `deploy/homolog/*` e `deploy/scripts/*.sh` (menos `smoke-local.sh`) para `/srv/alocidadao` -> `deploy.sh` -> limpa o ghcr (2 versões por imagem) |
| `homolog-rollback.yml` | manual                  | `rollback.sh`; digite `VOLTAR` em `confirmar`; `restaurar_banco` liga o `--restore-db`                                                                                                                                              |
| `site-publish.yml`     | manual, só na `main`    | imagem do site (`SITE_API_URL` da homologação) -> `publish-static.sh site <sha>`                                                                                                                                                    |
| `apk-build.yml`        | manual, só na `develop` | APK assinado (`versionCode` = número da execução), artefato do GitHub e `publish-static.sh apk`                                                                                                                                     |

Segredos do ambiente `homolog` (Settings > Environments): `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (chave
do usuário `deploy`), `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan <host>`, conferida),
`ANDROID_KEYSTORE_BASE64` (`base64 -i release.keystore`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. O `site-publish` e o `apk-build` usam o
`publish-static.sh` que já está no servidor (enviado pela última publicação da `develop`).
