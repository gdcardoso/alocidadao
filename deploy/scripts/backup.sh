#!/usr/bin/env bash
# Backup do banco no Spaces.
#   backup.sh pre-deploy-<sha>   -> pre-deploy/<data>-pre-deploy-<sha>.dump (guarda os 5 últimos)
#   backup.sh daily              -> daily/<data>-daily.dump (guarda os 14 últimos)
# Imprime a chave do arquivo (relativa ao bucket) na saída. Sai ≠ 0 se o dump ou o envio falhar.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

label="${1:-}"
[[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || die "uso: backup.sh <rótulo> (ex.: daily, pre-deploy-<sha>)"

if [[ "$label" == pre-deploy* ]]; then
  category=pre-deploy
  keep=5
else
  category=daily
  keep=14
fi

bucket="$(require_env BACKUP_S3_BUCKET)"
key="$(backup_base)$category/$(date -u +%Y%m%dT%H%M%SZ)-$label.dump"

work="$(mktemp -d "${TMPDIR:-/tmp}/alocidadao-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT

log "backup: pg_dump do banco"
# shellcheck disable=SC2016 # expandidas dentro do container
compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$work/db.dump"
[[ -s "$work/db.dump" ]] || die "backup: o pg_dump saiu vazio"
# Confere que o arquivo é um dump legível antes de enviar.
compose exec -T db pg_restore --list <"$work/db.dump" >/dev/null || die "backup: dump ilegível"

log "backup: enviando para s3://$bucket/$key"
WORK_DIR="$work" s3 s3 cp --only-show-errors /work/db.dump "s3://$bucket/$key" ||
  die "backup: o envio ao Spaces falhou"

# Retenção: apaga os mais antigos da categoria além de $keep (as chaves começam pela data).
# Uma falha aqui só avisa: o backup já está no Spaces.
if keys="$(s3 s3api list-objects-v2 --bucket "$bucket" --prefix "$(backup_base)$category/" \
  --query 'Contents[].Key' --output text)"; then
  old="$(printf '%s\n' "$keys" | tr '\t' '\n' | grep -E '\.dump$' | sort |
    awk -v keep="$keep" '{ k[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print k[i] }' || true)"
  while IFS= read -r k; do
    [[ -n "$k" ]] || continue
    log "backup: apagando o antigo $k"
    s3 s3 rm --only-show-errors "s3://$bucket/$k" || log "aviso: não apaguei $k"
  done <<<"$old"
else
  log "aviso: não consegui listar os backups para a retenção"
fi

printf '%s\n' "$key"
