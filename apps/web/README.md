# Painel da prefeitura (`@alocidadao/web`)

Painel WEB do Alô Cidadão (React + Vite). Telas em `docs/superpowers/specs/2026-10-26-telas-painel-pencil.md`; decisões em `docs/superpowers/plans/2026-10-26-painel-5a.md`; visual em `docs/design-system.md` (seção "Painel WEB").

## Como rodar

Na raiz do monorepo:

1. Banco e armazenamento (Docker): `pnpm infra:up`.
2. Migrações: `pnpm db:migrate`.
3. Dados de demonstração: `pnpm db:seed:dev`. Para voltar a demo ao começo (atividades do agente, triagem de exemplo e mapa limpos), `pnpm db:seed:dev --reset`. Pode rodar quantas vezes quiser.
4. API em `http://localhost:3333`: `pnpm --filter @alocidadao/api dev`. Ela lê `apps/api/.env` (copie de `apps/api/.env.example`).
5. Painel em `http://localhost:5173`: `pnpm --filter @alocidadao/web dev`.

O navegador fala só com o Vite. O proxy de `vite.config.ts` manda `/api/*` para a API (sem o prefixo) e reescreve o caminho do cookie de renovação de `/auth/panel` para `/api/auth/panel`, para o cookie `ac_panel_refresh` (`HttpOnly`, `SameSite=Strict`) valer na mesma origem. Por isso `VITE_API_URL` tem padrão `/api` (veja `.env.example`); não aponte para `http://localhost:3333` direto. Em produção, sirva a API no mesmo prefixo de `VITE_API_URL` ou reescreva o `Path` do cookie.

## Entrar

O código de verificação de desenvolvimento é o valor de `AUTH_DEV_FIXED_CODE` em `apps/api/.env` (no exemplo, `123456`). Sem ele, o código sai no log da API.

| Quem                              | CPF           | O que vê                                                         |
| --------------------------------- | ------------- | ---------------------------------------------------------------- |
| Gestor (Carlos Demo, setor Obras) | `52998224725` | Só as ocorrências das categorias de Obras                        |
| Admin da prefeitura (Rita Demo)   | `39053344705` | Tudo, inclusive Lixo e entulho e Poda de árvore (Limpeza Urbana) |

A equipe interna entra pelo mesmo login e vai para `/backoffice/prefeituras`:

| Quem                                 | CPF           | O que faz                                                                                                           |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Admin da plataforma (Admin Demo)     | `11144477735` | Vê as prefeituras, cria (`Nova prefeitura`), ativa, suspende e reativa, e entra no painel de qualquer uma           |
| Suporte da plataforma (Suporte Demo) | `86288366757` | Vê as prefeituras e entra no painel pelo modo suporte; não cria, ativa, suspende nem reativa (API 403 `admin_only`) |

Quem entra em `/backoffice/*` sem papel interno volta para `/mapa`. No backoffice, `Entrar no painel da prefeitura` (ou `Gerenciar`) abre o painel na prefeitura escolhida com a faixa do modo suporte; ela fica em `sessionStorage` (`ac_support_tenant`) e `Sair da prefeitura` volta ao detalhe. Cada chamada que altera dados nesse modo fica em `staff_audit_events` e aparece em "Últimas ações da equipe Alô Cidadão".

Para subir o web contra uma API em outra porta, use `API_PROXY_TARGET` (por exemplo `API_PROXY_TARGET=http://localhost:3334 pnpm --filter @alocidadao/web dev`, com a API iniciada com `PORT=3334`).

## Testar a revisão, os impedimentos e o cadastro

O `--reset` do seed deixa duas atividades aguardando revisão (uma há 30 h, a 8 m do local; outra há 3 h, a 250 m) e um impedimento (falta de material), sem foto. Para ver a W3 e a W4, entre como Carlos Demo (gestor) ou Rita Demo (admin) e abra "Aguardando revisão" e "Impedimentos". O mesmo `--reset` desfaz o que a passada fez (publicar, devolver, reatribuir, reagendar).

Para a revisão com fotos, o agente conclui uma atividade no app, no emulador `AloCidadao_API36` (`~/Library/Android/sdk/emulator/emulator -avd AloCidadao_API36`, login `+5511900000001`, `S3_PUBLIC_ENDPOINT` do emulador): iniciar, tirar as fotos e concluir leva a atividade a "Aguardando revisão" com as fotos pendentes. Para um impedimento novo, o agente registra o impedimento da atividade no app. As fotos só abrem no navegador com `S3_PUBLIC_ENDPOINT` em `http://localhost:9000`. Só o admin vê `Categorias` e a aba `Gestores`; o gestor recebe 403 `admin_only` nessas rotas.

## Observações de desenvolvimento

- As miniaturas das fotos usam `S3_PUBLIC_ENDPOINT` da API. O exemplo aponta para o emulador Android (`http://10.0.2.2:9000`); para ver as fotos no navegador, use `http://localhost:9000` (e volte ao do emulador para testar o app).
- O console mostra avisos do estilo do mapa ("Expected value to be of type number, but found null instead." e imagens do sprite ausentes). Vêm do estilo `liberty` do OpenFreeMap, não do painel.

## Testes

- `pnpm --filter @alocidadao/web test`: lógica e componentes com `@testing-library/react` e o cliente da API simulado. O mapa (MapLibre) não roda no `jsdom`; só as funções de estilo dele têm teste.
- `pnpm --filter @alocidadao/web typecheck`.
