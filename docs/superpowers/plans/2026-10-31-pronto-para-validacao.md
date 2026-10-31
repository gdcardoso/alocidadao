# Pronto para validação — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o sistema pronto para a equipe testar em aparelhos reais e demonstrar a uma prefeitura. O gestor passa a ver no mapa a situação do prazo e os números do dia. O painel filtra por bairro a partir de uma lista consolidada. A prefeitura lê os próprios dados. A P3 do backoffice ganha as seis abas, com a lista de cidadãos mascarada pela API. Entram também as correções que aparecem na demonstração.

**Architecture:**

- **Bairros no banco.** A malha do IBGE fica em `ibge_neighborhoods`, um dado de referência por município, como `municipalities`. A camada enviada pela prefeitura fica em `tenant_neighborhoods`, com RLS. A função `effective_neighborhoods(tenant)` escolhe entre as duas. Um gatilho em `occurrences` grava `neighborhood` (o nome) sempre que a ocorrência nasce ou muda de ponto, e `refresh_occurrence_neighborhoods(tenant)` recalcula a prefeitura inteira depois de uma carga.
- **Prazo calculado num lugar só.** `deadlineStatusSql()` em `apps/api/src/panel/occurrences.ts` diz a situação de cada ocorrência a partir da atividade ativa. O mapa, a rota de números e o filtro usam essa mesma expressão. O web só recebe o valor pronto.
- **Backoffice reaproveita o painel.** As abas só leitura da P3 chamam `loadTeams`, `loadManagers` e `loadCategories` com uma identidade de admin montada a partir da equipe interna. Os dados da prefeitura para o painel vêm de uma função `SECURITY DEFINER`, porque `tenant_contracts` só é lido pela equipe.

**Tech Stack:** o mesmo dos planos anteriores. Nenhuma dependência nova no repositório. A conversão do arquivo do IBGE para GeoJSON é feita uma vez, à mão, com `npx mapshaper` (passo descrito na Task 1).

**Spec:** `docs/superpowers/specs/2026-10-31-pronto-para-validacao-design.md`, aprovado em 31/10/2026. Ver também `docs/superpowers/specs/2026-10-26-telas-painel-pencil.md` (W1), `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md` (P3) e `docs/decisoes/0001-isolamento-por-prefeitura.md`.

## Decisões deste plano (além do spec)

- **Situação do prazo** (`DEADLINE_STATUSES` no `shared`): `none`, `on_time`, `due_soon` e `overdue`, com `DUE_SOON_DAYS = 2`. O `due_at` é gravado às 23:59:59 de Brasília do dia escolhido (`dueAtFor`, `apps/api/src/panel/actions.ts:60`). A regra, em SQL, vale para a ocorrência `in_progress` com atividade ativa (`ACTIVE_WORK_ORDER_STATUSES`) e usa a mais recente:
  - sem atividade ativa, ou `due_at` nulo → `none`
  - `due_at < now()` → `overdue`
  - `(due_at AT TIME ZONE 'America/Sao_Paulo')::date - (now() AT TIME ZONE 'America/Sao_Paulo')::date <= DUE_SOON_DAYS` → `due_soon`
  - qualquer outro caso → `on_time`
- **Cores do pino** (o MapLibre não lê variáveis CSS, então as cores repetem os tokens em `map-style.ts`):
  - `none`: `#64748B` (`--text-secondary`)
  - `on_time`: o `--success` do painel
  - `due_soon`: `PIN_COLORS.warning`
  - `overdue`: `PIN_COLORS.danger`
  - O grupo de pinos usa a pior situação: `clusterProperties` com `max` sobre o peso 0 a 3 na ordem acima.
