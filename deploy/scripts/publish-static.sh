#!/usr/bin/env bash
# Troca os arquivos estáticos servidos pelo Caddy.
#   publish-static.sh site <sha>      site de apresentação (alocidadao-site:<sha>) -> site-root
#   publish-static.sh apk <arquivo>   APK de homologação -> /app/alocidadao-homolog.apk
# O painel (web) vai junto com a API, pelo deploy.sh.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() { die "uso: publish-static.sh site <sha>  ou  publish-static.sh apk <arquivo.apk>"; }
kind="${1:-}"
arg="${2:-}"
[[ -n "$arg" ]] || usage

acquire_lock
trap release_lock EXIT

case "$kind" in
  site)
    valid_sha "$arg" || die "SHA inválido: $arg"
    ref="$(image_ref site "$arg")"
    ensure_image "$ref"
    log "publicando o site $ref"
    publish_static_image site "$ref"
    printf 'SITE_SHA=%s\nSITE_IMAGE=%s\nPUBLISHED_AT=%s\n' "$arg" "$ref" "$(date -u +%FT%TZ)" \
      >"$SITE_STATE.tmp"
    mv "$SITE_STATE.tmp" "$SITE_STATE"
    ;;
  apk)
    [[ -f "$arg" && -r "$arg" ]] || die "arquivo não encontrado: $arg"
    file="$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")"
    # APK é um zip: começa com "PK".
    [[ "$(head -c 2 "$file")" == PK ]] || die "$arg não parece um APK"
    log "publicando o APK $file"
    # Copia com outro nome e renomeia: quem estiver baixando não pega um arquivo pela metade.
    compose run --rm -T --no-deps -v "$file:/in.apk:ro" files \
      sh -c 'cp /in.apk /apk/.novo.apk && mv /apk/.novo.apk /apk/alocidadao-homolog.apk'
    ;;
  *) usage ;;
esac
log "pronto"
