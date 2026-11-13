# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@alocidadao/api...
# Dependências de produção + dist de cada pacote, sem devDependencies.
RUN pnpm --filter @alocidadao/api deploy --prod /out/api \
 && pnpm --filter @alocidadao/db deploy --prod /out/db \
 && cp -r packages/db/data /out/db/data
# O lockfile liga o drizzle-orm ao expo-sqlite (usado só pelo app mobile): esses peers opcionais
# trazem ~800 MB de React Native que a API não carrega. Removemos do store antes de copiar.
RUN for d in /out/api /out/db; do \
      find $d/node_modules/.pnpm -mindepth 1 -maxdepth 1 \( -name 'expo*' -o -name '@expo+*' -o -name 'react-native*' -o -name '@react-native+*' -o -name 'hermes*' -o -name 'react-devtools*' -o -name 'metro*' \) -exec rm -rf {} + ; \
    done

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3333
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /out/api /app/apps/api
# Os scripts de banco ficam em /app/packages/db/dist (migrate, seed-dev, create-admin, import-municipalities).
COPY --from=build --chown=node:node /out/db /app/packages/db
USER node
EXPOSE 3333
CMD ["node", "dist/server.js"]
