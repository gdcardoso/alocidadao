# App do cidadão — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cidadão usa o app de verdade, com as telas 0 a 8 do Pencil. Ele:

- entra pelo celular;
- registra uma solicitação com foto, tipo e local, com ou sem rede;
- apoia um relato parecido;
- vê a tela "prefeitura não aderiu";
- acompanha cada solicitação;
- confirma ou contesta o atendimento;
- cuida do perfil.

**Architecture:**

- **API:** ganha rotas `/citizen/*` (só a audiência `app`).
  - A prefeitura de cada ação vem do ponto ajustado, nunca do aparelho.
  - Ler as próprias solicitações em várias prefeituras passa por funções `SECURITY DEFINER` que só devolvem linhas de `app_current_user()`.
  - O resto roda com o contexto da prefeitura da solicitação.
- **Municípios:** uma tabela `municipalities` com os limites do IBGE responde "em que cidade estou" mesmo onde a prefeitura não é cliente.
- **App:** usa Expo Router com dois grupos, entrada e app logado, e um kit de componentes com os tokens do Pencil.
- **Fila offline:** passa a ter tipos de item (ação do agente ou solicitação do cidadão) e marca o usuário dono.

**Tech Stack:**

- Monorepo: TypeScript ~6.0.3 e Zod 4.
- Banco: Drizzle 0.45 e PostgreSQL 17 + PostGIS.
- API: Fastify 5.
- App: Expo SDK 58 com Expo Router, `expo-location`, `expo-camera`, `expo-sqlite`, `expo-font` + `@expo-google-fonts/lexend` e `@expo-google-fonts/source-sans-3`, `lucide-react-native` + `react-native-svg`, `@maplibre/maplibre-react-native` com os tiles do OpenFreeMap.
- Testes: Vitest 5.

**Spec:**

- `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md`, seções 3.1 a 3.3, 4, 5, 6.1 e 8.
- Telas: `docs/superpowers/specs/2026-10-23-telas-cidadao-pencil.md`, extraída de `design/alocidadao.pen`, que é a referência visual.
- Ver também `docs/design-system.md` e a seção "Plano 3" de `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`.

## Decisões deste plano (o spec deixa em aberto)

- **Cidade fora das prefeituras clientes (5c e chip "Você está em"):** tabela `municipalities` com os limites dos 5.570 municípios.
  - Os dados vêm de um script que baixa a malha de qualidade mínima e os nomes da API do IBGE:
    - malha: `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json`;
    - nomes: `https://servicodados.ibge.gov.br/api/v1/localidades/municipios`.
  - O script roda uma vez, à mão. Os testes usam uma tabela de exemplo.
  - Sem a tabela carregada, a 5c aparece sem o nome da cidade e sem o botão de interesse.
  - O Plano 6 reaproveita a tabela para criar prefeituras.
- **Endereço:** vem do aparelho, com `Location.reverseGeocodeAsync`, que é gratuito e não precisa de chave. Ele é opcional: sem rede, fica sem endereço.
- **Mapa do "Ajustar":** MapLibre React Native com o estilo `https://tiles.openfreemap.org/styles/liberty`, sem custo e sem chave. Isso exige um novo build de desenvolvimento.
- **Observação opcional:** o Pencil marca "Adicionar observação" como opcional. `description` passa a ser opcional (até 2000) e é gravada como `''` quando vem vazia.
- **Catálogo de categorias da demo:** os 9 tipos da tela 5, com o ícone Lucide, o grupo e o raio do spec (5.2):

  | Categoria      | Ícone             | Grupo             | Raio |
  | -------------- | ----------------- | ----------------- | ---- |
  | Buraco na via  | `construction`    | `infrastructure`  | 15 m |
  | Iluminação     | `lightbulb`       | `infrastructure`  | 25 m |
  | Lixo e entulho | `trash-2`         | `environment`     | 30 m |
  | Poda de árvore | `trees`           | `environment`     | 20 m |
  | Esgoto         | `droplets`        | `environment`     | 20 m |
  | Calçada        | `footprints`      | `infrastructure`  | 20 m |
  | Sinalização    | `signpost`        | `infrastructure`  | 50 m |
  | Animal         | `paw-print`       | `public_services` | 50 m |
  | Outro          | `circle-ellipsis` | `public_services` | 20 m |

  Semáforo do spec equivale a Sinalização. O catálogo padrão definitivo continua em aberto (spec 11).

- **Status ao apoiar:** a solicitação que apoia uma ocorrência `in_progress` nasce `in_progress`; nas outras ocorrências, nasce `open` (pendência do Plano 3).
- **Cancelar:** se a ocorrência não tem outra solicitação ativa, ela passa a `cancelled` (ação `cancel` da máquina da ocorrência). Se tem, só a solicitação do cidadão sai.
- **Confirmar:** quando nenhuma solicitação ligada continua `awaiting_confirmation`, a ocorrência passa a `completed` (ação `close`).
- **Contestar:** exige um comentário de 3 a 1000 caracteres e aceita até 3 fotos.
  - A solicitação volta a `open` e a ocorrência volta a `triage` (ação `reopen`).
  - As outras solicitações ligadas que estavam `awaiting_confirmation` também voltam a `open`. Cada uma ganha um evento com o comentário `Outro morador informou que o problema continua; a prefeitura vai reavaliar.`
- **O que o cidadão vê de uma ocorrência:**
  - status;
  - número de relatos;
  - nome da equipe (`teams.name`);
  - texto público (`work_orders.public_note`) e data de publicação;
  - fotos da atividade com `review = 'published'`;
  - motivo da recusa.

  Nunca: `agent_note`, comentários de `status_events` que não sejam do próprio cidadão, fotos e nomes de outros cidadãos.

- **Fila offline:**
  - O item ganha `kind` (`work_order_action` ou `create_request`), `userId` e `payload` em JSON.
  - O banco SQLite ganha `PRAGMA user_version`, com migração da versão 0 para a 1.
  - Ao entrar, se o usuário mudou, a fila e o cache do anterior são apagados (pendência do Plano 3).
  - Uma solicitação recusada como `municipality_not_served` ou `category_unavailable` fica na fila como "recusada", com a mensagem da 5c no item. Não há nova tentativa.
- **Laboratório:** sai da navegação normal. Só aparece em `__DEV__`, por um link no fim do Perfil.
- **Endereço da API no app:** `EXPO_PUBLIC_API_URL` é obrigatória no build, sem padrão `10.0.2.2` (pendência). O `.env.example` mantém o valor do emulador.
- **Tela de permissão de localização** (o spec deixa para quem implementa), mostrada antes da 5 quando falta permissão. Textos:
  - título: `Precisamos da sua localização`;
  - explicação: `Ela mostra para a prefeitura onde está o problema e diz qual prefeitura atende o lugar.`;
  - botão: `Permitir localização`;
  - quando a permissão foi negada para sempre, o botão vira `Abrir configurações`.
