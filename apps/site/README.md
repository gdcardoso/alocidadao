# Site (alocidadao.com.br)

Página de apresentação e páginas legais, geradas como HTML estático em `dist/`.

## Build

```sh
pnpm --filter @alocidadao/site build                 # contato com os valores iniciais
SITE_API_URL=http://localhost:3333 pnpm --filter @alocidadao/site build
pnpm --filter @alocidadao/site preview               # serve o dist/
```

Com `SITE_API_URL`, o build lê o contato da rota pública e a página atualiza o contato ao abrir.

## Imagens

Ficam em `public/img/` e vão para `dist/img/` no build.

- `painel-mapa.webp`: captura do mapa do painel (script abaixo).
- `agente-concluir.webp`: tela do app do agente. Por enquanto é a captura do Pencil
  (`docs/superpowers/specs/telas-agente/A3-concluir-atendimento.png`).
- Telas do app do cidadão: sem captura, os celulares são desenhados em HTML (`CITIZEN_LIST` e
  `CITIZEN_DONE` em `src/render.ts`).
- `fotos/iluminacao-poste.webp`: foto de banco (Unsplash) da tela desenhada do serviço concluído. Os
  JPEG originais, usados só por `scripts/demo-scenario.ts`, ficam em `scripts/fixtures/` (fora do
  build), com origem, autor e licença em `scripts/fixtures/CREDITOS.md`.

## Capturas do sistema

Com o banco, o storage e o seed de Goiânia (`pnpm infra:up`, `pnpm db:migrate`,
`pnpm db:seed:dev`) e com a API e o painel web no ar (`pnpm dev`):

```sh
pnpm --filter @alocidadao/site exec playwright install chromium   # uma vez
pnpm --filter @alocidadao/site demo:scenario   # solicitação concluída com foto, pelas rotas da API
pnpm --filter @alocidadao/site capture:panel   # grava public/img/painel-mapa.webp
pnpm --filter @alocidadao/site capture:app     # telas do app, com o simulador iOS ligado
```

- `demo:scenario`: o cidadão do seed relata um buraco no Setor Bueno com foto, o gestor encaminha,
  o agente conclui com a foto do serviço, o gestor publica e o cidadão confirma. Variáveis:
  `API_URL` (padrão `http://localhost:3333`), `DEV_CODE` (padrão `123456`, o
  `AUTH_DEV_FIXED_CODE` da API) e `S3_UPLOAD_ENDPOINT` (padrão `http://localhost:9000`, para
  quando a API assina as fotos com o endereço do emulador Android). Cada execução cria uma
  solicitação nova.
- `capture:panel`: entra como o gestor do seed, aceita os Termos se pedir, aproxima o mapa de
  Goiânia e grava a imagem a 1440×900 (em 2x, reduzida para 2160×1350). Variáveis: `PANEL_URL`
  (padrão `http://localhost:5173`), `DEV_CODE` e `CWEBP` (padrão `cwebp`; `brew install webp`).
- `capture:app`: sem simulador, sai explicando o passo manual. Com ele, pede cada tela e grava
  `cidadao-lista.webp`, `cidadao-concluida.webp` e `agente-concluir.webp`; depois troque
  `CITIZEN_LIST` e `CITIZEN_DONE` em `src/render.ts` pelas imagens.

O login por código tem intervalo de reenvio por conta: rodar `demo:scenario` e `capture:panel`
seguidos pode responder 429 (`code_rate_limited`). Espere um minuto e rode de novo.
