# Postgres oficial + PostGIS do repositório oficial do PostgreSQL (PGDG).
# Funciona em amd64 e arm64 (a imagem postgis/postgis não tem arm64).
FROM postgres:17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
  && rm -rf /var/lib/apt/lists/*
