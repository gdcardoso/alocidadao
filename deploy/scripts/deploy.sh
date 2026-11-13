#!/usr/bin/env bash
# Publica uma versão da homologação (chamado pelo GitHub Actions por SSH).
#   deploy.sh <sha> [<sha-da-imagem-do-db>]
# Sem o segundo argumento, o banco continua com a imagem que já está no ar (na primeira
# publicação, usa alocidadao-db:<sha>).
#
# Passos: baixa as imagens -> backup pre-deploy-<sha anterior> -> migrações (dono do banco) ->
# senha do app_user -> estáticos do painel -> troca a API -> espera o /health -> aplica o
# Caddyfile/compose.yml -> grava state/current.env (o anterior vira state/previous.env).
# Se um passo falha, sai ≠ 0 sem gravar o estado e volta ao que estava no ar.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

sha="${1:-}"
db_sha="${2:-}"
valid_sha "$sha" || die "uso: deploy.sh <sha> [<sha-do-db>] (SHA do commit, 7 a 40 hexadecimais)"
[[ -z "$db_sha" ]] || valid_sha "$db_sha" || die "SHA do db inválido: $db_sha"

node_env="$(env_get NODE_ENV)"
[[ -z "$node_env" || "$node_env" == production ]] ||
  die "NODE_ENV=$node_env no .env: a homologação roda sempre em production (apague a linha)"

acquire_lock

cur_sha="$(file_get "$CURRENT_STATE" SHA)"
cur_api="$(file_get "$CURRENT_STATE" API_IMAGE)"
cur_web="$(file_get "$CURRENT_STATE" WEB_IMAGE)"
cur_db="$(file_get "$CURRENT_STATE" DB_IMAGE)"

new_api="$(image_ref api "$sha")"
new_web="$(image_ref web "$sha")"
if [[ -n "$db_sha" ]]; then
  new_db="$(image_ref db "$db_sha")"
elif [[ -n "$cur_db" ]]; then
  new_db="$cur_db"
else
  new_db="$(image_ref db "$sha")"
fi

# Até cada troca, os comandos usam as imagens que estão no ar.
export API_IMAGE="${cur_api:-$new_api}" WEB_IMAGE="${cur_web:-$new_web}" DB_IMAGE="${cur_db:-$new_db}"

db_changed=0
web_changed=0
api_changed=0
finished=0
on_exit() {
  local status=$?
  if [[ "$finished" == 0 ]]; then
    if [[ -n "$cur_sha" && "$db_changed$api_changed$web_changed" != 000 ]]; then
      log "deploy: falhou; voltando ao que estava no ar ($cur_sha)"
      if [[ "$db_changed" == 1 ]]; then
        DB_IMAGE="$cur_db" compose up -d --wait --no-deps db || log "ERRO: não voltei o db"
      fi
      if [[ "$api_changed" == 1 ]]; then
        export API_IMAGE="$cur_api" DB_IMAGE="$cur_db"
        if compose up -d --no-deps api && wait_api_healthy; then
          log "deploy: API de volta em $cur_api"
        else
          log "ERRO: a API não voltou; veja 'docker compose logs api'"
        fi
      fi
      if [[ "$web_changed" == 1 ]]; then
        (publish_static_image web "$cur_web") || log "ERRO: não voltei o painel"
      fi
    fi
    log "deploy: $sha NÃO foi publicado"
    [[ "$status" != 0 ]] || status=1
  fi
  release_lock
  exit "$status"
}
trap on_exit EXIT

log "deploy: ${cur_sha:-(nada no ar)} -> $sha"

log "deploy: conferindo o Caddyfile"
if ! out="$(compose run --rm -T --no-deps proxy caddy validate --config /etc/caddy/Caddyfile \
  --adapter caddyfile 2>&1)"; then
  printf '%s\n' "$out" | tail -n 5 >&2
  die "Caddyfile ou compose.yml inválido"
fi

log "deploy: baixando as imagens"
for ref in "$new_api" "$new_web" "$new_db"; do ensure_image "$ref"; done

compose up -d --wait --no-deps db

log "deploy: backup antes das migrações"
"$SCRIPT_DIR/backup.sh" "pre-deploy-${cur_sha:-inicial}" >/dev/null ||
  die "backup falhou; nada foi alterado"

if [[ "$new_db" != "$DB_IMAGE" ]]; then
  log "deploy: trocando a imagem do banco para $new_db"
  db_changed=1
  export DB_IMAGE="$new_db"
  compose up -d --wait --no-deps db
fi

log "deploy: aplicando as migrações"
API_IMAGE="$new_api" compose run --rm -T --no-deps dbtools node dist/migrate.js ||
  die "as migrações falharam (o backup pre-deploy-${cur_sha:-inicial} está no Spaces)"

# A migração cria o app_user sem login; a senha vem do .env (APP_DB_PASSWORD).
# shellcheck disable=SC2016 # expandidas dentro do container
compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v pw="$APP_DB_PASSWORD"' <<'SQL'
ALTER ROLE app_user WITH LOGIN PASSWORD :'pw';
SQL

log "deploy: publicando o painel"
web_changed=1
export WEB_IMAGE="$new_web"
publish_static_image web "$new_web"

log "deploy: trocando a API"
api_changed=1
export API_IMAGE="$new_api"
compose up -d --no-deps api
wait_api_healthy || die "a API não respondeu 200 em /health em ${HEALTH_TIMEOUT}s"
running="$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q api)")"
[[ "$running" == "$new_api" ]] || die "a API no ar é $running, não $new_api"

# Mudanças do Caddyfile: o arquivo é montado no container; o rsync troca o arquivo (outro
# inode), então recriamos o proxy quando o conteúdo muda. Mudanças do compose.yml o `up` aplica.
log "deploy: proxy"
caddy_sum="$(cksum <"$STACK_DIR/Caddyfile" | awk '{ print $1 }')"
if [[ "$(file_get "$STATE_DIR/proxy.env" CADDYFILE_CKSUM)" != "$caddy_sum" ]]; then
  compose up -d --no-deps --force-recreate proxy
  printf 'CADDYFILE_CKSUM=%s\n' "$caddy_sum" >"$STATE_DIR/proxy.env"
else
  compose up -d --no-deps proxy
fi

if [[ -f "$CURRENT_STATE" && "$cur_sha" != "$sha" ]]; then
  mv "$CURRENT_STATE" "$PREVIOUS_STATE"
fi
write_state "$CURRENT_STATE" "$sha" "$new_api" "$new_web" "$new_db"
printf '%s deploy %s -> %s\n' "$(date -u +%FT%TZ)" "${cur_sha:-inicial}" "$sha" >>"$STATE_DIR/history.log"
finished=1
log "deploy: $sha no ar"
