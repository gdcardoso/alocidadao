#!/usr/bin/env bash
# Teste local da pilha da homologação (compose.yml, Caddyfile e scripts), sem sudo e sem
# mexer no /etc/hosts: o Caddy usa certificados internos (local_certs) nas portas 18080/18443
# e o curl resolve os nomes com --resolve. O S3 dos backups é o MinIO do docker-compose.yml da
# raiz (pnpm infra:up). Ao terminar, derruba os containers e volumes do teste.
#
#   bash deploy/scripts/smoke-local.sh
#   SMOKE_SKIP_BUILD=1 bash deploy/scripts/smoke-local.sh   # reaproveita as imagens :base
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REG=alocidadao-smoke
SHA1=1111111 # primeira versão
SHA2=2222222 # mesma imagem, segunda publicação
SHA3=3333333 # migração que falha
SHA4=4444444 # migração válida (não pode rodar quando o backup falha)
SHA5=5555555 # API que não sobe (falha depois da troca: volta a anterior)
HTTPS_PORT=18443
HOST_HOMOLOG=homolog.alocidadao.com.br
BUCKET=alocidadao-smoke-backups
FIXED_CODE=135790

export COMPOSE_PROJECT_NAME=alocidadao-smoke
export PULL_IMAGES=0
export HEALTH_TIMEOUT=90


failures=0
pass() { printf '  ok    %s\n' "$*"; }
fail() {
  printf '  FALHA %s\n' "$*"
  failures=$((failures + 1))
}
step() { printf '\n== %s\n' "$*"; }
check() {
  local name="$1"
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}

curl_h() {
  curl -sS -k --max-time 15 \
    --resolve "$HOST_HOMOLOG:$HTTPS_PORT:127.0.0.1" \
    --resolve "alocidadao.com.br:$HTTPS_PORT:127.0.0.1" \
    --resolve "www.alocidadao.com.br:$HTTPS_PORT:127.0.0.1" "$@" || true
}
url() { printf 'https://%s:%s%s' "$1" "$HTTPS_PORT" "$2"; }

# --- Pré-requisitos ---------------------------------------------------------------------------
[[ -f "$REPO/deploy/homolog/compose.yml" && -f "$REPO/deploy/homolog/Caddyfile" ]] ||
  {
    echo "faltam deploy/homolog/compose.yml e/ou Caddyfile" >&2
    exit 1
  }
for s in deploy backup restore rollback publish-static lib; do
  [[ -f "$REPO/deploy/scripts/$s.sh" ]] || {
    echo "falta deploy/scripts/$s.sh" >&2
    exit 1
  }
done
curl -sf --max-time 3 http://localhost:9000/minio/health/live >/dev/null ||
  {
    echo "MinIO fora do ar em localhost:9000: rode 'pnpm infra:up'" >&2
    exit 1
  }

SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alocidadao-smoke.XXXXXX")"
export STACK_DIR="$SMOKE_DIR"

# --- Imagens ----------------------------------------------------------------------------------
if [[ "${SMOKE_SKIP_BUILD:-0}" != 1 ]]; then
  step "gerando as imagens (nativas desta máquina)"
  docker build -q -f "$REPO/deploy/docker/api.Dockerfile" -t "$REG/alocidadao-api:base" "$REPO" >/dev/null
  docker build -q -f "$REPO/deploy/docker/web.Dockerfile" -t "$REG/alocidadao-web:base" "$REPO" >/dev/null
  docker build -q -f "$REPO/deploy/docker/site.Dockerfile" \
    --build-arg SITE_API_URL="https://$HOST_HOMOLOG/api" -t "$REG/alocidadao-site:base" "$REPO" >/dev/null
  docker build -q -t "$REG/alocidadao-db:base" "$REPO/docker/postgres" >/dev/null
fi
for sha in "$SHA1" "$SHA2" "$SHA3" "$SHA4" "$SHA5"; do
  docker tag "$REG/alocidadao-web:base" "$REG/alocidadao-web:$sha"
