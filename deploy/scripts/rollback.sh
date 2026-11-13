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
prev_sha="$(file_get "$PREVIOUS_STATE" SHA)"
prev_api="$(file_get "$PREVIOUS_STATE" API_IMAGE)"
prev_web="$(file_get "$PREVIOUS_STATE" WEB_IMAGE)"
prev_db="$(file_get "$PREVIOUS_STATE" DB_IMAGE)"
[[ -n "$prev_sha" && -n "$prev_api" && -n "$prev_web" && -n "$prev_db" ]] ||
  die "state/previous.env incompleto"

log "rollback: $cur_sha -> $prev_sha"
for ref in "$prev_api" "$prev_web" "$prev_db"; do ensure_image "$ref"; done

key=""
if [[ "$restore_db" == 1 ]]; then
  bucket="$(require_env BACKUP_S3_BUCKET)"
  # O mais recente pre-deploy-<sha anterior> (as chaves começam pela data).
  key="$(s3 s3api list-objects-v2 --bucket "$bucket" --prefix "$(backup_base)pre-deploy/" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' |
    grep -E -- "-pre-deploy-${prev_sha}\.dump$" | sort | tail -n 1 || true)"
  [[ -n "$key" ]] || die "não achei o backup pre-deploy-$prev_sha no Spaces"
  log "rollback: restaurando $key"
  if ! "$SCRIPT_DIR/restore.sh" --no-start "$key"; then
    # O banco atual não mudou: a versão no ar volta a responder.
    compose up -d --no-deps api || true
    die "a restauração falhou; nada mudou ($cur_sha continua no ar)"
  fi
fi

if [[ "$(file_get "$CURRENT_STATE" DB_IMAGE)" != "$prev_db" ]]; then
  log "rollback: imagem do banco -> $prev_db"
  DB_IMAGE="$prev_db" compose up -d --wait --no-deps db
fi

export API_IMAGE="$prev_api" WEB_IMAGE="$prev_web" DB_IMAGE="$prev_db"
log "rollback: painel"
publish_static_image web "$prev_web"
log "rollback: API"
compose up -d --no-deps api
wait_api_healthy || die "a API ($prev_api) não respondeu 200 em /health em ${HEALTH_TIMEOUT}s"

mv "$CURRENT_STATE" "$STATE_DIR/rollback.tmp"
mv "$PREVIOUS_STATE" "$CURRENT_STATE"
mv "$STATE_DIR/rollback.tmp" "$PREVIOUS_STATE"
printf '%s rollback %s -> %s%s\n' "$(date -u +%FT%TZ)" "$cur_sha" "$prev_sha" \
  "${key:+ (banco: $key)}" >>"$STATE_DIR/history.log"
log "rollback: $prev_sha no ar"