- **Telas que o Pencil não desenhou** seguem os componentes e tokens do Pencil:
  - lista vazia, carregando e erro;
  - verificação por e-mail (`email_check`);
  - edição de nome, e-mail e celular;
  - contestação;
  - confirmações de cancelar, excluir e sair.
- **Textos dessas telas:**
  - Lista vazia: título `Nenhuma solicitação ainda`; texto `Toque em Nova para avisar a prefeitura sobre um problema.`
  - Verificação por e-mail:
    - título: `Confirme que a conta é sua`;
    - texto: `Este número estava em uma conta sem uso. Enviamos um código para {e-mail mascarado}.`;
    - botão: `Confirmar`;
    - link: `Não tenho acesso a esse e-mail`, que segue para "Quase lá" e cria conta nova.
  - Sair, com itens na fila: `Você tem {n} envio(s) aguardando internet. Se sair agora, eles serão apagados.` Botões: `Sair mesmo assim` e `Ficar`.
  - Excluir conta:
    - título: `Excluir sua conta?`;
    - texto: `Seus dados pessoais serão apagados. As solicitações continuam com a prefeitura, sem seu nome.`;
    - botões: `Excluir conta` e `Cancelar`.
  - Cancelar solicitação: título `Cancelar esta solicitação?`; botões `Cancelar solicitação` e `Voltar`.
  - Contestação: título `O que continua errado?`; campo `Conte o que você viu` (obrigatório); botão `Adicionar foto` (opcional); envio `Enviar`.
- **Tamanhos:** seguem o Pencil, que é mais novo que o `design-system.md`: raios 16, 20 e 28, títulos 24 e 26, legendas 12 a 15. A Task 11 atualiza o `design-system.md`. A barra de status de 62 px do Pencil é só simulação e não entra.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. No app, instalar dependências com `npx expo install` (ver `apps/mobile/AGENTS.md`). Nunca editar `android/` ou `ios/` à mão.
- **Nomes e textos:**
  - Identificadores em inglês.
  - Comentários e mensagens em português.
  - Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
  - Textos das telas copiados do Pencil ou da seção de decisões acima, sem mudar uma vírgula.
- **Isolamento (decisão 0001):**
  - A API conecta como `app_user`.
  - Toda leitura e escrita de dados da prefeitura passa por `withContext` com a prefeitura certa.
  - Funções `SECURITY DEFINER`: `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` e `GRANT EXECUTE ... TO app_user`; leem `app_current_user()` e não recebem id de usuário.
- **Migrações:** não editar 0000–0015. Estruturais com `drizzle-kit generate` (em duas passadas se ele perguntar sobre renomeação); funções, RLS e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Rotas `/citizen/*` usam `requireAuth(['app'])` e conferem conta ativa, como `/me`.
- **Visual (Pencil):**
  - Tokens de cor de `telas-cidadao-pencil.md` seção 3.
  - Títulos em Lexend 600, texto em Source Sans 3 (400, 500, 600).
  - Ícones Lucide.
  - Alvos de toque de pelo menos 44.
  - Todo ícone tocável com `accessibilityLabel`.
  - Respeitar a escala de fonte do sistema sem cortar texto.
- **Limites:** fotos por solicitação `MAX_PHOTOS_PER_REQUEST = 3`; ajuste do local `MAX_LOCATION_ADJUST_M = 200`; conclusão automática em `AUTO_CONFIRM_AFTER_DAYS = 7` (só o texto; o job é do Plano 7).
- **Commits:** mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa.
- Entre as Tasks 1 e 6, `pnpm typecheck` na raiz pode falhar em `apps/mobile`. A Task 6 devolve a raiz inteira ao verde.

## Review Focus

1. **Solicitação offline para cidade não atendida:** ao sincronizar, o item fica "recusado", com a mensagem da 5c, em vez de tentar para sempre ou sumir. Testes `create request outside served tenants is 422 municipality_not_served` (Task 4) e `rejected request stays in the queue with its reason` (Task 9).
2. **Mesma solicitação reenviada:** reenviar a mesma solicitação offline (mesmo `clientActionId`) não cria duas. Teste `resending the same clientActionId returns the first request` na Task 4.
3. **Solicitação de outra pessoa:** ver, cancelar, confirmar ou contestar a solicitação de outro cidadão responde 404, inclusive de outra prefeitura. Teste `other citizen's request is 404 for every action` na Task 5.
4. **O detalhe nunca vaza dados internos:**
   - o relato interno do agente;
   - fotos não publicadas da atividade;
   - fotos de outros cidadãos.

   Teste `detail hides agent note, unpublished photos and other citizens' photos` na Task 5.

5. **Apoiar uma ocorrência que mudou de status:** se ela saiu de triagem e atendimento entre a 5b e o envio, o servidor responde 409 `occurrence_unavailable`, e o app oferece criar uma ocorrência nova. Testes `supporting a closed occurrence is 409` (Task 4) e `occurrence_unavailable falls back to a new occurrence` (Task 9).

---

### Task 1: Contratos do cidadão no `shared`

**Files:**

- Create: `packages/shared/src/citizen.ts`, `packages/shared/src/citizen.test.ts`
- Modify: `packages/shared/src/schemas.ts` (`createRequestInputSchema`), `packages/shared/src/schemas.test.ts`, `packages/shared/src/index.ts`

**Interfaces:**

- Produces:
  - **`createRequestInputSchema`** passa a ter:
    - `clientActionId: uuid`;
    - `description: string trim max 2000, opcional` (sai o mínimo de 10);
    - `occurredAt: iso datetime`;
    - o resto como hoje.
  - **`categoryOptionSchema`:** `{ id, name, icon: string|null, iconGroup: IconGroup }`.
  - **`locateQuerySchema`:** `{ lat, lng }`, com coerção de string para número.
  - **`locateResponseSchema`**, união por `status`:
    - `{ status: 'served', tenant: { id, displayName, city, state, centralPhone: string|null }, categories: CategoryOption[] }`
    - `{ status: 'not_served', municipality: { ibgeCode, name, state } | null }`
  - **`similarQuerySchema`:** `{ lat, lng, categoryId }`.
  - **`similarOccurrenceSchema`:** `{ occurrenceId, categoryName, icon, iconGroup, distanceM: int, reportCount: int, status: 'triage'|'in_progress' }`.
  - **`createRequestResponseSchema`:** `{ requestId, protocol, status: RequestStatus, duplicate: boolean }`.
  - **`requestListFilterSchema`:** `'all' | 'active' | 'done'`.
    - `active` = `open`, `in_progress` e `awaiting_confirmation`.
    - `done` = `completed`, `cancelled` e `rejected`.
  - **`requestCardSchema`:** `{ id, protocol, status, categoryName, icon, iconGroup, address: string|null, createdAt, statusChangedAt }`.
  - **`requestDetailSchema`:**
    - Dados: `{ id, protocol, status, statusChangedAt, createdAt, categoryName, icon, iconGroup, address, description, location }`.
    - `photos: PhotoView[]`.
    - `team: { name } | null`.
    - `completion: { publicNote, publishedAt, photos: PhotoView[] } | null`.
    - `rejection: { reason, at } | null`.
    - `timeline: { status: RequestStatus, at }[]`.
    - `PhotoView` = `{ url, takenAt }`.
  - **`requestActionBodySchema`:** `{ clientActionId: uuid }` (cancelar e confirmar).
  - **`contestBodySchema`:** `{ clientActionId: uuid, comment: string trim 3..1000, photoKeys: string[] max 3 }`.
  - **`cityInterestBodySchema`:** `{ ibgeCode: /^[0-9]{7}$/ }`.
  - **`uploadResponseSchema`:** `{ key, url, headers: Record<string,string> }`.
  - **`requestFilterStatuses(filter): readonly RequestStatus[]`.**