done
docker tag "$REG/alocidadao-api:base" "$REG/alocidadao-api:$SHA1"
docker tag "$REG/alocidadao-api:base" "$REG/alocidadao-api:$SHA2"
docker tag "$REG/alocidadao-site:base" "$REG/alocidadao-site:$SHA1"
docker tag "$REG/alocidadao-db:base" "$REG/alocidadao-db:$SHA1"

# Imagem da API com uma migração a mais (pasta temporária com o SQL e o registro no _journal).
build_api_with_migration() {
  local sha="$1" sql="$2" ctx
  ctx="$SMOKE_DIR/build-$sha"
  mkdir -p "$ctx"
  printf '%s\n' "$sql" >"$ctx/migration.sql"
  cat >"$ctx/add.mjs" <<'JS'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const dir = '/app/packages/db/migrations';
const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, 'utf8'));
const last = journal.entries.at(-1);
const tag = `${String(last.idx + 1).padStart(4, '0')}_smoke`;
journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
writeFileSync(`${dir}/meta/_journal.json`, JSON.stringify(journal, null, 2));
copyFileSync('/ctx/migration.sql', `${dir}/${tag}.sql`);
JS
  cat >"$ctx/Dockerfile" <<DOCKER
FROM $REG/alocidadao-api:base
USER root
COPY . /ctx
RUN node /ctx/add.mjs && rm -rf /ctx
USER node
DOCKER
  docker build -q -t "$REG/alocidadao-api:$sha" "$ctx" >/dev/null
}
FAIL_MIGRATION=1
if [[ "$FAIL_MIGRATION" == 1 ]]; then
  build_api_with_migration "$SHA3" 'SELECT * FROM tabela_que_nao_existe;'
fi
build_api_with_migration "$SHA4" 'CREATE TABLE smoke_marker (id int);'
mkdir -p "$SMOKE_DIR/build-$SHA5"
printf 'FROM %s\nCMD ["node", "-e", "process.exit(1)"]\n' "$REG/alocidadao-api:base" \
  >"$SMOKE_DIR/build-$SHA5/Dockerfile"
docker build -q -t "$REG/alocidadao-api:$SHA5" "$SMOKE_DIR/build-$SHA5" >/dev/null

# --- Diretório da pilha (como /srv/alocidadao) ------------------------------------------------
cp "$REPO/deploy/homolog/compose.yml" "$REPO/deploy/homolog/Caddyfile" "$SMOKE_DIR/"
for s in deploy backup restore rollback publish-static lib; do
  cp "$REPO/deploy/scripts/$s.sh" "$SMOKE_DIR/"
done
cat >"$SMOKE_DIR/.env" <<ENV
IMAGE_REGISTRY=$REG
ACME_EMAIL=smoke@alocidadao.dev
CADDY_LOCAL_CERTS=local_certs
HTTP_PORT=18080
HTTPS_PORT=$HTTPS_PORT
# Só no teste: sem Resend, o código do painel sai no log da API.
NODE_ENV=development
POSTGRES_USER=alocidadao
POSTGRES_DB=alocidadao
POSTGRES_PASSWORD=$(openssl rand -hex 16)
APP_DB_PASSWORD=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
AUTH_APP_FIXED_CODE=$FIXED_CODE
PANEL_URL=https://$HOST_HOMOLOG
EMAIL_FROM=Alô Cidadão <nao-responda@alocidadao.com.br>
BACKUP_S3_ENDPOINT=http://host.docker.internal:9000
BACKUP_S3_REGION=us-east-1
BACKUP_S3_BUCKET=$BUCKET
BACKUP_S3_PREFIX=smoke
BACKUP_S3_ACCESS_KEY_ID=alocidadao
BACKUP_S3_SECRET_ACCESS_KEY=alocidadao-dev
ENV
cp "$SMOKE_DIR/.env" "$SMOKE_DIR/env.ok"

# shellcheck source=lib.sh
source "$SMOKE_DIR/lib.sh"