- **Textos novos** (aprovar o plano aprova estes textos):
  - Legenda: "Situação do prazo"; "No prazo"; "Vence em até 2 dias"; "Atrasada"; "Na triagem (sem prazo)"; "Número = relatos no ponto".
  - Faixa: "Na triagem"; "Em atendimento"; "Vencem em 2 dias"; "Atrasadas".
  - Filtro de prazo: "Prazo: todos"; "No prazo"; "Vencendo"; "Atrasadas".
  - Etiqueta do ponto: "Vence hoje"; "Vence amanhã"; "Vence em {n} dias"; "Atrasada há 1 dia"; "Atrasada há {n} dias"; "Atrasada hoje" (o dia do prazo é hoje e a hora já passou, o que não acontece com `dueAtFor`, mas cobre dado antigo).
  - Filtro de bairro: "Bairro: todos"; "Sem bairro".
  - Dados da prefeitura: título "Dados da prefeitura"; apoio "Para alterar estes dados, fale com o suporte do Alô Cidadão."; blocos "Prefeitura", "Contrato" e "Bairros"; "{n} de {incluídos} incluídos"; "{n} bairros cadastrados · IBGE" / "· enviados pela prefeitura"; "1 bairro cadastrado"; "Nenhum bairro cadastrado"; "Sem contrato cadastrado".
  - P3: abas "Visão geral", "Contrato", "Equipes e agentes", "Gestores", "Categorias", "Cidadãos" e "Auditoria"; "Abrir no painel"; "Salvar contrato"; "Contrato salvo."; "Bairros"; "Carregar arquivo de bairros"; "Voltar para a malha do IBGE"; "Bairros carregados: {n}."; "A prefeitura voltou para a malha do IBGE."; "O arquivo precisa ser GeoJSON com um polígono por bairro e o nome em `nome` ou `name`."; "Voltar para a malha do IBGE?" / "Os bairros enviados pela prefeitura são apagados e as ocorrências são recalculadas."
  - Cidadãos: colunas "Nome", "Celular", "E-mail", "Solicitações", "Abertas", "Última solicitação", "Último acesso" e "Situação"; situações "Ativo", "Inativo" e "Bloqueada"; "Buscar por nome"; "Situação: todas"; "Nenhum cidadão com estes filtros."; "Ninguém fez solicitação nesta cidade ainda."
  - Auditoria: "Consultou os cidadãos", "Editou o contrato", "Carregou os bairros" e "Voltou para a malha do IBGE".
- **Quem pode, no backoffice:** editar o contrato e carregar ou apagar bairros é só do **Admin**, como ativar e suspender. As políticas de `tenant_contracts` (migração 0009) já exigem `app_is_platform_admin()`. _Isto muda o spec, que dizia "Admin e Suporte"._ O Suporte vê a aba Contrato só para leitura. A aba Auditoria aparece só para o Admin, como a P7.
- **Abas da P3 na URL:** `?aba=contrato|equipes|gestores|categorias|cidadaos|auditoria`, e sem parâmetro é a Visão geral. O "Gerenciar" dos cartões leva à aba. "Abrir no painel" usa o `enterAt(path)` que já existe, com `/equipes`, `/equipes/gestores` e `/categorias`.
- **Contrato vigente:** o de `starts_on` mais recente, como em `apps/api/src/backoffice/tenants.ts:183`. Editar o contrato faz `UPDATE` nessa linha, ou `INSERT` se não houver nenhuma.
- **Usuários do painel:** a contagem `panelUserCount` que a P3 já calcula vale também no painel.
- **Celular mascarado:** `maskPhone('+5515991231234')` devolve `(15) •••••-1234`. Número fora do padrão brasileiro (`+55` seguido de 10 ou 11 dígitos) devolve `•••• {4 últimos}`.
- **Situação do cidadão:** `Ativo` quando `last_active_at` é de até 90 dias atrás; `Inativo` quando é mais antigo ou nulo; `Bloqueada` quando `account_status = 'frozen'` e `deleted_at` é nulo. Contas excluídas (`deleted_at` preenchido) não aparecem.
- **Arquivo de bairros:** `FeatureCollection` com `Polygon` ou `MultiPolygon`. O nome vem de `properties.nome`, `properties.name` ou `properties.NM_BAIRRO`. Limites: até 2000 bairros e 10 MB no corpo da rota. Nome vazio ou repetido recusa o arquivo inteiro (`422 invalid_neighborhoods`).

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. Nenhuma dependência nova.
- **Nomes e textos:** valores e código em inglês; textos em português, mapeados no `shared` ou no componente, copiados das Decisões sem mudar uma vírgula. Comentários em português. Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
- **Sem Pencil neste pacote** (decisão do usuário em 31/10): as telas seguem os tokens e componentes de `apps/web/src/ui/*` e o visual atual. Ícones `lucide-react`; botão só com ícone tem `aria-label`.
- **Dado pessoal:** a rota de cidadãos nunca devolve celular, e-mail ou CPF completos, e nunca devolve CPF. O mascaramento acontece na API, antes do schema de resposta.
- **Bairro só da lista consolidada:** nenhum caminho grava `occurrences.neighborhood` a partir do texto do endereço.
- **Isolamento (decisão 0001):** a API conecta como `app_user`. Leitura entre prefeituras ou de dado da equipe só por funções `SECURITY DEFINER` com `SET search_path = public, pg_temp`, `REVOKE ... FROM PUBLIC` e grant só a quem precisa.
- **Migrações:** não editar 0000–0035. Estruturais com `pnpm --filter @alocidadao/db exec drizzle-kit generate`; funções, gatilhos, políticas e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Toda rota declara schema de resposta.
- **Toda ação da equipe interna** grava `insertStaffAudit` na mesma transação.
- **Testes:** web com `@testing-library/react` e cliente simulado (`vi.mock`); API com `buildApp`; banco com `owner`/`app` como em `packages/db/src/rls.test.ts`.
- **Commits:** mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Antes de cada commit rodar `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa.
- **Branch:** `pronto-para-validacao`, no próprio checkout, a partir do `main`.

## Review Focus

1. **Ponto na divisa ou fora de todos os bairros**: o ponto cai na linha entre dois contornos, num buraco da malha ou fora do município. Esperado: um bairro só (o primeiro por nome) ou nulo, nunca erro nem linha duplicada. Teste: `ponto na divisa de dois bairros recebe um só` (Task 1).
2. **Virada do dia em Brasília**: um prazo de hoje consultado às 23h30 de Brasília, quando já é amanhã em UTC. Esperado: continua `due_soon` e "Vence hoje" até 23:59:59 de Brasília, e depois disso fica `overdue`. Testes: `due today at 23:30 São Paulo is due_soon` e `one second after dueAtFor is overdue` (Task 5).
3. **Vazamento por outro caminho**: CPF, celular ou e-mail completos de cidadão saindo pela rota de cidadãos, inclusive por mensagem de erro ou pela busca. Teste: `citizens response never contains full phone, email or any cpf` (Task 10).
4. **Prefeitura sem bairros**: o filtro não pode aparecer e a URL com `?bairro=` velho não pode zerar o mapa. Esperado: o parâmetro é ignorado. Testes: `hides the neighborhood filter when the tenant has none` e `ignores ?bairro when the tenant has no neighborhoods` (Task 4).
5. **Carga de bairros parcial**: um arquivo com um polígono inválido no meio. Esperado: nada é gravado e a camada anterior continua valendo. Testes: `invalid feature rejects the whole file and keeps the old layer` (Task 2) e `ST_MakeValid conserta laço sem derrubar a carga` (Task 1).

---

## Parte A — Bairros

### Task 1: Tabelas, gatilho e importação da malha do IBGE

**Files:**

- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`
- Create: `packages/db/migrations/0036_*.sql` (gerada) e `0037_neighborhoods_access.sql` (`--custom`)
- Create: `packages/db/src/neighborhoods.ts`, `packages/db/src/import-neighborhoods.ts`, `packages/db/src/neighborhoods.test.ts`, `packages/db/src/fixtures/neighborhoods-sample.geojson`
- Modify: `packages/db/package.json` (script `import:neighborhoods`)

