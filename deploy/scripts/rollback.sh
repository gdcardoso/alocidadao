#!/usr/bin/env bash
# Volta para a versão anterior (state/previous.env).
#   rollback.sh                 só troca as imagens (API, painel, db)
#   rollback.sh --restore-db    antes, restaura o backup pre-deploy-<sha anterior>, tirado
#                               logo antes da versão desfeita migrar. APAGA o que foi gravado
#                               depois dele. Use quando a versão desfeita tiver migração.
# Depois do rollback, current e previous trocam de lugar (rodar de novo desfaz o rollback,
# sem --restore-db).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

restore_db=0
case "${1:-}" in
  "") ;;
  --restore-db) restore_db=1 ;;
  *) die "uso: rollback.sh [--restore-db]" ;;
esac

acquire_lock
trap release_lock EXIT

[[ -f "$CURRENT_STATE" ]] || die "nada no ar (sem state/current.env)"
[[ -f "$PREVIOUS_STATE" ]] || die "sem versão anterior (state/previous.env)"

cur_sha="$(file_get "$CURRENT_STATE" SHA)"
cur_api="$(file_get "$CURRENT_STATE" API_IMAGE)"
cur_web="$(file_get "$CURRENT_STATE" WEB_IMAGE)"
cur_db="$(file_get "$CURRENT_STATE" DB_IMAGE)"
prev_sha="$(file_get "$PREVIOUS_STATE" SHA)"
prev_api="$(file_get "$PREVIOUS_STATE" API_IMAGE)"
prev_web="$(file_get "$PREVIOUS_STATE" WEB_IMAGE)"
prev_db="$(file_get "$PREVIOUS_STATE" DB_IMAGE)"
[[ -n "$prev_sha" && -n "$prev_api" && -n "$prev_web" && -n "$prev_db" ]] ||
  die "state/previous.env incompleto"

swap_state() {
  mv "$CURRENT_STATE" "$STATE_DIR/rollback.tmp"
  mv "$PREVIOUS_STATE" "$CURRENT_STATE"
  mv "$STATE_DIR/rollback.tmp" "$PREVIOUS_STATE"
}
running_api() {
  local id
  id="$(compose ps -q api 2>/dev/null || true)"
  [[ -n "$id" ]] && docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || echo "nenhuma"
}
# Sobe a API com as imagens dadas e espera o /health. Não sai em caso de erro.
try_api() {
  API_IMAGE="$1" DB_IMAGE="$2" compose up -d --no-deps api && API_IMAGE="$1" DB_IMAGE="$2" wait_api_healthy
}

key=""
db_restored=0 # o banco já foi trocado pelo backup (esquema da versão anterior)
api_touched=0 # a API foi parada (restore) ou trocada
db_changed=0
web_changed=0
finished=0
on_exit() {
  local status=$? api_state="fora do ar"
  if [[ "$finished" == 0 ]]; then
    [[ "$status" != 0 ]] || status=1
    if [[ "$db_restored" == 1 ]]; then
      # O banco já está no estado de $prev_sha: a API coerente com ele é a de $prev_sha.
      log "rollback: falhou com o banco JÁ restaurado ($key); tentando concluir com $prev_sha"
      [[ "$db_changed" == 1 ]] || DB_IMAGE="$prev_db" compose up -d --wait --no-deps db || true
      if try_api "$prev_api" "$prev_db"; then
        api_state="ok"
        swap_state
        printf '%s rollback %s -> %s (banco: %s; com erro, ver log)\n' "$(date -u +%FT%TZ)" \
          "$cur_sha" "$prev_sha" "$key" >>"$STATE_DIR/history.log"
        (WEB_IMAGE="$prev_web" publish_static_image web "$prev_web") ||
          log "ERRO: o painel pode não estar em $prev_web"
      else
        # Último recurso: a API de $cur_sha sobre o banco restaurado (pode não bater com o esquema).
        log "ERRO: a API $prev_api não subiu; tentando $cur_api sobre o banco restaurado"
        (WEB_IMAGE="$cur_web" publish_static_image web "$cur_web") || true
        if try_api "$cur_api" "$prev_db"; then api_state="ok, mas o código de $cur_sha roda sobre o banco de $prev_sha"; fi
      fi
    elif [[ "$api_touched$db_changed$web_changed" != 000 ]]; then
      log "rollback: falhou; voltando ao que estava no ar ($cur_sha)"
      if [[ "$db_changed" == 1 ]]; then
        DB_IMAGE="$cur_db" API_IMAGE="$cur_api" compose up -d --wait --no-deps db || log "ERRO: não voltei o db"
      fi
      if try_api "$cur_api" "$cur_db"; then api_state="ok"; fi
      if [[ "$web_changed" == 1 ]]; then
        (WEB_IMAGE="$cur_web" publish_static_image web "$cur_web") || log "ERRO: não voltei o painel"
      fi
    else
      api_state="sem mudança"
    fi
    log "rollback: FALHOU. Estado final:"
    log "  banco: $([[ "$db_restored" == 1 ]] && echo "restaurado de $key" || echo "não restaurado")"
    log "  API rodando: $(running_api) (/health: $api_state)"
    log "  state/current.env: $(file_get "$CURRENT_STATE" SHA)"
  fi
  release_lock
  exit "$status"
}
trap on_exit EXIT

log "rollback: $cur_sha -> $prev_sha"
for ref in "$prev_api" "$prev_web" "$prev_db"; do ensure_image "$ref"; done

if [[ "$restore_db" == 1 ]]; then
  bucket="$(require_env BACKUP_S3_BUCKET)"
  # O mais recente pre-deploy-<sha anterior> (as chaves começam pela data).
  key="$(s3 s3api list-objects-v2 --bucket "$bucket" --prefix "$(backup_base)pre-deploy/" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' |
    grep -E -- "-pre-deploy-${prev_sha}\.dump$" | sort | tail -n 1 || true)"
  [[ -n "$key" ]] || die "não achei o backup pre-deploy-$prev_sha no Spaces"
  log "rollback: restaurando $key"
  api_touched=1 # o restore.sh para a API
  # Se falhar, o restore.sh garante que o banco atual não mudou.
  "$SCRIPT_DIR/restore.sh" --no-start "$key" || die "a restauração falhou; o banco não mudou"
  db_restored=1
fi

if [[ "$cur_db" != "$prev_db" ]]; then
  log "rollback: imagem do banco -> $prev_db"
  db_changed=1
  DB_IMAGE="$prev_db" compose up -d --wait --no-deps db
fi

export API_IMAGE="$prev_api" WEB_IMAGE="$prev_web" DB_IMAGE="$prev_db"
log "rollback: painel"
web_changed=1
publish_static_image web "$prev_web"
log "rollback: API"
api_touched=1
compose up -d --no-deps api
wait_api_healthy || die "a API ($prev_api) não respondeu 200 em /health em ${HEALTH_TIMEOUT}s"

swap_state
printf '%s rollback %s -> %s%s\n' "$(date -u +%FT%TZ)" "$cur_sha" "$prev_sha" \
  "${key:+ (banco: $key)}" >>"$STATE_DIR/history.log"
finished=1
log "rollback: $prev_sha no ar"