- [ ] **Step 1: Write the failing tests**
  - `createRequestInputSchema accepts a missing description` and `rejects description over 2000`.
  - `locateResponseSchema discriminates served and not_served`.
  - `requestFilterStatuses maps filters to statuses`: `active` → os três abertos; `done` → os três finais; `all` → os seis.
  - `contestBodySchema requires a comment of at least 3 characters`.
  - `cityInterestBodySchema rejects codes that are not 7 digits`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → FAIL.
- [ ] **Step 3:** Implementar e exportar. Atualizar os usos de `createRequestInputSchema` que o typecheck apontar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/shared test` e `pnpm --filter @alocidadao/shared typecheck` → PASS.
- [ ] **Step 5:** Commit: `Contratos do app do cidadão no shared`.

---

### Task 2: Municípios, leitura das próprias solicitações e catálogo da demo no banco

**Files:**

- Modify: `packages/db/src/schema.ts`, `packages/db/src/geo.ts`, `packages/db/src/index.ts`, `packages/db/src/seed-dev-data.ts`, `packages/db/package.json` (script `db:import:municipalities`)
- Create:
  - `packages/db/src/citizen.ts`, `packages/db/src/citizen.test.ts`
  - `packages/db/src/import-municipalities.ts` (CLI), `packages/db/src/municipalities.ts` (parse e insert, testáveis), `packages/db/src/municipalities.test.ts`, `packages/db/src/test/fixtures/municipios.geojson` (2 municípios pequenos inventados)
  - Migrações: uma gerada e uma custom `citizen_functions`

**Interfaces:**

- Produces:
  - **Tabela `municipalities`** (global, sem `tenant_id`):
    - Colunas: `ibge_code char(7) pk` com CHECK `^[0-9]{7}$`, `name text not null`, `state char(2) not null`, `boundary multipolygon 4326 not null`.
    - Índice gist em `boundary`.
    - RLS ENABLE + FORCE, com `SELECT` livre para `app_user` (dado público). Não há grant de escrita para `app_user`.
  - **`geo.ts`:** `findMunicipalityAt(tx, point): Promise<{ ibgeCode, name, state } | undefined>`.
  - **`municipalities.ts`:**
    - `parseIbgeMunicipalities(geojson: unknown, names: unknown): Array<{ ibgeCode, name, state, geometry: GeoJSON MultiPolygon }>`. Polygon vira MultiPolygon. O código vem de `properties.codarea`. Nome e UF vêm da API de localidades: `id`, `nome` e `microrregiao.mesorregiao.UF.sigla`, ou `regiao-imediata...UF.sigla` quando a primeira faltar.
    - `upsertMunicipalities(ownerDb, rows)`.
  - **CLI `pnpm db:import:municipalities`:** baixa as duas URLs das decisões, chama o parse e grava como dono (`DATABASE_OWNER_URL`).
  - **Migração custom `citizen_functions`:**
    - Política `requests_citizen_select ON requests FOR SELECT TO app_user USING (citizen_id = app_current_user())`. Ela se soma à `tenant_isolation`, e é ela que permite ao cidadão listar as próprias solicitações em todas as prefeituras.
    - `citizen_list_requests(p_statuses text[]) RETURNS TABLE (id uuid, tenant_id uuid, protocol text, status text, category_name text, icon text, icon_group text, address text, created_at timestamptz, status_changed_at timestamptz)`:
      - `SECURITY DEFINER`, só para `citizen_id = app_current_user()`.
      - Ordena primeiro as `awaiting_confirmation`, depois por `status_changed_at desc`.
    - `citizen_request_tenant(p_request_id uuid) RETURNS uuid`: devolve o `tenant_id` só se a solicitação é de `app_current_user()`; senão, nulo.
  - **`citizen.ts`:** `listOwnRequests(tx, statuses)` e `ownRequestTenant(tx, requestId)`, que rodam com `withContext({ userId })`.
  - **Seed:** a prefeitura demo ganha:
    - os 9 tipos da tabela das decisões, no setor demo, com `icon`, `icon_group` e `cluster_radius_m`;
    - a linha de `municipalities` `9999901` "Cidade Demo", "SP", com o mesmo limite da prefeitura;
    - um município vizinho inventado `9999902` "Vila Sem Adesão", "SP", com um quadrado ao lado, sem prefeitura, para testar a 5c no emulador.

    O seed continua idempotente. O "Buraco na via" que já existe ganha os campos novos.

- [ ] **Step 1: Write the failing tests**
  - `municipalities.test.ts`:
    - `parseIbgeMunicipalities junta malha e nomes`: com a fixture, devolve 2 linhas com código, nome, UF e MultiPolygon.
    - `findMunicipalityAt acha o município do ponto e nada fora dele`.
  - `citizen.test.ts`:
    - `cidadão lista só as próprias solicitações, de todas as prefeituras`: duas prefeituras e dois cidadãos; A vê as dele nas duas e nenhuma de B.
    - `filtro por status`.
    - `aguardando confirmação vem primeiro`.
    - `ownRequestTenant devolve nulo para solicitação alheia`.
    - `app_user não grava em municipalities`.
  - Teste do seed: as 9 categorias existem com ícone e raio, e os dois municípios existem.
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3:** Implementar. Rodar `pnpm db:migrate` e `pnpm db:seed:dev` no banco local. Rodar o import real uma vez (`pnpm db:import:municipalities`) e registrar no relatório quantos municípios entraram e quanto tempo levou. Se a rede do IBGE falhar, registrar e seguir: o import é opcional.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test` e `pnpm --filter @alocidadao/db typecheck` → PASS; `pnpm --filter @alocidadao/api test` continua verde.
- [ ] **Step 5:** Commit: `Municípios do IBGE, leitura das próprias solicitações e catálogo da demo`.

---

### Task 3: Localização, ocorrências parecidas, envio de foto e interesse por cidade na API

**Files:**

- Create: `apps/api/src/citizen/routes.ts` (registro do grupo), `apps/api/src/citizen/locate.ts`, `apps/api/src/citizen/locate.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/storage/s3.ts` (+ `newRequestPhotoKey(userId)` e `presignGet(key, seconds)`, se não existir)

**Interfaces:**