**Interfaces:**

- Produces (tabelas):
  - `ibge_neighborhoods (id uuid, ibge_code text check 7 dígitos, code text unique, name text not null, boundary multipolygon 4326 not null)`, com índice GiST em `boundary` e índice em `ibge_code`. Sem RLS, com `GRANT SELECT` ao `app_user`, como `municipalities`.
  - `tenant_neighborhoods (id uuid, tenant_id, name text not null, boundary multipolygon 4326 not null, created_at)`, com `unique (tenant_id, name)` e índice GiST. RLS `FORCE`: `SELECT` para membro da prefeitura (`tenant_id = app_current_tenant()`) ou equipe (`app_is_platform_staff()`); `INSERT` e `DELETE` só com `app_is_platform_admin()`.
  - `occurrences.neighborhood text null` e índice `(tenant_id, neighborhood)`.
- Produces (funções SQL, todas `SECURITY DEFINER`):
  - `effective_neighborhoods(p_tenant uuid) RETURNS TABLE (name text, boundary geometry, source text)`. `source` é `'tenant'` se a prefeitura tem linhas em `tenant_neighborhoods`, senão `'ibge'` (pelo `tenants.ibge_code`).
  - `neighborhood_at(p_tenant uuid, p_point geometry) RETURNS text`: o primeiro nome, em ordem alfabética, cujo contorno cobre o ponto (`ST_Covers`), ou nulo.
  - Gatilho `BEFORE INSERT OR UPDATE OF location ON occurrences` que faz `NEW.neighborhood := neighborhood_at(NEW.tenant_id, NEW.location)`.
  - `refresh_occurrence_neighborhoods(p_tenant uuid) RETURNS int`, que recalcula todas as ocorrências da prefeitura e devolve quantas mudaram. Grant ao `app_user`; dentro, exige `app_is_platform_admin()` ou ser o dono do banco.
  - `replace_tenant_neighborhoods(p_tenant uuid, p_features jsonb) RETURNS int` e `clear_tenant_neighborhoods(p_tenant uuid) RETURNS void`. As duas exigem `app_is_platform_admin()`, trocam a camada numa transação com `ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)))` e chamam `refresh_occurrence_neighborhoods`. `p_features` é `[{ name, geometry }]`.
