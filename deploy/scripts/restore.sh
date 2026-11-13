#!/usr/bin/env bash
# Restaura um backup do Spaces no banco da homologação.
#   restore.sh [--no-start] <chave-no-spaces>
# A chave é a impressa pelo backup.sh (ex.: pre-deploy/20261113T120000Z-pre-deploy-abc1234.dump).
# Para a API, restaura num banco novo e só então troca pelo atual (o anterior fica como
# <banco>_anterior até a próxima restauração) e sobe a API de novo (exceto com --no-start).
# APAGA o que foi gravado depois do backup.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

start_api=1
if [[ "${1:-}" == --no-start ]]; then
  start_api=0
  shift
fi
key="${1:-}"
[[ "$key" =~ ^[A-Za-z0-9._/-]+\.dump$ && "$key" != *..* ]] ||
  die "uso: restore.sh [--no-start] <chave-no-spaces> (ex.: daily/20261113T031500Z-daily.dump)"

acquire_lock
work="$(mktemp -d "${TMPDIR:-/tmp}/alocidadao-restore.XXXXXX")"
api_stopped=0
finished=0
cleanup() {
  rm -rf "$work"
  # Falhou com a API parada e sem trocar o banco: sobe a API de novo no banco atual.
  if [[ "$finished" == 0 && "$api_stopped" == 1 && "$start_api" == 1 ]]; then
    log "restore: falhou; subindo a API de novo no banco atual"
    compose up -d --no-deps api || true
  fi
  release_lock
}
trap cleanup EXIT

bucket="$(require_env BACKUP_S3_BUCKET)"
log "restore: baixando s3://$bucket/$key"
WORK_DIR="$work" s3 s3 cp --only-show-errors "s3://$bucket/$key" /work/db.dump ||
  die "restore: não consegui baixar o backup"
compose exec -T db pg_restore --list <"$work/db.dump" >/dev/null || die "restore: dump ilegível"

log "restore: parando a API"
compose stop api
api_stopped=1

# SQL pelo stdin, no container do banco, com o dono (superusuário) pelo socket local.
# :db, :tmpdb e :olddb são variáveis do psql (nomes citados com :"..." e textos com :'...').
db_sql() {
  # shellcheck disable=SC2016 # expandidas dentro do container
  compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d postgres \
    -v db="$POSTGRES_DB" -v owner="$POSTGRES_USER" \
    -v tmpdb="${POSTGRES_DB}_restaurando" -v olddb="${POSTGRES_DB}_anterior"'
}

db_sql <<'SQL'
DROP DATABASE IF EXISTS :"tmpdb" WITH (FORCE);
CREATE DATABASE :"tmpdb" OWNER :"owner";
SQL

log "restore: pg_restore num banco novo"
# shellcheck disable=SC2016
compose exec -T db sh -c 'pg_restore --clean --if-exists --exit-on-error --single-transaction \
  -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restaurando"' <"$work/db.dump" ||
  die "restore: pg_restore falhou; o banco atual não mudou"

log "restore: trocando o banco atual pelo restaurado"
db_sql >/dev/null <<'SQL'
DROP DATABASE IF EXISTS :"olddb" WITH (FORCE);
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE :"db" RENAME TO :"olddb";
ALTER DATABASE :"tmpdb" RENAME TO :"db";
COMMIT;
SQL
finished=1

if [[ "$start_api" == 1 ]]; then
  log "restore: subindo a API"
  compose up -d --no-deps api
  wait_api_healthy || die "restore: a API não respondeu ao /health em ${HEALTH_TIMEOUT}s"
fi
log "restore: pronto ($key)"