- Consumes: Task 1 (schemas), Task 2 (`findMunicipalityAt`, categorias com ícone); `findActiveTenantAt` e `findSimilarOccurrences` de `packages/db/src/geo.ts`; `requireAuth` e a conferência de conta ativa de `apps/api/src/me/routes.ts`. Se essa conferência estiver presa às rotas `/me`, ela vai para `apps/api/src/auth/active-user.ts`.
- Produces:
  - **`GET /citizen/locate?lat&lng`** → `locateResponseSchema`.
    - Prefeitura ativa no ponto: `served`, com as categorias `active` em ordem de nome.
    - Senão, `not_served` com `findMunicipalityAt` (ou `null`).
  - **`GET /citizen/similar?lat&lng&categoryId`** → `similarOccurrenceSchema[]`.
    - A prefeitura vem do ponto; ponto sem prefeitura dá 422 `municipality_not_served`.
    - Roda `findSimilarOccurrences` no contexto da prefeitura.
  - **`POST /citizen/uploads`** → `uploadResponseSchema`. A chave vem de `newRequestPhotoKey(userId)` = `requests/<userId>/<yyyy>/<uuid>.jpg`, e a URL assinada de PUT vale 10 min. Sem armazenamento configurado: 503 `storage_not_configured`.
  - **`POST /citizen/city-interest { ibgeCode }`** → 204, idempotente (ignora a chave repetida). Código desconhecido em `municipalities`: 404 `municipality_not_found`.
  - `registerCitizenRoutes(app, deps)` é chamado em `app.ts` quando `auth` e `database` existem. As Tasks 4 e 5 acrescentam rotas nele.

- [ ] **Step 1: Write the failing tests** em `locate.test.ts` (banco de teste real, token pelo `startSession`):
  - `locate inside the demo tenant returns served with active categories`: categoria inativa fica fora.
  - `locate in a municipality without tenant returns not_served with its name`.
  - `locate outside every municipality returns not_served with null`.
  - `suspended tenant counts as not served`.
  - `similar returns nearby open occurrences without citizen data`: nenhuma chave da resposta fala de cidadão (`citizen`, `name`, `photo`).
  - `similar outside served tenants is 422`.
  - `uploads returns a key under the user's prefix`.
  - `city interest is idempotent and 404 for unknown code`.
  - `panel token is refused` (401).
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `API do cidadão: localização, relatos parecidos, envio de foto e interesse por cidade`.

---

### Task 4: Criar solicitação (online e da fila offline)

**Files:**

- Create: `apps/api/src/citizen/create-request.ts`, `apps/api/src/citizen/create-request.test.ts`
- Modify: `apps/api/src/citizen/routes.ts`

**Interfaces:**

- Consumes: Task 1 (`createRequestInputSchema`, `createRequestResponseSchema`); Task 3 (rotas e chaves de foto); `applyOccurrenceAction` e `CLUSTERABLE_OCCURRENCE_STATUSES` do `shared`; `client_actions` e `isUniqueViolation`, como em `apps/api/src/dev/work-orders.ts`.
- Produces: **`POST /citizen/requests`** → 201 `createRequestResponseSchema`. Repetição → 200 com a resposta guardada e `duplicate: true`. Passos:
  1. A prefeitura vem de `findActiveTenantAt(location)`, o ponto ajustado. Sem prefeitura: 422 `{ code: 'municipality_not_served', municipality }`, com o município de `findMunicipalityAt` ou `null`.
  2. Em `withContext({ tenantId, userId })`:
     - Se `client_actions` já tem `clientActionId`, devolve a resposta guardada (`duplicate: true`).
     - Categoria inexistente ou inativa: 422 `category_unavailable`.
  3. Cada `photoKey` precisa começar com `requests/<userId>/` e existir no armazenamento (`storage.head`). Senão: 422 `photo_missing`.
  4. Com `occurrenceId`, a ocorrência precisa ser da mesma categoria e estar em `CLUSTERABLE_OCCURRENCE_STATUSES`; senão, 409 `occurrence_unavailable`. A solicitação nasce `in_progress` se a ocorrência está `in_progress`; senão, `open`.
  5. Sem `occurrenceId`, cria uma ocorrência nova em `triage`, no ponto ajustado, mesmo quando há outra parecida. Agrupar fica com o gestor (spec 4).
  6. Grava a solicitação: protocolo pelo default do banco; `description` ou `''`; `gps_location`; `location`; `address`; `created_at` = `occurredAt`.
  7. Grava as fotos (`photos.request_id`, `uploaded_by`), um `status_events` (`to_status` = status inicial, `connection` do corpo) e a resposta em `client_actions`, tudo na mesma transação.

- [ ] **Step 1: Write the failing tests** em `create-request.test.ts`:
  - `creates request and a new triage occurrence`: protocolo no formato `^[0-9]{4}-[0-9]{6}$`, status `open`, uma foto gravada, um evento.
  - `supporting an in_progress occurrence starts in_progress`.
  - `supporting a closed occurrence is 409` (ocorrência `completed`).
  - `resending the same clientActionId returns the first request`: 2 chamadas, 1 solicitação, `duplicate: true` na segunda.
  - `create request outside served tenants is 422 municipality_not_served`: a resposta traz o município.
  - `category from another tenant is 422 category_unavailable`.
  - `photo key of another user is 422 photo_missing`.
  - `location more than 200 m from GPS is 400`.
  - `empty description is stored as empty text`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `Criar solicitação: prefeitura pelo ponto, apoio a relato e repetição segura`.

---

### Task 5: Lista, detalhe, cancelar, confirmar e contestar

**Files:**

- Create: `apps/api/src/citizen/requests.ts`, `apps/api/src/citizen/requests.test.ts`
- Modify: `apps/api/src/citizen/routes.ts`

**Interfaces:**

- Consumes: Task 2 (`listOwnRequests`, `ownRequestTenant`); Task 1 (`requestCardSchema`, `requestDetailSchema`, `contestBodySchema`, `requestFilterStatuses`); `applyRequestAction` e `applyOccurrenceAction` do `shared`; `storage.presignGet`.
- Produces:
  - **`GET /citizen/requests?filter=all|active|done`** → `requestCardSchema[]`, pela função `citizen_list_requests`.
  - **`GET /citizen/requests/:id`** → `requestDetailSchema`.
    - `ownRequestTenant`; nulo dá 404 `request_not_found`.
    - Depois, `withContext({ tenantId, userId })` lê:
      - a solicitação e a categoria;
      - as fotos da própria solicitação;
      - a equipe da atividade ativa ou da última atividade concluída da ocorrência;
      - `completion`, só com `status` em `awaiting_confirmation` ou `completed`: `public_note`, `published_at` e as fotos da atividade com `review = 'published'`;
      - `rejection`: `occurrences.rejection_reason` e a data do evento `rejected`;
      - `timeline`: os eventos dessa solicitação, só `to_status` e `created_at`.
    - URLs das fotos: `presignGet` com validade de 15 min.
  - **`POST /citizen/requests/:id/cancel { clientActionId }`** → `requestCardSchema`. Fora de `open`: 409 `invalid_status`. Regra da ocorrência conforme as decisões.
  - **`POST /citizen/requests/:id/confirm { clientActionId }`** → `requestCardSchema`. Fora de `awaiting_confirmation`: 409.
  - **`POST /citizen/requests/:id/contest`** (`contestBodySchema`) → `requestCardSchema`. Fora de `awaiting_confirmation`: 409. As fotos seguem as mesmas regras da Task 4. Efeitos conforme as decisões.
  - As três ações gravam `status_events` (com o comentário, na contestação), atualizam `status_changed_at` e são idempotentes por `clientActionId` (`client_actions`).