- Produces (TypeScript, `packages/db/src/neighborhoods.ts`):
  - `parseIbgeNeighborhoods(geojson: unknown): { ibgeCode: string; code: string; name: string; geometry: object }[]`, que lê `CD_MUN`, `CD_BAIRRO` e `NM_BAIRRO`.
  - `upsertIbgeNeighborhoods(db: Database, rows): Promise<void>`, que substitui os bairros dos municípios presentes no arquivo e chama `refresh_occurrence_neighborhoods` para cada prefeitura desses municípios.

- [ ] **Step 1: Testes que falham** (`neighborhoods.test.ts`, com dois quadrados vizinhos no fixture):
  - `ocorrência nasce com o bairro do ponto`
  - `ponto fora de todos os bairros fica sem bairro`
  - `ponto na divisa de dois bairros recebe um só` (o primeiro em ordem alfabética)
  - `mover o ponto recalcula o bairro`
  - `camada da prefeitura vale no lugar da malha do IBGE` e `apagar a camada própria volta para o IBGE`
  - `app_user de outra prefeitura não lê tenant_neighborhoods`
  - `suporte não carrega bairros, admin carrega`
  - `ST_MakeValid conserta laço sem derrubar a carga`
  - `parseIbgeNeighborhoods lê CD_MUN, CD_BAIRRO e NM_BAIRRO`
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test neighborhoods` → FAIL.
- [ ] **Step 3:** Implementar o schema, gerar a 0036 e escrever a 0037. O script `import-neighborhoods.ts` segue `import-municipalities.ts`. Ele recebe o caminho de um GeoJSON por argumento (`pnpm --filter @alocidadao/db import:neighborhoods -- ./BR_bairros.geojson`) e roda com `DATABASE_OWNER_URL`. No comentário do topo, o passo de conversão: baixar a "Malha de Bairros 2022" (por UF ou Brasil) no site de malhas do IBGE e rodar `npx mapshaper BR_bairros_CD2022.shp -proj wgs84 -o format=geojson BR_bairros.geojson`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test` e `pnpm typecheck` → PASS. Rodar `pnpm db:migrate` no banco local e importar ao menos a UF de São Paulo para conferir o tempo e a contagem.
- [ ] **Step 5:** Commit `Bairros: tabelas, gatilho e importação do IBGE`.

### Task 2: Carga de bairros pelo backoffice (API)

**Files:**

- Modify: `packages/shared/src/backoffice.ts` (ações e rótulos de auditoria, schemas)
- Create: `apps/api/src/backoffice/neighborhoods.ts`, `apps/api/src/backoffice/neighborhoods.test.ts`
- Modify: `apps/api/src/backoffice/routes.ts`

**Interfaces:**

- Consumes: `replace_tenant_neighborhoods` e `clear_tenant_neighborhoods` (Task 1); `insertStaffAudit`; `requirePlatformStaff(db, request, reply, ['admin'])`.
- Produces:
  - `STAFF_AUDIT_ACTIONS` ganha `'tenant.neighborhoods_replace'` ("Carregou os bairros") e `'tenant.neighborhoods_reset'` ("Voltou para a malha do IBGE").
  - `neighborhoodsUploadSchema` (GeoJSON `FeatureCollection` validado pelas regras das Decisões) e `neighborhoodsSummarySchema` `{ count: number; source: 'ibge' | 'tenant' | null }`.
  - `PUT /backoffice/tenants/:id/neighborhoods` (corpo GeoJSON, `bodyLimit` de 10 MB) → `200 { count, source: 'tenant' }`; `422 invalid_neighborhoods`; `404 tenant_not_found`.
  - `DELETE /backoffice/tenants/:id/neighborhoods` → `200 { count, source }`, com o resultado da malha do IBGE.
  - `GET /backoffice/tenants/:id/neighborhoods` → `neighborhoodsSummarySchema`, para Admin e Suporte.

- [ ] **Step 1: Testes que falham:**
  - `admin uploads a GeoJSON and occurrences get the neighborhood`
  - `support gets 403 on upload and delete`
  - `invalid feature rejects the whole file and keeps the old layer`
  - `duplicate or empty name returns 422 invalid_neighborhoods`
  - `delete goes back to the IBGE layer`
  - `upload and delete write the staff audit`
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test neighborhoods` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Testes da API e do `shared` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Bairros: carga pelo backoffice`.

### Task 3: Filtro de bairro na API do painel

**Files:**

- Modify: `packages/shared/src/panel.ts`, `packages/shared/src/panel-work.ts`
- Modify: `apps/api/src/panel/occurrences.ts`, `apps/api/src/panel/lists.ts`, `apps/api/src/panel/routes.ts`
- Test: `apps/api/src/panel/occurrences.test.ts`, `apps/api/src/panel/lists.test.ts`