cleanup() {
  local status=$?
  step "limpando"
  cp "$SMOKE_DIR/env.ok" "$SMOKE_DIR/.env" 2>/dev/null || true
  compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  s3 s3 rm --recursive --only-show-errors "s3://$BUCKET/smoke/" >/dev/null 2>&1 || true
  s3 s3 rb "s3://$BUCKET" >/dev/null 2>&1 || true
  for sha in "$SHA1" "$SHA2" "$SHA3" "$SHA4" "$SHA5"; do
    docker rmi -f "$REG/alocidadao-api:$sha" "$REG/alocidadao-web:$sha" \
      "$REG/alocidadao-site:$sha" "$REG/alocidadao-db:$sha" >/dev/null 2>&1 || true
  done
  rm -rf "$SMOKE_DIR"
  exit "$status"
}
trap cleanup EXIT

s3 s3 mb "s3://$BUCKET" >/dev/null 2>&1 || true

state() { file_get "$STATE_DIR/$1.env" "$2"; }
running_api_image() { docker inspect -f '{{.Config.Image}}' "$(compose ps -q api)"; }
psql_q() { compose exec -T db psql -U alocidadao -d alocidadao -tAc "$1"; }
backups() {
  s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix smoke/ --query 'Contents[].Key' \
    --output text | tr '\t' '\n' | grep '\.dump$' || true
}
health_status() { curl_h -o /dev/null -w '%{http_code}' "$(url "$HOST_HOMOLOG" /api/health)"; }

# --- Primeira publicação ----------------------------------------------------------------------
step "deploy.sh $SHA1 (primeira publicação)"
check "deploy.sh $SHA1 sai 0" "$SMOKE_DIR/deploy.sh" "$SHA1"
check "state/current.env SHA=$SHA1" test "$(state current SHA)" = "$SHA1"

for _ in $(seq 1 30); do
  [[ "$(health_status 2>/dev/null)" == 200 ]] && break
  sleep 1
done

step "rotas do proxy"
body="$(curl_h -D "$SMOKE_DIR/h" "$(url "$HOST_HOMOLOG" /api/health)")"
check "/api/health -> 200" grep -q '^HTTP/[0-9.]* 200' "$SMOKE_DIR/h"
check "/api/health é JSON" grep -qi '^content-type: application/json' "$SMOKE_DIR/h"
check "/api/health status ok" grep -q '"status":"ok"' <<<"$body"
check "HSTS" grep -qi '^strict-transport-security: max-age=' "$SMOKE_DIR/h"
check "X-Content-Type-Options" grep -qi '^x-content-type-options: nosniff' "$SMOKE_DIR/h"

curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" "$(url "$HOST_HOMOLOG" /api/rota-inexistente)"
check "/api/rota-inexistente -> 404" grep -q '^HTTP/[0-9.]* 404' "$SMOKE_DIR/h"
check "/api/rota-inexistente é JSON, não HTML" grep -qi '^content-type: application/json' "$SMOKE_DIR/h"

curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" "$(url "$HOST_HOMOLOG" /painel/qualquer)"
check "/painel/qualquer -> 200" grep -q '^HTTP/[0-9.]* 200' "$SMOKE_DIR/h"
check "/painel/qualquer traz <div id=\"root\">" grep -q '<div id="root">' "$SMOKE_DIR/b"

curl_h -D "$SMOKE_DIR/h" -o /dev/null "$(url www.alocidadao.com.br /)"
check "www -> 308" grep -q '^HTTP/[0-9.]* 308' "$SMOKE_DIR/h"
check "www -> https://alocidadao.com.br/" grep -qi '^location: https://alocidadao.com.br/\s*$' "$SMOKE_DIR/h"

step "login do painel (admin do create-admin, código do log)"
compose run --rm -T --no-deps dbtools node dist/create-admin.js --cpf 52998224725 \
  --email admin@smoke.alocidadao.dev --name "Admin Smoke" >/dev/null