- [ ] **Step 1: Write the failing tests** em `requests.test.ts`:
  - `list filters active and done across tenants`.
  - `detail of an open request has only the citizen's photos and the open timeline`.
  - `detail hides agent note, unpublished photos and other citizens' photos`. Monte uma ocorrência com dois cidadãos, uma atividade concluída com `agent_note`, uma foto `published` e uma `discarded`, e confira:
    - o texto do agente não aparece em lugar nenhum do JSON;
    - só a foto publicada aparece em `completion.photos`;
    - a foto do outro cidadão não aparece.
  - `rejected request shows the public reason`.
  - `cancel last request cancels the occurrence; with another request the occurrence stays`.
  - `confirm completes the occurrence when nobody else is awaiting`.
  - `contest reopens occurrence and other awaiting requests with the notice`: a outra solicitação volta a `open`, e o evento dela traz o texto exato das decisões; a já confirmada continua `completed`.
  - `other citizen's request is 404 for every action`: detalhe, cancelar, confirmar e contestar.
  - `repeating an action with the same clientActionId is harmless`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `Solicitações do cidadão: lista, detalhe, cancelar, confirmar e contestar`.

---

### Task 6: Base visual do app e cliente da API do cidadão

**Files:**

- Modify:
  - `apps/mobile/package.json`, `apps/mobile/app.config.ts` (ícone e splash com `design/marca/vetor/icone-app-1024.png` e a logo; plugin do MapLibre), `apps/mobile/.env.example`
  - `apps/mobile/src/lib/api.ts` (sem padrão `10.0.2.2`; erro claro se faltar `EXPO_PUBLIC_API_URL`)
  - `packages/api-client/src/index.ts` (métodos do cidadão e de `/me`)
- Create:
  - `apps/mobile/assets/` (cópias de `logo-1200.png`, `abertura.png` e do ícone)
  - `apps/mobile/src/ui/theme.ts`
  - `apps/mobile/src/ui/fonts.ts`
  - componentes em `apps/mobile/src/ui/` (lista abaixo)
  - `apps/mobile/src/ui/format.ts`, `apps/mobile/src/ui/format.test.ts`
  - `apps/mobile/src/ui/category.ts`, `apps/mobile/src/ui/category.test.ts`

**Interfaces:**

- Produces:
  - **`theme.ts`:**
    - `colors`: os 22 tokens da seção 3 da extração do Pencil, mais os literais usados (`openNotice: '#F1F5F9'`, `scrim: '#0F172A8C'`, `photoOverlay: '#0F172AB3'`, `photoGradientEnd: '#0F172AD9'`, `glass: '#FFFFFFF2'`, `galleryText: '#CBD5E1'`, `sheetHandle: '#CBD5E1'`).
    - `fonts`: `heading: 'Lexend_600SemiBold'`, `headingMedium: 'Lexend_500Medium'`, `body: 'SourceSans3_400Regular'`, `bodyMedium: 'SourceSans3_500Medium'`, `bodySemibold: 'SourceSans3_600SemiBold'`.
    - `radius`: `{ check: 6, digit: 14, field: 16, card: 20, pill: 999 }`.
    - `space`: `{ gutter: 20, gutterAuth: 24, section: 24 }`.
  - **Componentes** (props mínimas, todos com `accessibilityLabel` quando são só ícone):
    - `Screen`: fundo `bg` e área segura.
    - `Header`: Voltar ou Fechar de 44, título e subtítulo.
    - `PrimaryButton`, `SecondaryButton` e `TextButton`: variantes `danger` e `outlinePrimary`; estados `loading` e `disabled` (opacidade 0,45).
    - `TextField`: rótulo, `required`/`optional`, ajuda e erro.
    - `CodeInput`: 6 caixas.
    - `Checkbox`.
    - `Chip`: filtro e cidade.
    - `StatusBadge`.
    - `CategoryIcon`: quadrado de 48 ou círculo de 44.
    - `CategoryOption`.
    - `RequestCard`.
    - `PhotoStack`.
    - `Timeline`.
    - `StatusNotice`.
    - `TeamReport`.
    - `BottomSheet`.
    - `TabBar`.
    - `Footer`.
    - `ConfirmDialog`.
  - **`format.ts`:**
    - `formatPhoneBR('+5511987654321')` → `'(11) 98765-4321'`.
    - `parsePhoneInput('(11) 98765-4321')` → `'+5511987654321'`.
    - `maskPhoneInput(digits)` (máscara durante a digitação).
    - `formatElapsed(status, since, now)`, ex.: `'Aberta há 3 dias'`, `'Em atendimento há 2 dias'`, `'Aberta hoje'`.
    - `formatDateTime(iso)` → `'20 out 2026, 08:12'`.
    - `formatShortDate(iso, now)` → `'Hoje, 08:12'`, ou `'18 out'` no mesmo ano.
    - `initials('Maria da Silva')` → `'MS'`.
    - `firstName`.
    - Fuso: `America/Sao_Paulo`.
  - **`category.ts`:**
    - `categoryIcon(name: string | null)` → componente Lucide, com `CircleEllipsis` quando o nome é desconhecido.
    - `groupColors(iconGroup)` → `{ bg, fg }`.
    - `statusBadge(status)` → `{ label, icon, bg, fg }`, conforme o selo de status da extração. A lista mostra `awaiting_confirmation` como `Aguardando sua confirmação`; o resto usa `REQUEST_STATUS_LABELS`.
  - **`api-client`:**
    - Cidadão: `locate`, `similar`, `createUpload`, `createRequest`, `listRequests`, `getRequest`, `cancelRequest`, `confirmRequest`, `contestRequest`, `cityInterest`.
    - Perfil: `updateMe`, `phoneChangeStart`, `phoneChangeVerify`, `deleteMe` e `registerDevice`.
    - Cada um valida a resposta com o schema do `shared`. Não sobrescreve o `init.signal` de quem chama: combina com o sinal do tempo limite (pendência).