**Interfaces:**

- Produces:
  - `NO_NEIGHBORHOOD = '__none__'` e `neighborhoodFilterSchema = z.string().min(1).max(120).optional()` no `shared`.
  - `neighborhood` opcional em `occurrenceMapQuerySchema`, `inProgressQuerySchema` e `requestListQuerySchema`. `NO_NEIGHBORHOOD` filtra `neighborhood IS NULL`.
  - `GET /panel/neighborhoods` → `{ items: string[]; source: 'ibge' | 'tenant' | null }`, com os nomes de `effective_neighborhoods` do contexto em ordem `pt-BR`.
  - `neighborhoodCondition(value: string | undefined): SQL | undefined`, exportada de `occurrences.ts`.

- [ ] **Step 1: Testes que falham:** `map filters by neighborhood`; `__none__ returns occurrences without neighborhood`; `in-progress and requests lists filter by neighborhood`; `GET /panel/neighborhoods lists the effective names`; `GET /panel/neighborhoods is empty for a tenant without neighborhoods`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Bairros: filtro na API do painel`.

### Task 4: Filtro de bairro no painel (web)

**Files:**

- Create: `apps/web/src/map/use-neighborhoods.ts`
- Modify: `apps/web/src/map/map-query.ts`, `apps/web/src/map/MapFilters.tsx`, `apps/web/src/lists/InProgressPage.tsx`, `apps/web/src/lists/RequestsPage.tsx`
- Test: `apps/web/src/map/map-query.test.ts`, `apps/web/src/map/MapPage.test.tsx`, `apps/web/src/lists/*.test.tsx`

**Interfaces:**

- Consumes: `GET /panel/neighborhoods` (Task 3).
- Produces: `useNeighborhoods(): { items: string[]; enabled: boolean }`, em que `enabled` é `items.length > 0`. `MapQueryState.neighborhood: string | null`, na URL como `?bairro=`.

- [ ] **Step 1: Testes que falham:** `parses and writes ?bairro`; `hides the neighborhood filter when the tenant has none`; `ignores ?bairro when the tenant has no neighborhoods`; `shows "Sem bairro" as the last option`; nas duas listas, `sends neighborhood to the API`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. O filtro "Bairro: todos" fica depois de "Categoria". A chave da consulta do mapa (`mapOccurrencesKey`) inclui o bairro.
- [ ] **Step 4:** Testes do web e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Painel: filtro por bairro`.

## Parte B — Mapa com a situação do prazo

### Task 5: Situação do prazo na API

**Files:**

- Create: `packages/shared/src/deadline.ts` (export em `index.ts`), `packages/shared/src/deadline.test.ts`
- Modify: `packages/shared/src/panel.ts`, `apps/api/src/panel/occurrences.ts`, `apps/api/src/panel/routes.ts`
- Test: `apps/api/src/panel/occurrences.test.ts`

**Interfaces:**

- Produces (`shared`):
  - `DEADLINE_STATUSES = ['none', 'on_time', 'due_soon', 'overdue']`, `type DeadlineStatus`, `DUE_SOON_DAYS = 2` e `DEADLINE_FILTERS = ['on_time', 'due_soon', 'overdue']`.
  - `deadlineTag(dueAt: string, now: Date): string`, que devolve os textos da etiqueta das Decisões e conta os dias em Brasília.
  - `occurrencePointSchema` ganha `deadlineStatus` e `dueAt: z.iso.datetime().nullable()`. `occurrenceMapQuerySchema` ganha `deadline` opcional.
  - `occurrenceSummarySchema` `{ triage, inProgress, dueSoon, overdue }`.
- Produces (API):
  - `deadlineStatusSql(): SQL<DeadlineStatus>` e `activeDueAtSql(): SQL<Date | null>` em `occurrences.ts`, sobre `occurrences` sem apelido, como `statusSinceSql`.
  - `GET /panel/occurrences/summary?categoryId&days&neighborhood` → `occurrenceSummarySchema`. Respeita categoria, período, bairro e setores, e ignora status e prazo.
  - Com `deadline` presente, o mapa força `in_progress`, o mesmo que a regra do web.

- [ ] **Step 1: Testes que falham:**
  - no `shared`: `deadlineTag` com cada texto; `due today at 23:30 São Paulo is "Vence hoje"`.
  - na API: `triage occurrence is none`; `due in 3 days is on_time`; `due in 2 days is due_soon`; `due today at 23:30 São Paulo is due_soon`; `one second after dueAtFor is overdue`; `impeded work order still counts its due date`; `summary ignores status and deadline filters`; `summary respects department scope`; `deadline filter returns only in_progress`.
  - Usar o relógio do banco com `SET LOCAL` de um `now()` fixo por função de teste, ou datas relativas a `now()`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar a regra das Decisões numa expressão só, usada no `select`, no `where` e na contagem.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Mapa: situação do prazo na API`.

### Task 6: Mapa colorido pelo prazo, faixa e filtro (web)

**Files:**

- Modify: `apps/web/src/map/map-style.ts`, `apps/web/src/map/OccurrenceMap.tsx`, `apps/web/src/map/MapFilters.tsx`, `apps/web/src/map/MapPage.tsx`, `apps/web/src/map/MapPage.module.css`, `apps/web/src/map/map-query.ts`
- Create: `apps/web/src/map/SummaryStrip.tsx`, `apps/web/src/map/SummaryStrip.test.tsx`
- Modify: o cabeçalho do painel do ponto (a etiqueta "Aberta há…" em `apps/web/src/occurrence/`)
- Test: `apps/web/src/map/map-style.test.ts`, `apps/web/src/map/map-query.test.ts`, `apps/web/src/map/MapPage.test.tsx`

**Interfaces:**

- Consumes: `deadlineStatus`, `dueAt`, `deadlineTag` e `GET /panel/occurrences/summary` (Task 5).
- Produces:
  - `MapQueryState.deadline: DeadlineFilter | null`, na URL como `?prazo=no-prazo|vencendo|atrasadas`.
  - `applySummaryClick(state: MapQueryState, key: 'triage' | 'inProgress' | 'dueSoon' | 'overdue'): MapQueryState`, que segue as regras de clique do spec (seção 3), inclusive o segundo clique que volta ao padrão.
  - `DEADLINE_PIN_COLORS: Record<DeadlineStatus, string>`.

- [ ] **Step 1: Testes que falham:**
  - `applySummaryClick` com os quatro botões e o segundo clique.
  - `choosing a deadline with status open switches to in_progress`.
  - `parses and writes ?prazo`.
  - `pin color follows deadlineStatus and clusters use the worst`, testando a expressão gerada.
  - `strip shows the four numbers and marks the active one`.
  - `legend shows "Situação do prazo"`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. A cor do círculo sai de `deadlineStatus`, e o tamanho e o número continuam saindo dos relatos. Os números da faixa usam `StatCard` ou um botão no mesmo estilo, com `aria-pressed` no ativo.
- [ ] **Step 4:** Testes do web e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Mapa: pinos pelo prazo, faixa de números e filtro`.

## Parte C — Dados da prefeitura e abas da P3

### Task 7: Dados da prefeitura (painel)

**Files:**

- Create: `packages/db/migrations/0038_panel_tenant_profile.sql` (`--custom`)
- Modify: `packages/shared/src/panel-admin.ts`
- Create: `apps/api/src/panel/profile.ts`, `apps/api/src/panel/profile.test.ts`
- Modify: `apps/api/src/panel/routes.ts`
- Create: `apps/web/src/profile/TenantProfilePage.tsx`, `.module.css` e `.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/dados`), `apps/web/src/shell/menu.ts`

**Interfaces:**

- Produces:
  - Função `panel_tenant_profile() RETURNS jsonb` (`SECURITY DEFINER`), que lê a prefeitura do contexto e exige vínculo ativo de gestor ou admin, ou a equipe. Devolve o nome de exibição, município, UF, código IBGE, central, situação, o contrato vigente (plano, início, fim, incluídos), `panelUserCount` com a mesma regra da P3 e `{ count, source }` dos bairros.
  - `tenantProfileSchema` com esse formato.
  - `GET /panel/tenant-profile`, para gestor, admin e modo suporte.
  - Item de menu "Dados da prefeitura" (ícone `Building2`) no grupo CONFIGURAR, para gestor e admin.

- [ ] **Step 1: Testes que falham:**
  - no banco (`profile.test.ts` da API, usando o banco real): `manager reads the profile of his tenant only`; `profile has no write route` (`PATCH` e `POST` dão 404); `panelUserCount matches the backoffice detail`.
  - no web: `renders the three blocks and the support note`; `shows "Nenhum bairro cadastrado"`; `menu shows "Dados da prefeitura" for manager and admin`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. A contagem de usuários do painel sai de uma função SQL comum, usada pela P3 e por `panel_tenant_profile`. Se hoje a conta está no TypeScript de `tenants.ts`, ela passa para essa função.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Painel: dados da prefeitura`.

### Task 8: Abas da P3 e a aba Contrato

**Files:**

- Modify: `packages/shared/src/backoffice.ts` (`contractBodySchema`, ação `'tenant.contract_update'` com o rótulo "Editou o contrato")
- Modify: `apps/api/src/backoffice/tenants.ts` e `tenants.test.ts`
- Modify: `apps/web/src/backoffice/tenants/TenantDetailPage.tsx` e `.test.tsx`
- Create: `apps/web/src/backoffice/tenants/tabs/ContractTab.tsx`, `ContractTab.test.tsx` e `tenant-tabs.ts`

**Interfaces:**

- Consumes: as rotas de bairros (Task 2).
- Produces:
  - `PUT /backoffice/tenants/:id/contract` com corpo `{ displayName, centralPhone, plan, startsOn, endsOn, includedPanelUsers }`. Só o Admin. Responde `200 tenantDetailSchema` ou `422 invalid_contract`, quando o fim vem antes do início ou os incluídos não passam de 0.
  - `TENANT_TABS` com chave, rótulo e `adminOnly` para cada aba, e `tabFromSearch(params): TenantTab`.
  - O `TenantDetailPage` mostra as abas como links `?aba=`. A Visão geral continua como está.

- [ ] **Step 1: Testes que falham:**
  - na API: `admin updates the current contract and tenant data`; `support gets 403`; `creates the contract when the tenant has none`; `writes tenant.contract_update in the audit`.
  - no web: `tabs follow ?aba`; `Gerenciar opens the matching tab`; `support sees the contract read-only and no Auditoria tab`; `uploading a file shows "Bairros carregados: {n}."`; `invalid file shows the format message`; `reset asks for confirmation`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. O formulário reaproveita os campos e as validações da P2 (`NewTenantPage`). O arquivo é lido no navegador com `File.text()` e `JSON.parse` antes do envio.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Backoffice: abas da P3 e contrato`.

### Task 9: Abas só leitura e Auditoria da P3

**Files:**

- Create: `apps/api/src/backoffice/tenant-lists.ts` e `tenant-lists.test.ts`
- Modify: `apps/api/src/backoffice/routes.ts`
- Create: `apps/web/src/backoffice/tenants/tabs/TeamsTab.tsx`, `ManagersTab.tsx`, `CategoriesTab.tsx`, `AuditTab.tsx` e um teste por aba
- Modify: `apps/web/src/backoffice/audit/AuditPage.tsx` (extrair a tabela e os filtros num componente que aceita `tenantId` fixo)

**Interfaces:**

- Consumes: `loadTeams`, `loadManagers` e `loadCategories` (`apps/api/src/panel/teams.ts` e `admin.ts`), chamadas com `staffPanelIdentity(staff, tenantId)`; a rota da P7 com `tenantId`.
- Produces:
  - `staffPanelIdentity(staff: { userId: string; platformRole: PlatformRole }, tenantId: string): PanelIdentity`, que devolve `role: 'tenant_admin'` e `departmentIds: null`.
  - `GET /backoffice/tenants/:id/teams|managers|categories`, para Admin e Suporte, com os schemas de resposta do painel.

- [ ] **Step 1: Testes que falham:**
  - na API: `staff lists teams, managers and categories of a tenant`; `does not leak other tenants`; `citizen token gets 401`.
  - no web: cada aba mostra as linhas e o botão "Abrir no painel", que chama `enterAt` com o caminho certo; `AuditTab filters by the tenant and hides the tenant filter`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. As tabelas são só leitura, sem menu ⋯.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Backoffice: equipes, gestores, categorias e auditoria na P3`.

### Task 10: Aba Cidadãos

**Files:**

- Modify: `packages/shared/src/auth.ts` (`maskPhone`), `packages/shared/src/backoffice.ts` (`citizenRowSchema`, `citizenListQuerySchema`, `citizenListResponseSchema`, a ação `'tenant.citizens_view'` com o rótulo "Consultou os cidadãos")
- Create: `apps/api/src/backoffice/citizens.ts` e `citizens.test.ts`
- Create: `apps/web/src/backoffice/tenants/tabs/CitizensTab.tsx` e `.test.tsx`

**Interfaces:**

- Produces:
  - `maskPhone(e164: string): string`, como nas Decisões.
  - `citizenRowSchema` `{ id, name, phoneMasked: string | null, emailMasked: string | null, requestCount, openCount, lastRequestAt, lastActiveAt: string | null, situation: 'active' | 'inactive' | 'frozen' }`, sem campo de CPF.
  - `citizenListQuerySchema` `{ q (nome, até 120), situation?, page }`, com página de 50.
  - `GET /backoffice/tenants/:id/citizens`, para Admin e Suporte. Grava `tenant.citizens_view` só na primeira página sem busca, para não encher a auditoria a cada tecla. **Escolha do plano.**

- [ ] **Step 1: Testes que falham:**
  - `maskPhone` com celular de 11 dígitos, fixo de 10 e número estrangeiro.
  - na API:
    - `lists only citizens with a request in this tenant`
    - `counts total and open requests per citizen`
    - `situation follows last_active_at and frozen`
    - `deleted accounts are not listed`
    - `citizens response never contains full phone, email or any cpf`: procurar no corpo JSON os dígitos do celular, o e-mail inteiro e o CPF da fixture
    - `search by name only`: buscar pelo CPF ou pelo celular não acha
    - `writes tenant.citizens_view once per opening`
  - no web: `renders masked columns and situation badges`; `filters by situation and searches by name`; `paginates by 50`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. A consulta parte de `requests` da prefeitura (contexto da equipe com `tenantId`), agrupa por `citizen_id` e junta `users`. O mascaramento acontece antes de montar a linha de resposta.
- [ ] **Step 4:** Testes e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Backoffice: cidadãos da prefeitura`.

## Parte D — Correções e fechamento

### Task 11: Correções de banco e API

**Files:**

- Create: `packages/db/migrations/0039_fixes_validation.sql` (`--custom`)
- Modify: `apps/api/src/auth/app-routes.ts`, `apps/api/src/notifications/scheduler.ts`, `apps/api/src/app.ts`
- Test: os `*.test.ts` vizinhos e `packages/db/src/notifications.test.ts`

**Interfaces:** não há contrato novo. Cada item mantém a assinatura atual.

- [ ] **Step 1: Testes que falham, um por item:**
  - `recover after the CPF was released returns invalid_code` (antes dava 500)
  - `revoking a session on the server clears the device push token`
  - `pegada não envia work_order_* a quem saiu da equipe`
  - `scheduler logs a database failure once until it recovers`
  - `unexpected error returns 500 { code: 'internal_error' } without the message`
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar:
  - `CREATE OR REPLACE` de `platform_recover_frozen_account` com `AND u.cpf IS NOT NULL` na busca.
  - Na pegada (`notification_claim_batch`), reconferir o vínculo `field_agent` e a equipe para os tipos `work_order_*`. Quem não passa vira `skipped`.
  - Apagar o token do aparelho onde a sessão é revogada.
  - Guardar o último estado no agendador.
  - No `setErrorHandler`, responder `{ code: 'internal_error' }` para 5xx sem `code` próprio.
- [ ] **Step 4:** Testes de `db` e `api` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Correções da validação: banco e API`.

### Task 12: Correções do web

**Files:**

- Modify: `apps/web/src/work/WorkQueueLayout.tsx`, `apps/web/src/managers/ManagersPage.tsx`, `apps/web/src/teams/AgentsTable.tsx`, `apps/web/src/categories/DepartmentsPage.tsx` e os CSS dessas telas
- Test: os `*.test.tsx` vizinhos

- [ ] **Step 1: Testes que falham:** `opening an activity that left the queue shows "Esta atividade já saiu da fila."` (não abre a primeira nem a última); `managers table has no "⋯" header text`.
- [ ] **Step 2:** Rodar os testes → FAIL.
- [ ] **Step 3:** Implementar. Para o corte do menu ⋯, aplicar a correção do 6b (`flex: 1` em `.content`) nas três telas e conferir no navegador, já que o jsdom não mede corte.
- [ ] **Step 4:** Testes do web e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `Correções da validação: painel`.

### Task 13: Documentação, pendências e passada no navegador

**Files:**

- Modify: `docs/planejamento-mvp.md`, `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`
- Create: `docs/superpowers/plans/resultado-pronto-para-validacao/*.png`

- [ ] **Step 1:** Passada no navegador com o seed de desenvolvimento e os bairros de um município importados:
  - mapa com as quatro cores, a faixa, os cliques, o filtro de prazo e o filtro de bairro
  - lista com bairro
  - prefeitura sem bairros, sem o filtro
  - Dados da prefeitura, como gestor e em modo suporte
  - as sete abas da P3, como Admin e como Suporte
  - carga e volta da malha do IBGE
  - cidadãos mascarados, conferindo na aba Rede do navegador que a resposta não tem dado completo
  - as correções da Task 12

  Uma captura por item.

- [ ] **Step 2:**
  - No planejamento: incluir este pacote na lista de planos e marcar o filtro por bairro como feito.
  - Nas pendências: nova seção "Pronto para validação", com os textos desta etapa para o usuário confirmar, os itens corrigidos marcados nas seções de origem e o que ficou em aberto.
- [ ] **Step 3:** `pnpm lint`, `pnpm format:check`, `pnpm test` e `pnpm typecheck` no repositório inteiro → PASS.
- [ ] **Step 4:** Commit `Pronto para validação: documentação, pendências e passada no navegador`.
