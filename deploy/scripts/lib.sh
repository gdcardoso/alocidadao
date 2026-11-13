# shellcheck shell=bash disable=SC2034 # as variáveis são usadas por quem carrega este arquivo
# Funções comuns dos scripts da homologação. Carregado com `source` pelos outros scripts.
# No servidor, tudo fica no mesmo diretório (/srv/alocidadao): compose.yml, Caddyfile, .env,
# state/ e os scripts. STACK_DIR muda esse diretório (o padrão é o do próprio script).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="${STACK_DIR:-$SCRIPT_DIR}"
STATE_DIR="$STACK_DIR/state"
CURRENT_STATE="$STATE_DIR/current.env"
PREVIOUS_STATE="$STATE_DIR/previous.env"
SITE_STATE="$STATE_DIR/site.env"
PROJECT="${COMPOSE_PROJECT_NAME:-alocidadao-homolog}"
# Cliente S3 num container (funciona com o DigitalOcean Spaces e com o MinIO do teste local).
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.31.0}"
# 0 = não baixa as imagens (teste local, com imagens geradas na máquina).
PULL_IMAGES="${PULL_IMAGES:-1}"
# Segundos de espera pelo GET /health da API.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  log "ERRO: $*"
  exit 1
}

[[ -f "$STACK_DIR/.env" ]] || die "não achei $STACK_DIR/.env (copie do .env.example e preencha)"
[[ -f "$STACK_DIR/compose.yml" ]] || die "não achei $STACK_DIR/compose.yml"
mkdir -p "$STATE_DIR"

# Valor de uma chave de um arquivo KEY=valor (sem executar o arquivo). Vazio se não existir.
file_get() {
  local file="$1" key="$2" value
  [[ -f "$file" ]] || return 0
  value="$(sed -n "s/^${key}=//p" "$file" | tail -n 1)"
  value="${value%$'\r'}"
  # Aspas em volta, se houver.
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  printf '%s' "$value"
}
env_get() { file_get "$STACK_DIR/.env" "$1"; }
require_env() {
  local value
  value="$(env_get "$1")"
  [[ -n "$value" ]] || die "defina $1 no .env"
  printf '%s' "$value"
}

# docker compose com o .env e a versão no ar (state/current.env). Variáveis já exportadas no
# shell (API_IMAGE=... compose up) têm prioridade sobre os arquivos.
compose() {
  local args=(-p "$PROJECT" --project-directory "$STACK_DIR" -f "$STACK_DIR/compose.yml"
    --env-file "$STACK_DIR/.env")
  # Só o smoke-local.sh define (ex.: NODE_ENV=development para o código do painel sair no log).
  [[ -n "${SMOKE_COMPOSE_OVERRIDE:-}" ]] && args+=(-f "$SMOKE_COMPOSE_OVERRIDE")
  [[ -f "$CURRENT_STATE" ]] && args+=(--env-file "$CURRENT_STATE")
  [[ -f "$SITE_STATE" ]] && args+=(--env-file "$SITE_STATE")
  if [[ -f "$CURRENT_STATE" ]]; then
    docker compose "${args[@]}" "$@"
  else
    # Antes da primeira publicação não há versão no ar; o valor só evita o erro de variável
    # ausente nos comandos que não usam a API nem o banco (ex.: publicar o site).
    API_IMAGE="${API_IMAGE:-sem-versao-no-ar}" DB_IMAGE="${DB_IMAGE:-sem-versao-no-ar}" \
      docker compose "${args[@]}" "$@"
  fi
}

valid_sha() { [[ "$1" =~ ^[0-9a-f]{7,40}$ ]]; }

# Referência da imagem de um componente (api, web, site, db) num SHA.
image_ref() {
  local registry
  registry="$(require_env IMAGE_REGISTRY)"
  printf '%s/alocidadao-%s:%s' "$registry" "$1" "$2"
}

# Baixa a imagem (se PULL_IMAGES=1) e confere que ela existe localmente.
ensure_image() {
  local ref="$1"
  if [[ "$PULL_IMAGES" == 1 ]]; then
    if ! docker pull -q "$ref" >/dev/null; then
      docker image inspect "$ref" >/dev/null 2>&1 || die "não consegui baixar $ref"
      log "aviso: não baixei $ref; uso a cópia local"
    fi
  fi
  docker image inspect "$ref" >/dev/null 2>&1 || die "imagem $ref não existe"
}

# Uma publicação de cada vez (deploy, rollback, restore, publish-static).
# Os scripts chamados por outro script herdam a trava (LOCK_HELD=1).
LOCK_DIR="$STATE_DIR/.lock"
acquire_lock() {
  if [[ "${LOCK_HELD:-0}" == 1 ]]; then return 0; fi
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "outra operação em andamento ($(cat "$LOCK_DIR/info" 2>/dev/null || echo '?')). Se não houver, apague $LOCK_DIR"
  fi
  printf '%s pid %s em %s\n' "$(basename "$0")" "$$" "$(date -u +%FT%TZ)" >"$LOCK_DIR/info"
  export LOCK_HELD=1
  LOCK_OWNER=1
}
release_lock() {
  if [[ "${LOCK_OWNER:-0}" == 1 ]]; then rm -rf "$LOCK_DIR"; fi
}

# Espera o GET http://api:3333/health responder 200, de dentro da rede da pilha.
wait_api_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  local probe="fetch('http://api:3333/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"
  while ((SECONDS < deadline)); do
    if compose exec -T api node -e "$probe" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Grava um arquivo de estado de uma vez (escreve ao lado e renomeia).
write_state() {
  local file="$1" sha="$2" api="$3" web="$4" db="$5"
  printf 'SHA=%s\nAPI_IMAGE=%s\nWEB_IMAGE=%s\nDB_IMAGE=%s\nDEPLOYED_AT=%s\n' \
    "$sha" "$api" "$web" "$db" "$(date -u +%FT%TZ)" >"$file.tmp"
  mv "$file.tmp" "$file"
}

# Esvazia o volume do painel (web) ou do site e copia os estáticos da imagem.
publish_static_image() {
  local kind="$1" ref="$2"
  compose run --rm -T --no-deps files sh -c "find /$kind -mindepth 1 -delete"
  if [[ "$kind" == web ]]; then
    WEB_IMAGE="$ref" compose run --rm -T --no-deps web-publish
  else
    SITE_IMAGE="$ref" compose run --rm -T --no-deps site-publish
  fi
  compose run --rm -T --no-deps files test -f "/$kind/index.html" ||
    die "a imagem $ref não deixou index.html no volume do $kind"
}

# Cliente S3 dos backups. Monte arquivos em /work com WORK_DIR=<dir>.
s3() {
  local endpoint
  endpoint="$(require_env BACKUP_S3_ENDPOINT)"
  AWS_ACCESS_KEY_ID="$(require_env BACKUP_S3_ACCESS_KEY_ID)" \
    AWS_SECRET_ACCESS_KEY="$(require_env BACKUP_S3_SECRET_ACCESS_KEY)" \
    AWS_DEFAULT_REGION="$(env_get BACKUP_S3_REGION)" \
    docker run --rm -i \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    ${WORK_DIR:+-v "$WORK_DIR:/work"} \
    "$AWS_CLI_IMAGE" --endpoint-url "$endpoint" "$@"
}

# Caminho dos backups no bucket: [<prefixo>/]<pre-deploy|daily>/...
backup_base() {
  local prefix
  prefix="$(env_get BACKUP_S3_PREFIX)"
  printf '%s' "${prefix:+${prefix%/}/}"
}