- [ ] **Step 1: Write the failing tests**
  - `format.test.ts`, com os exemplos acima (inclusive `'Aberta hoje'` no mesmo dia e o fuso de São Paulo perto da meia-noite UTC).
  - `category.test.ts`: `unknown icon falls back to CircleEllipsis` e `statusBadge for every RequestStatus`.
  - Testes do `api-client`: `createRequest parses the response` e `caller signal aborts the request`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` e `pnpm --filter @alocidadao/api-client test` → FAIL.
- [ ] **Step 3:** Instalar as dependências com `npx expo install` e implementar. O mapa só entra no Step 3 da Task 9, mas o plugin já vai no `app.config.ts` agora, para um único build nativo. Fazer um novo build de desenvolvimento (`npx expo run:android`) e confirmar que o app abre.
- [ ] **Step 4:** Raiz: `pnpm typecheck`, `pnpm test`, `pnpm lint` e `pnpm format:check` → verdes.
- [ ] **Step 5:** Commit: `Base visual do app e cliente da API do cidadão`.

---

### Task 7: Entrada — telas 0, 1, 2, 3 e verificação por e-mail

**Files:**

- Create:
  - `apps/mobile/src/auth/session-context.tsx` (provedor React sobre `native-session`)
  - `apps/mobile/src/auth/login-flow.ts` e `apps/mobile/src/auth/login-flow.test.ts`
  - `apps/mobile/src/app/(auth)/_layout.tsx`, `entrar.tsx`, `codigo.tsx`, `quase-la.tsx`, `confirmar-email.tsx`
  - `apps/mobile/src/app/abertura.tsx`
  - `apps/mobile/src/lib/register-device.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/index.tsx` (redireciona pela sessão)

**Interfaces:**

- Consumes: Task 6 (componentes, formatação, `api-client`); `native-session.ts` (`session`, `signOutAndClear`).
- Produces:
  - **`login-flow.ts`** (puro, testável):
    - `nextStepAfterVerify(response) → { route: '/(app)' } | { route: '/(auth)/quase-la', signupToken } | { route: '/(auth)/confirmar-email', recoveryChallengeId, maskedEmail, signupToken }`.
    - `errorMessage(code)`, com estas mensagens:
      - `code_invalid` → `Código incorreto. Confira e tente de novo.`
      - `code_expired` → `O código venceu. Peça um novo.`
      - `code_locked` → `Muitas tentativas. Peça um novo código.`
      - `code_rate_limited` e `rate_limited` → `Aguarde {n} s para pedir outro código.`
      - `phone_in_use` → `Este número já tem uma conta. Volte e entre de novo.`
      - `email_in_use` → `Este e-mail já está em uso. Deixe em branco ou use outro.`
      - `sms_not_configured` → `Não foi possível enviar o SMS agora. Tente mais tarde.`
      - qualquer outro → `Algo deu errado. Tente de novo.`
  - **`SessionProvider` / `useSession()`:** `{ status: 'loading'|'signedOut'|'signedIn', me: MeResponse | null, refreshMe(), signIn(tokens), signOut(opts) }`. Na abertura, lê o token guardado e chama `me`; 401 leva a `signedOut`.
  - **Telas:**
    - **0 (`abertura`):** só enquanto `status = 'loading'`.
    - **1 (`entrar`):**
      - `+55` fixo, máscara do celular, teclado `phone-pad`.
      - No Android, oferece o número do chip com `expo-phone-number-hint`, ou equivalente sem custo, se existir para o SDK 58. Se não existir, fica de fora e isso vai para o relatório.
      - "Continuar" fica ativo só com 11 dígitos.
    - **2 (`codigo`):**
      - Contador de reenvio a partir de `resendInSeconds`.
      - "Confirmar" fica ativo com 6 dígitos.
      - Erro abaixo das caixas.
      - "Alterar número" volta para a 1.
    - **3 (`quase-la`):** nome (obrigatório, 2 caracteres ou mais), e-mail (opcional) e aceite dos Termos; manda `TERMS_VERSION`.
    - **`confirmar-email`:** textos das decisões.
  - **`registerDevice()`:** depois do login e a cada abertura logada, chama `PUT /me/devices/:installationId` com plataforma, versão e `pushToken`, quando `registerForPush` consegue um. Falha de push não impede nada.
  - **Usuário anterior:** no login, se o `userId` difere do dono guardado da fila, chama `clearOfflineData()` antes de seguir. O dono vai na chave `outbox-owner` do SecureStore (pendência do Plano 3).

- [ ] **Step 1: Write the failing tests** em `login-flow.test.ts`:
  - `nextStepAfterVerify routes each status`.
  - `errorMessage covers every API code and falls back`.
  - `rate limit message uses retryAfterSeconds`.
  - `switching user clears offline data`, com `clearOfflineData` falso.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador, com o código fixo `123456`:
  - entrar com `+5511900000002` (cidadão da demo);
  - criar uma conta nova com `+5511911112222`;
  - comparar 0, 1, 2 e 3 com o Pencil.

  Capturar as telas (`adb exec-out screencap -p`) e guardá-las fora do git, em `apps/mobile/.screenshots/`, que vai no `.gitignore`.

- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Telas de entrada: abertura, celular, código, Quase lá e verificação por e-mail`.

---

### Task 8: Minhas solicitações (4), abas e Perfil (8)

**Files:**

- Create:
  - `apps/mobile/src/app/(app)/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/_layout.tsx` (com `TabBar`), `(tabs)/index.tsx` (4), `(tabs)/perfil.tsx` (8)
  - `apps/mobile/src/app/(app)/perfil/nome.tsx`, `perfil/email.tsx`, `perfil/celular.tsx`, `perfil/celular-codigo.tsx`
  - `apps/mobile/src/citizen/use-current-place.ts`, `apps/mobile/src/citizen/requests-view.ts`, `apps/mobile/src/citizen/requests-view.test.ts`
- Modify: `apps/mobile/src/app/laboratorio/*` (só o caminho; a tela não muda)

**Interfaces:**

- Consumes: Tasks 6 e 7; `api.listRequests`, `api.locate`, `api.updateMe`, `api.phoneChangeStart`, `api.phoneChangeVerify`, `api.deleteMe`; `signOutAndClear`; a contagem de itens da fila (`outboxStore.list()`).
- Produces:
  - **`requests-view.ts`:**
    - `toCardModel(card, now)` → `{ title, address, badge, meta: '2026-000123 · Hoje, 08:12', needsAction: boolean, href }`.
    - `needsAction` é verdadeiro em `awaiting_confirmation`; nesse caso o cartão tem borda `warning` 2 e o botão "Ver atendimento e confirmar".
    - O `href` é `/(app)/solicitacao/<id>`.
  - **Tela 4:**
    - Cabeçalho com "Olá, {primeiro nome}", título e chip "Você está em {cidade}" (de `locate` pela posição atual; sem permissão ou sem cidade, o chip fica de fora).
    - Filtros "Todas", "Em andamento" e "Concluídas" (`all`, `active`, `done`).
    - Puxar para atualizar. Estados de lista vazia, carregando e erro, com os textos das decisões.
    - Itens da fila offline (solicitações ainda não enviadas) aparecem no topo:
      - selo `Aguardando internet`, com ícone `wifi-off` em `warning-soft`;
      - os recusados mostram o motivo (5c ou tipo indisponível) e o botão `Remover`.
  - **`TabBar`:** "Solicitações", "Nova" (abre `/(app)/nova`) e "Perfil".
  - **Tela 8:**
    - Avatar com as iniciais, nome e celular formatado.
    - Seção Conta: Nome → `perfil/nome`; Celular → `perfil/celular`, que reaproveita `CodeInput` e as mensagens da Task 7; E-mail → `perfil/email`. Uma resposta 403 `email_managed_by_admin` mostra `O e-mail da sua conta do painel é alterado pelo administrador.`
    - Seção Sobre: Termos e Política abrem `https://alocidadao.com.br/termos` e `https://alocidadao.com.br/privacidade` no navegador.
    - Seção Sessão: "Sair da conta", com o aviso das decisões quando há itens na fila.
    - "Excluir minha conta", com a confirmação das decisões.
    - Em `__DEV__`, um link "Laboratório" no fim.
  - **Modo agente:** a troca entre cidadão e agente no Perfil fica para o Plano 4. Aqui, `me.agentTenants` não muda nada.

