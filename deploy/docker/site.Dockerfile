# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
ARG SITE_API_URL=
ENV SITE_API_URL=$SITE_API_URL
RUN pnpm turbo run build --filter=@alocidadao/site...

FROM busybox:1.37
COPY --from=build /repo/apps/site/dist /srv/site
# Copia os estáticos para o volume compartilhado com o proxy e sai.
CMD ["sh", "-c", "cp -r /srv/site/. /out/"]