challenge="$(curl_h -X POST -H 'content-type: application/json' -d '{"cpf":"52998224725"}' \
  "$(url "$HOST_HOMOLOG" /api/auth/panel/start)" | sed -n 's/.*"challengeId":"\([^"]*\)".*/\1/p')"
check "start devolve challengeId" test -n "$challenge"
sleep 1
code="$(compose logs api 2>/dev/null | grep -o 'Seu código é [0-9]\{6\}' | tail -n 1 | grep -o '[0-9]\{6\}' || true)"
check "código no log da API" test -n "$code"
curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" -c "$SMOKE_DIR/jar" -X POST \
  -H 'content-type: application/json' -d "{\"challengeId\":\"$challenge\",\"code\":\"$code\"}" \
  "$(url "$HOST_HOMOLOG" /api/auth/panel/verify)"
check "verify -> 200" grep -q '^HTTP/[0-9.]* 200' "$SMOKE_DIR/h"
check "Set-Cookie com Path=/api/auth/panel" grep -qi '^set-cookie: ac_panel_refresh=.*Path=/api/auth/panel' "$SMOKE_DIR/h"
curl_h -D "$SMOKE_DIR/h" -o /dev/null -b "$SMOKE_DIR/jar" -X POST \
  -H 'x-requested-with: alocidadao-panel' "$(url "$HOST_HOMOLOG" /api/auth/panel/refresh)"
check "renovação pelo cookie (refresh) -> 200" grep -q '^HTTP/[0-9.]* 200' "$SMOKE_DIR/h"

step "publish-static.sh (site e APK)"
check "publish-static.sh site $SHA1 sai 0" "$SMOKE_DIR/publish-static.sh" site "$SHA1"
curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" "$(url alocidadao.com.br /)"
check "alocidadao.com.br -> 200 com HTML" grep -qi '<html' "$SMOKE_DIR/b"
printf 'PK\003\004smoke' >"$SMOKE_DIR/app.apk"
check "publish-static.sh apk sai 0" "$SMOKE_DIR/publish-static.sh" apk "$SMOKE_DIR/app.apk"
curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" "$(url "$HOST_HOMOLOG" /app/alocidadao-homolog.apk)"
check "/app/alocidadao-homolog.apk -> 200" grep -q '^HTTP/[0-9.]* 200' "$SMOKE_DIR/h"
check "APK com o conteúdo publicado" cmp -s "$SMOKE_DIR/b" "$SMOKE_DIR/app.apk"
check "APK com content-type do Android" grep -qi '^content-type: application/vnd.android.package-archive' "$SMOKE_DIR/h"

# --- Segunda publicação -----------------------------------------------------------------------
step "deploy.sh $SHA2"
check "deploy.sh $SHA2 sai 0" "$SMOKE_DIR/deploy.sh" "$SHA2"
check "current=$SHA2, previous=$SHA1" test "$(state current SHA)-$(state previous SHA)" = "$SHA2-$SHA1"
check "backup pre-deploy-$SHA1 no S3" grep -q "^smoke/pre-deploy/.*-pre-deploy-$SHA1\.dump$" <<<"$(backups)"
check "app_user entra com a senha do .env" compose exec -T api node -e "
  const { Client } = require('/app/packages/db/node_modules/pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.end()).then(() => process.exit(0), () => process.exit(1));"
# Gravado depois do backup pre-deploy-$SHA1: o rollback com --restore-db apaga.
compose run --rm -T --no-deps dbtools node dist/create-admin.js --cpf 11144477735 \
  --email depois@smoke.alocidadao.dev --name "Depois do backup" >/dev/null
check "conta gravada depois do backup existe" test "$(psql_q "select count(*) from users where cpf = '11144477735'")" = 1

step "deploy.sh $SHA3 com migração que falha (FAIL_MIGRATION=$FAIL_MIGRATION)"
if "$SMOKE_DIR/deploy.sh" "$SHA3"; then fail "deploy.sh $SHA3 devia sair ≠ 0"; else pass "deploy.sh $SHA3 sai ≠ 0"; fi
check "/api/health continua 200" test "$(health_status)" = 200
check "API no ar continua $SHA2" test "$(running_api_image)" = "$REG/alocidadao-api:$SHA2"
check "state/current.env continua $SHA2" test "$(state current SHA)" = "$SHA2"

step "deploy.sh $SHA5 com API que não responde ao /health"
if HEALTH_TIMEOUT=20 "$SMOKE_DIR/deploy.sh" "$SHA5"; then
  fail "deploy.sh $SHA5 devia sair ≠ 0"
else
  pass "deploy.sh $SHA5 sai ≠ 0"
fi
check "API voltou para $SHA2" test "$(running_api_image)" = "$REG/alocidadao-api:$SHA2"
check "/api/health -> 200" test "$(health_status)" = 200
check "state/current.env continua $SHA2" test "$(state current SHA)" = "$SHA2"
curl_h -o "$SMOKE_DIR/b" "$(url "$HOST_HOMOLOG" /painel/qualquer)"
check "painel continua no ar" grep -q '<div id="root">' "$SMOKE_DIR/b"

step "backup com credencial do S3 inválida"
sed -i.bak 's/^BACKUP_S3_SECRET_ACCESS_KEY=.*/BACKUP_S3_SECRET_ACCESS_KEY=credencial-errada/' "$SMOKE_DIR/.env"
if "$SMOKE_DIR/backup.sh" daily >/dev/null; then fail "backup.sh devia sair ≠ 0"; else pass "backup.sh sai ≠ 0"; fi
if "$SMOKE_DIR/deploy.sh" "$SHA4"; then fail "deploy.sh $SHA4 devia sair ≠ 0"; else pass "deploy.sh $SHA4 sai ≠ 0"; fi
check "a migração de $SHA4 não rodou" test "$(psql_q "select to_regclass('public.smoke_marker') is null")" = t
check "API no ar continua $SHA2" test "$(running_api_image)" = "$REG/alocidadao-api:$SHA2"
check "state/current.env continua $SHA2" test "$(state current SHA)" = "$SHA2"
cp "$SMOKE_DIR/env.ok" "$SMOKE_DIR/.env"

step "rollback.sh --restore-db"
check "rollback.sh --restore-db sai 0" "$SMOKE_DIR/rollback.sh" --restore-db
check "current=$SHA1, previous=$SHA2" test "$(state current SHA)-$(state previous SHA)" = "$SHA1-$SHA2"
check "API no ar é $SHA1" test "$(running_api_image)" = "$REG/alocidadao-api:$SHA1"
check "/api/health -> 200" test "$(health_status)" = 200
check "conta de antes do backup continua" test "$(psql_q "select count(*) from users where cpf = '52998224725'")" = 1
check "conta gravada depois do backup sumiu" test "$(psql_q "select count(*) from users where cpf = '11144477735'")" = 0
curl_h -D "$SMOKE_DIR/h" -o "$SMOKE_DIR/b" "$(url "$HOST_HOMOLOG" /painel/qualquer)"
check "painel continua no ar" grep -q '<div id="root">' "$SMOKE_DIR/b"

step "deploy.sh $SHA1 de novo (idempotente)"
check "deploy.sh $SHA1 sai 0" "$SMOKE_DIR/deploy.sh" "$SHA1"
check "current=$SHA1, previous continua $SHA2" test "$(state current SHA)-$(state previous SHA)" = "$SHA1-$SHA2"
check "/api/health -> 200" test "$(health_status)" = 200

step "retenção dos backups (5 de publicação)"
for i in 1 2 3 4 5 6; do "$SMOKE_DIR/backup.sh" "pre-deploy-retencao$i" >/dev/null; done
check "ficam só 5 backups de publicação" test "$(backups | grep -c '/pre-deploy/')" = 5
check "o mais novo ficou" grep -q -- '-pre-deploy-retencao6\.dump$' <<<"$(backups)"
check "o mais antigo (retencao1) saiu" test "$(backups | grep -c -- '-pre-deploy-retencao1\.dump$')" = 0

printf '\n'
if ((failures > 0)); then
  echo "SMOKE: $failures verificação(ões) falharam"
  exit 1
fi
echo "SMOKE: tudo certo"