- [ ] **Step 1: Write the failing tests** em `requests-view.test.ts`:
  - `awaiting confirmation needs action and links to detail`.
  - `meta joins protocol and short date`.
  - `queued request shows waiting badge; rejected shows reason`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador e comparar 4 e 8 com o Pencil (capturas como na Task 7).
- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Minhas solicitações, abas e Perfil`.

---

### Task 9: Nova solicitação — 5, 5b, 5c, permissão, mapa e fila offline

**Files:**

- Create:
  - `apps/mobile/src/app/(app)/nova.tsx` (5 + 5b), `(app)/nao-atende.tsx` (5c), `(app)/permissao-local.tsx`, `(app)/ajustar-local.tsx` (mapa)
  - `apps/mobile/src/components/photo-capture.tsx` (sai de `laboratorio/camera.tsx`, pendência)
  - `apps/mobile/src/citizen/new-request.ts`, `apps/mobile/src/citizen/new-request.test.ts`
  - `apps/mobile/src/citizen/place-cache.ts`
- Modify:
  - `apps/mobile/src/offline/outbox.ts`, `outbox.test.ts`, `sqlite-outbox-store.ts`, `http-transport.ts`, `http-mapping.ts`, `http-mapping.test.ts`
  - `apps/mobile/src/offline/use-outbox-sync.ts`: sai da tela do Laboratório e passa a rodar no `(app)/_layout.tsx` (pendência)
  - `apps/mobile/src/app/laboratorio/*`: passa a usar o novo `photo-capture` e o item com `kind`

**Interfaces:**

- Consumes: Tasks 3 a 8; `getCurrentPoint`, `compressPhoto` e `stashPhoto` do app.
- Produces:
  - **Fila (`outbox.ts`):**
    - `OutboxItem` passa a `{ id, kind: 'work_order_action' | 'create_request', userId, payload: unknown, photoPaths, photoKeys, createdOffline, status: 'pending'|'sending'|'done'|'conflict'|'failed'|'rejected', rejection: { code, municipality? } | null, attempts, nextAttemptAt, lastError, createdAt }`.
    - Payload `work_order_action`: `{ workOrderId, action, occurredAt, note }`.
    - Payload `create_request`: `CreateRequestInput` sem `photoKeys` e `connection`, que entram no envio.
    - `Transport` ganha `sendCreateRequest(input): Promise<{ kind: 'ok'; result } | { kind: 'rejected'; code; municipality? } | { kind: 'occurrence_unavailable' }>`.
    - Envio de solicitação:
      - `municipality_not_served` e `category_unavailable` (422) marcam `rejected`, sem nova tentativa.
      - `occurrence_unavailable` (409) refaz o envio uma vez sem `occurrenceId`. Na fila offline isso não acontece, porque o offline nunca manda `occurrenceId`.
      - 408 e 429 na foto e na solicitação viram nova tentativa (pendência).
    - Toda função de envio e de upload usa o tempo limite de 30 s (pendência).
  - **SQLite:** `PRAGMA user_version` 1, com a migração da versão 0 (tabela antiga) que converte os itens existentes para `kind = 'work_order_action'`, `userId` = o dono guardado ou `''`. O Laboratório continua funcionando.
  - **`new-request.ts`** (puro):
    - `canSubmit(draft)`: pelo menos 1 foto e um tipo escolhido.
    - `buildCreateInput(draft, now, ids)`.
    - `limitAdjust(gps, candidate)`: devolve o ponto mais perto do candidato dentro de 200 m.
    - `decideFlow(online, locate, similar)`:
      - `'not_served'` → 5c;
      - `'pick_similar'` → 5b, quando online, na prefeitura e com parecida;
      - `'submit'` → envia;
      - `'queue'` → sem rede.
  - **Tela 5:**
    - Pede permissão (`permissao-local`) se faltar.
    - Abre a câmera do `photo-capture`: até 3 fotos, contador "1 de 3", remover.
    - Local: endereço do `reverseGeocodeAsync` (sem endereço, mostra as coordenadas com 5 casas) e botão "Ajustar" para `ajustar-local`. O mapa limita o pino a 200 m do GPS e avisa `O ponto pode ficar a até 200 m de onde a foto foi tirada.`
    - Tipos: com rede, os de `locate`; sem rede, os do `place-cache` (a última prefeitura).
    - Observação abre um campo de até 2000 caracteres.
    - "Enviar solicitação" segue `decideFlow`. A fila sempre envia as fotos antes da solicitação.
    - Fechar com dados preenchidos pede confirmação: `Descartar esta solicitação?`, com os botões `Descartar` e `Continuar editando`.
  - **5b:** `BottomSheet` com a mais próxima de `similar`: "A {n} m de você", "{n} pessoas relataram" e o selo do status.
    - "É o mesmo, apoiar relato" envia com `occurrenceId`.
    - "Não, é outro problema" envia sem.
  - **5c:** cidade e UF do `municipality`.
    - Sem município, título `Sua cidade ainda não usa o Alô Cidadão` e o texto sem o nome.
    - "Ligar para 156" abre `tel:156`, ou o `centralPhone` quando houver.
    - "Quero o Alô Cidadão aqui" chama `cityInterest`. Depois, o botão vira `Pedido registrado` desativado. Sem município, o botão não aparece.
  - **Depois do envio:** online, vai ao detalhe da solicitação nova; na fila, volta à 4, com o item no topo.

- [ ] **Step 1: Write the failing tests**
  - `outbox.test.ts`:
    - `create_request uploads photos then sends the request`.
    - `rejected request stays in the queue with its reason`.
    - `occurrence_unavailable falls back to a new occurrence`.
    - `408 and 429 retry later`.
    - Os testes atuais de `work_order_action` continuam passando.
  - `new-request.test.ts`:
    - `limitAdjust keeps points within 200 m and clamps farther ones` (o resultado fica a 200 m ± 1 do GPS, na mesma direção).
    - `decideFlow chooses not_served, pick_similar, submit and queue`.
    - `canSubmit needs a photo and a category`.
  - Migração da fila: `migrates version 0 items to work_order_action`, com o adaptador de SQLite que os testes já usam, ou com a função pura de conversão de linha.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador:
  - registrar com foto dentro da demo;
  - registrar perto de um buraco da demo e apoiar pela 5b;
  - mover o GPS do emulador para a "Vila Sem Adesão" (`adb emu geo fix <lng> <lat>`) e ver a 5c com o nome;
  - modo avião: registrar, ver o item na 4, reconectar e ver o envio.

  Comparar 5, 5b e 5c com o Pencil.

- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Nova solicitação: foto, tipo, local, relato parecido, cidade sem adesão e fila offline`.

---

### Task 10: Detalhe (6a–6d), galeria (7) e contestação

**Files:**

- Create:
  - `apps/mobile/src/app/(app)/solicitacao/[id].tsx`, `(app)/solicitacao/[id]/contestar.tsx`, `(app)/galeria.tsx`
  - `apps/mobile/src/citizen/detail-view.ts`, `apps/mobile/src/citizen/detail-view.test.ts`

**Interfaces:**

- Consumes: Task 5 (detalhe e ações); Task 6 (`StatusNotice`, `PhotoStack`, `Timeline`, `TeamReport`, `ConfirmDialog`).
- Produces:
  - **`detail-view.ts`** (puro): `toDetailModel(detail, now)` → `{ notice: { tone: 'open'|'progress'|'awaiting'|'rejected'|'done', icon, title, text }, before: PhotoView[], after: PhotoView[] | null, report: {...} | null, facts: [...], steps: TimelineStep[], footer: 'cancel'|'confirm_contest'|null }`. Os textos vêm do Pencil:
    - **6a:** título `Aberta há {n} dias` (pelo `formatElapsed`); texto `Aguardando a prefeitura analisar e encaminhar para uma equipe. Você recebe um aviso a cada mudança.`
    - **6b:**
      - título `Em atendimento há {n} dias`;
      - texto `A {equipe} está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído.`;
      - sem equipe, `A prefeitura está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído.`
    - **6c:** título `A prefeitura concluiu o atendimento`; texto `Confira as fotos e diga se o problema foi resolvido. Sem resposta, confirmamos automaticamente em 7 dias.`
    - **6d:** título `Solicitação recusada`; texto `Veja abaixo o motivo informado pela prefeitura.`
    - **Concluída:** tom `done`, título `Concluída`, texto `Obrigado por confirmar. Esta solicitação foi encerrada.`
    - **Cancelada:** tom `open`, título `Cancelada`, texto `Você cancelou esta solicitação.`
    - **Andamento:** etapas "Aberta", "Em atendimento", "Conclusão pela equipe" (que vira "Concluída pela equipe" quando concluída) e "Sua confirmação", com os detalhes do Pencil e as datas da `timeline`. A recusada mostra só "Aberta" e "Recusada".
  - **Tela de detalhe:**
    - Rodapé `cancel` (só em `open`) → `ConfirmDialog` → `cancelRequest`.
    - Rodapé `confirm_contest` (em `awaiting_confirmation`): "Sim, foi resolvido" → `confirmRequest`; "Não foi resolvido" → `contestar`.
    - Recarrega depois de cada ação.
    - As ações de cancelar, confirmar e contestar exigem rede. Sem rede, mostram `Sem internet. Tente de novo quando conectar.` e não entram na fila.
  - **`galeria`:** recebe as fotos e o índice por parâmetro.
    - Carrossel horizontal, contador "1 de 3" e indicadores.
    - Legenda "Sua foto · abertura" ou "Depois do atendimento".
    - Data e endereço.
    - Dica "Deslize para ver as outras fotos".
  - **`contestar`:** textos das decisões. Envia `contestRequest` com as fotos pela mesma rota de upload.

- [ ] **Step 1: Write the failing tests** em `detail-view.test.ts`:
  - `open request shows elapsed notice, cancel footer and the open step current`.
  - `in progress names the team or falls back`.
  - `awaiting confirmation shows before and after, report and confirm footer`.
  - `rejected shows reason and two steps`.
  - `completed and cancelled have no footer`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador:
  - ver uma solicitação aberta e cancelar;
  - pôr uma solicitação da demo em `awaiting_confirmation` pelo banco (como dono, com uma foto `published` e um `public_note`), ver a 6c e a galeria, contestar e confirmar outra;
  - ver uma recusada.

  Comparar 6a a 6d e 7 com o Pencil.

- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Detalhe da solicitação, galeria e contestação`.

---

### Task 11: Design system, pendências e passada final no emulador

**Files:**

- Modify: `docs/design-system.md`, `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`, `docs/planejamento-mvp.md`

- [ ] **Step 1:** Em `docs/design-system.md`:
  - registrar os valores que o Pencil usa: raios, escala de 12 a 26, pesos 500, tokens `on-brand-*`, literais de sobreposição e "Aberta" com `#F1F5F9`;
  - registrar que o gradiente sobre foto e o escurecimento do painel são exceções permitidas;
  - registrar a barra de abas flutuante;
  - trocar "opções de categoria com 56" pela grade de 100.
- [ ] **Step 2:** Em `spikes-pendencias.md`:
  - marcar `[x]` os itens do Plano 3 resolvidos:
    - endereço da API;
    - título repetido (some com as telas novas);
    - comentário interno do agente fora do detalhe;
    - status ao apoiar;
    - aviso antes de sair;
    - telas de entrada;
    - registro do aparelho;
    - fila por usuário;
    - `init.signal`;
    - 408 e 429;
    - tempo limite;
    - `useOutboxSync` no layout;
    - `PhotoCapture` fora da rota.
  - Os demais itens do Plano 3 continuam em aberto e passam para o Plano 4 ou o Plano 8, conforme o assunto.
  - Acrescentar no Plano 6: usar `municipalities` ao criar prefeitura.
  - Acrescentar no Plano 7: avisos por push nas mudanças de status do cidadão; conclusão automática em 7 dias.
- [ ] **Step 3:** Em `planejamento-mvp.md`, na lista "Planos do MVP", marcar o Plano 3 como feito.
- [ ] **Step 4:** Passada final no emulador, do zero:
  - desinstalar o app;
  - abertura → entrar com número novo → Quase lá → lista vazia;
  - nova solicitação com 2 fotos;
  - lista → detalhe → galeria;
  - perfil: editar nome;
  - sair → entrar de novo com o mesmo número: as solicitações continuam lá.

  Registrar o resultado em `docs/superpowers/plans/2026-10-23-app-do-cidadao.md`, numa seção "Resultado no emulador" no fim, com data e o que falhou, se algo falhou.

- [ ] **Step 5:** `pnpm format:check` → PASS. Commit: `Design system e pendências após o app do cidadão`.
