# Alô Cidadão

Plataforma para comunicação entre prefeituras e cidadãos: o cidadão registra irregularidades pelo app, a prefeitura atribui a uma equipe, o agente executa em campo e o cidadão confirma o atendimento.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `apps/api` | API REST — Node.js, Fastify, Zod |
| `apps/web` | Painel administrativo — React, Vite |
| `apps/mobile` | App do cidadão e do agente — React Native, Expo |
| `packages/shared` | Perfis, status, transições e schemas Zod usados por todas as camadas |
| `packages/db` | Esquema Drizzle, migrações, Row-Level Security e `withContext` |
| `packages/api-client` | Cliente HTTP tipado usado pelo web e pelo mobile |
| `packages/config` | Configurações compartilhadas de TypeScript |
| `docs` | Documentação técnica (planejamento, decisões, guias) |

## Requisitos

- Node.js 22+
- pnpm 9 (`corepack enable`)
- Docker (Postgres + PostGIS local)

## Começando

```bash
pnpm install
pnpm build            # compila os pacotes compartilhados
pnpm db:up            # sobe o Postgres + PostGIS local (porta 5433)
pnpm db:migrate       # aplica as migrações
pnpm dev              # API (3333), web (5173) e Expo
```

Copie os `.env.example` de `apps/api`, `apps/web` e `apps/mobile` para `.env` e ajuste. Para testar o app em aparelho físico, use o IP da sua máquina em `EXPO_PUBLIC_API_URL`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm typecheck` | Verifica tipos em todos os pacotes |
| `pnpm test` | Roda os testes (os de `packages/db` precisam do banco: `pnpm db:up`) |
| `pnpm db:generate` | Gera migração a partir de mudanças em `packages/db/src/schema.ts` |
| `pnpm build` | Gera os builds |
| `pnpm format` | Formata o código com Prettier |

Decisões de arquitetura ficam em `docs/decisoes/`.

Dependências do app mobile devem ser adicionadas com `npx expo install <pacote>` dentro de `apps/mobile`, para manter versões compatíveis com o SDK do Expo.
