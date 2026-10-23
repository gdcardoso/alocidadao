# Modelo de dados do design — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o banco (`packages/db`) e as regras (`packages/shared`) ao modelo da seção 9 do spec: ocorrências, atividade sobre a ocorrência, fotos com revisão, usuários sem senha, prefeitura com status, contrato, papéis internos, auditoria, interesse por município e as consultas geográficas. O código que já usa o banco (seed, rotas `/dev`, Laboratório do app) continua funcionando.

**Architecture:** As regras de status viram três máquinas de estado no `shared` (solicitação, ocorrência, atividade), com uma função genérica de transição. O banco muda por novas migrações: as estruturais saem do `drizzle-kit generate` e as de RLS, grants e funções são SQL próprio (`drizzle-kit generate --custom`), como nas migrações 0000 e 0002. As consultas geográficas ficam em `packages/db/src/geo.ts`, rodando como `app_user` e sujeitas ao RLS.

**Tech Stack:** TypeScript ~6.0.3, Zod 4, Drizzle ORM 0.45 + drizzle-kit 0.31, PostgreSQL 17 + PostGIS, Fastify 5, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md` (seções 3 a 6 e 9). Ver também `docs/decisoes/0001-isolamento-por-prefeitura.md` e `docs/superpowers/plans/2026-10-22-spikes-pendencias.md` (seção "Plano 1").

## Decisões deste plano (o spec deixa em aberto)

- **Ficam para o Plano 2 (Acesso):** tabela de códigos de verificação, tabela `devices`, validação de dígitos do CPF e as funções que congelam conta. Elas só fazem sentido junto do fluxo de login. Este plano entrega as colunas de usuário de que elas dependem e as buscas de login por telefone e por CPF, porque tirar `password_hash` quebra `auth_find_user_by_email`.
- **Rotas reais no lugar de `/dev/*`** vão para o Plano 4 (App do agente), que é quem as usa. Aqui as rotas `/dev` só se adaptam ao modelo novo e recebem os testes pendentes.
- **Agregados entre prefeituras (P1)** ficam para o Plano 6 (Backoffice).
- **Status da ocorrência:** `triage`, `in_progress`, `awaiting_confirmation`, `completed`, `rejected`, `merged`, `cancelled`. `cancelled` cobre a ocorrência cuja única solicitação o cidadão cancelou.
- **Atividade ativa** = qualquer status menos `completed` e `cancelled`, inclusive `impeded`, porque o gestor ainda decide sobre ela. Reagendar volta a mesma atividade para `assigned`.
- **Situação comercial do município:** `new`, `contacted`, `negotiating`, `won`, `lost`.
- **Ajuste do local:** o `shared` recusa ajuste acima de 200 m (haversine). O banco tem uma trava de 205 m (geografia), só para não recusar o que o `shared` aceitou por diferença de cálculo.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, módulos NodeNext; Zod 4 (`z.uuid()`, `z.iso.datetime()`).
- **Nomes e textos:** identificadores em inglês; comentários, mensagens e nomes de teste do `packages/db` em português; nomes de teste do `shared` e da API em inglês (padrão atual).
- **Isolamento (decisão 0001):** toda tabela da prefeitura tem `tenant_id`, `UNIQUE (tenant_id, id)`, FK composta `(tenant_id, x_id)` para outras tabelas da prefeitura, `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política `tenant_isolation` de `0002_row_level_security.sql`.
- **Só inserção:** `status_events`, `client_actions` e a auditoria da equipe interna recebem só `SELECT, INSERT` de `app_user`.
- **Migrações:** rodam com o dono (`DATABASE_OWNER_URL`); `app_user` nunca recebe DDL. Não editar migrações já commitadas (0000–0003). Ainda não há dados reais: a primeira migração nova começa apagando os dados operacionais.
- **`drizzle-kit generate` é interativo** quando a mesma mudança remove e cria colunas ou tabelas (pergunta se é renomeação), e este ambiente não responde perguntas. Por isso toda mudança estrutural é gerada **em duas passadas**: primeiro só o que é novo, depois só o que sai. Se mesmo assim aparecer uma pergunta, interrompa e divida mais a mudança.
- Telefone em E.164 (`^\+[1-9][0-9]{7,14}$`); CPF só com os 11 dígitos (`^[0-9]{11}$`); código IBGE com 7 dígitos (`^[0-9]{7}$`).
- **Commits:** mensagem em português, curta, no estilo do histórico, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes do pacote da tarefa. Banco local com `pnpm infra:up`.
- Entre as Tasks 1 e 5, `pnpm typecheck` na raiz pode falhar em `apps/api` e `apps/mobile`, porque o `shared` e o banco mudam antes das rotas `/dev`. Cada tarefa verifica só os pacotes que ela lista; a Task 5 devolve a raiz inteira ao verde.

## Review Focus

1. **Gestor muda a categoria de uma ocorrência que já tem relatos:** as solicitações acompanham a categoria nova, sem erro de FK. Teste `reclassificar a ocorrência leva as solicitações junto` na Task 2.
2. **Atividade impedida e nova atribuição:** enquanto a atividade impedida não for cancelada, o banco recusa outra atividade ativa para a mesma ocorrência. Teste `atividade impedida ainda conta como ativa` na Task 2.
3. **Número de celular reaproveitado:** a conta antiga congelada mantém o número, e uma conta nova ativa pode usar o mesmo número. Duas contas ativas com o mesmo número são recusadas. Teste `número reaproveitado` na Task 3.
4. **Suporte da plataforma dentro de uma prefeitura:** age como admin da prefeitura, mas não cria nem altera prefeitura nem contrato. Teste `suporte não mexe em prefeitura nem contrato` na Task 3.
5. **Ocorrência parecida fora do alcance:** nunca sugerir ocorrência juntada, cancelada, recusada, concluída, de outra categoria, fora do raio ou de outra prefeitura. Teste `findSimilarOccurrences ignora…` na Task 4.

---

### Task 1: Máquinas de estado e schemas no `shared`

**Files:**
- Create: `packages/shared/src/state-machine.ts`, `packages/shared/src/occurrence-status.ts`, `packages/shared/src/enums.ts`, `packages/shared/src/geo.ts`
- Modify: `packages/shared/src/request-status.ts`, `packages/shared/src/work-order-status.ts`, `packages/shared/src/roles.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/request-status.test.ts` (reescrever), `packages/shared/src/occurrence-status.test.ts`, `packages/shared/src/work-order-status.test.ts`, `packages/shared/src/geo.test.ts`, `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces:
  - `state-machine.ts`: `interface Transition<S> { from: readonly S[]; to: S; actors: readonly Actor[] }`; `type TransitionResult<S> = { ok: true; to: S } | { ok: false; reason: 'invalid_status' | 'forbidden' }`; `createStateMachine<S extends string, A extends string>(actions: readonly A[], transitions: Record<A, Transition<S>>): { apply(current: S, action: A, actor: Actor): TransitionResult<S>; available(current: S, actor: Actor): A[] }`. `invalid_status` tem precedência sobre `forbidden` (comportamento atual).
  - `request-status.ts`: `REQUEST_STATUSES = ['open','in_progress','awaiting_confirmation','completed','cancelled','rejected']` (sai `duplicate`), `REQUEST_STATUS_LABELS`, `FINAL_REQUEST_STATUSES = ['completed','cancelled','rejected']`, `REQUEST_ACTIONS = ['cancel','assign','publish','confirm','auto_confirm','contest','reopen','reject']`, `applyRequestAction`, `availableRequestActions`, `AUTO_CONFIRM_AFTER_DAYS = 7`.
  - `occurrence-status.ts`: `OCCURRENCE_STATUSES = ['triage','in_progress','awaiting_confirmation','completed','rejected','merged','cancelled']`, `OccurrenceStatus`, `CLUSTERABLE_OCCURRENCE_STATUSES = ['triage','in_progress']`, `OCCURRENCE_ACTIONS = ['assign','publish','reopen','close','reject','merge','cancel']`, `applyOccurrenceAction`, `availableOccurrenceActions`.
  - `work-order-status.ts`: `WORK_ORDER_STATUSES = ['assigned','in_execution','awaiting_review','rework_requested','impeded','completed','cancelled']`, `WORK_ORDER_STATUS_LABELS` (Atribuída, Em execução, Aguardando revisão, Ajuste pedido, Impedida, Concluída, Cancelada), `ACTIVE_WORK_ORDER_STATUSES` (todos menos `completed` e `cancelled`), `WORK_ORDER_ACTIONS = ['start','complete','report_impediment','request_rework','publish','reschedule','cancel']`, `applyWorkOrderAction`, `availableWorkOrderActions`. **Sai `canTransitionWorkOrder` e `WORK_ORDER_TRANSITIONS`.**
  - `roles.ts`: `PLATFORM_ROLES = ['admin','support']`, `PlatformRole`; `ROLES` ganha `'platform_support'`.
  - `enums.ts`: `TENANT_STATUSES = ['onboarding','active','suspended']`, `MEMBERSHIP_STATUSES = ['invited','active','inactive']`, `ACCOUNT_STATUSES = ['active','frozen']`, `PHOTO_REVIEWS = ['pending','published','discarded']`, `ICON_GROUPS = ['infrastructure','environment','public_services']`, `COMMERCIAL_STATUSES = ['new','contacted','negotiating','won','lost']`, cada um com o tipo derivado (`TenantStatus`, …).
  - `geo.ts`: `distanceMeters(a: GeoPoint, b: GeoPoint): number` (haversine, raio 6 371 008,8 m); `MAX_LOCATION_ADJUST_M = 200`; `DEFAULT_CLUSTER_RADIUS_M = 20`.
  - `schemas.ts`: `geoPointSchema` sai daqui e vai para `geo.ts` (reexportado no índice). `createRequestInputSchema` ganha `gpsLocation: geoPointSchema` e `occurrenceId: z.uuid().optional()` (apoiar relato). `location` passa a ser o ponto ajustado, recusado com issue em `['location']` quando `distanceMeters(gpsLocation, location) > MAX_LOCATION_ADJUST_M`.

**Tabelas de transição (copiar exatamente):**

| Máquina    | Ação                | De                                                           | Para                    | Atores                    |
| ---------- | ------------------- | ------------------------------------------------------------ | ----------------------- | ------------------------- |
| Solicitação | `cancel`           | open                                                         | cancelled               | citizen                   |
| Solicitação | `assign`           | open                                                         | in_progress             | manager, tenant_admin     |
| Solicitação | `publish`          | in_progress                                                  | awaiting_confirmation   | manager, tenant_admin     |
| Solicitação | `confirm`          | awaiting_confirmation                                        | completed               | citizen                   |
| Solicitação | `auto_confirm`     | awaiting_confirmation                                        | completed               | system                    |
| Solicitação | `contest`          | awaiting_confirmation                                        | open                    | citizen                   |
| Solicitação | `reopen`           | awaiting_confirmation                                        | open                    | system                    |
| Solicitação | `reject`           | open, in_progress                                            | rejected                | manager, tenant_admin     |
| Ocorrência | `assign`            | triage                                                       | in_progress             | manager, tenant_admin     |
| Ocorrência | `publish`           | in_progress                                                  | awaiting_confirmation   | manager, tenant_admin     |
| Ocorrência | `reopen`            | awaiting_confirmation                                        | triage                  | system                    |
| Ocorrência | `close`             | awaiting_confirmation                                        | completed               | system                    |
| Ocorrência | `reject`            | triage, in_progress                                          | rejected                | manager, tenant_admin     |
| Ocorrência | `merge`             | triage, in_progress                                          | merged                  | manager, tenant_admin     |
| Ocorrência | `cancel`            | triage                                                       | cancelled               | system                    |
| Atividade  | `start`             | assigned                                                     | in_execution            | field_agent               |
| Atividade  | `complete`          | in_execution, rework_requested                               | awaiting_review         | field_agent               |
| Atividade  | `report_impediment` | assigned, in_execution, rework_requested                     | impeded                 | field_agent               |
| Atividade  | `request_rework`    | awaiting_review                                              | rework_requested        | manager, tenant_admin     |
| Atividade  | `publish`           | awaiting_review                                              | completed               | manager, tenant_admin     |
| Atividade  | `reschedule`        | impeded                                                      | assigned                | manager, tenant_admin     |
| Atividade  | `cancel`            | assigned, in_execution, awaiting_review, rework_requested, impeded | cancelled         | manager, tenant_admin     |

- [ ] **Step 1: Escrever os testes que falham**

`request-status.test.ts` (substitui o atual):
```ts
expect(applyRequestAction('open', 'assign', 'manager')).toEqual({ ok: true, to: 'in_progress' });
expect(applyRequestAction('in_progress', 'reject', 'manager')).toEqual({ ok: true, to: 'rejected' });
expect(applyRequestAction('awaiting_confirmation', 'reopen', 'citizen')).toEqual({ ok: false, reason: 'forbidden' });
expect(applyRequestAction('awaiting_confirmation', 'reopen', 'system')).toEqual({ ok: true, to: 'open' });
expect(applyRequestAction('in_progress', 'cancel', 'citizen')).toEqual({ ok: false, reason: 'invalid_status' });
expect(availableRequestActions('awaiting_confirmation', 'citizen')).toEqual(['confirm', 'contest']);
expect(availableRequestActions('completed', 'tenant_admin')).toEqual([]);
expect(REQUEST_STATUSES).not.toContain('duplicate');
```
`occurrence-status.test.ts`: `merge` vale de `triage` e de `in_progress` para manager; `reopen` só para system; `availableOccurrenceActions('triage', 'manager')` é `['assign','reject','merge']`; `CLUSTERABLE_OCCURRENCE_STATUSES` é `['triage','in_progress']`.
`work-order-status.test.ts`: `complete` vale de `rework_requested` (agente); `publish` de `awaiting_review` (manager) dá `completed`; `reschedule` de `impeded` dá `assigned`; o agente não pode `publish` (`forbidden`); `ACTIVE_WORK_ORDER_STATUSES` contém `impeded` e não contém `completed` nem `cancelled`.
`geo.test.ts`: `distanceMeters` de `(-23.5505, -46.6333)` a `(-23.5505 + 0.0018, -46.6333)` fica entre 199 e 201.
`schemas.test.ts`: `createRequestInputSchema` aceita local ajustado a ~150 m do GPS; recusa a ~250 m com issue em `['location']`; aceita `occurrenceId` ausente.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/shared test` → FAIL (módulos e exports inexistentes).

- [ ] **Step 3: Implementar** os arquivos da lista com as interfaces acima. `request-status.ts`, `occurrence-status.ts` e `work-order-status.ts` declaram a tabela e chamam `createStateMachine`. Exportar tudo em `index.ts`.

- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/shared test` e `pnpm --filter @alocidadao/shared typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Regras de status de solicitação, ocorrência e atividade"`

---

### Task 2: Ocorrências, atividade sobre a ocorrência e fotos no banco

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/seed-dev-data.ts`, `packages/db/src/seed-dev.ts`, `packages/db/src/rls.test.ts`, `packages/db/src/client-actions.test.ts`
- Create: migrações `0004_*` (estrutural, passada 1), `0005_*` (estrutural, passada 2), `0006_occurrences_rls.sql` (custom)
- Test: `packages/db/src/occurrences.test.ts`

**Interfaces:**
- Consumes: `OCCURRENCE_STATUSES`, `WORK_ORDER_STATUSES`, `REQUEST_STATUSES`, `PHOTO_REVIEWS`, `ICON_GROUPS`, `DEFAULT_CLUSTER_RADIUS_M` da Task 1.
- Produces (Drizzle, em `schema.ts`):
  - enums `occurrenceStatus`, `photoReview`, `iconGroup`.
  - `occurrences`: `id`, `tenantId`, `categoryId`, `location` (point 4326, ponto central), `status` (default `triage`), `mergedIntoId` (FK composta para a própria tabela), `rejectionReason` (texto público), `createdAt`, `updatedAt`. `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, id, category_id)`, FK composta para `categories`, índices `(tenant_id, status)` e gist em `location`.
  - `requests`: + `occurrenceId` (not null), + `gpsLocation` (point, not null; `location` passa a ser o ajustado), + `statusChangedAt` (not null, default now); − `duplicateOfId`. FK `(tenant_id, occurrence_id, category_id)` → `occurrences (tenant_id, id, category_id)` com `ON UPDATE CASCADE`. CHECK `requests_location_adjust_check`: `ST_DWithin(location::geography, gps_location::geography, 205)`.
  - `workOrders`: + `occurrenceId` (FK composta), + `managerInstructions`, + `agentNote` (relato original, substitui `completionNote`), + `publicNote`, + `publishedAt`; − `requestId`, − `completionNote`. Índice único `work_orders_one_active_per_occurrence_idx` em `occurrence_id` `WHERE status NOT IN ('completed','cancelled')` (substitui o de solicitação).
  - `photos`: `id`, `tenantId`, `requestId` (nulo), `workOrderId` (nulo), `storageKey` (único), `uploadedBy` (FK users), `review` (`photoReview`, nulo), `createdAt`. CHECKs `num_nonnulls(request_id, work_order_id) = 1` e `(work_order_id IS NULL) = (review IS NULL)`. FKs compostas.
  - `statusEvents`: + `occurrenceId` (not null, FK composta), + `details` (jsonb, nulo: motivos da devolução, fotos descartadas); `requestId` passa a nulo. Índice `(occurrence_id, created_at)`.
  - `categories`: + `clusterRadiusM` (int, not null, default `DEFAULT_CLUSTER_RADIUS_M`, CHECK entre 1 e 500), + `iconGroup` (not null, default `infrastructure`).
  - `seedDev(db)` mantém a assinatura e o retorno `SeedDevResult`; cria uma ocorrência por solicitação e a atividade aponta para ela.

- [ ] **Step 1: Escrever os testes que falham** em `occurrences.test.ts` (dono prepara, `app_user` executa, no padrão de `rls.test.ts`):
  - `não lê ocorrência nem foto de outra prefeitura`
  - `recusa solicitação com categoria diferente da ocorrência` (erro de FK)
  - `reclassificar a ocorrência leva as solicitações junto`: `UPDATE occurrences SET category_id = <outra>` e depois `requests.category_id` igual à nova.
  - `recusa local ajustado a mais de 205 m do GPS` (CHECK `requests_location_adjust_check`) e aceita a 200 m pela `distanceMeters` do `shared`
  - `permite só uma atividade ativa por ocorrência` e `atividade impedida ainda conta como ativa`: com uma `impeded`, inserir outra `assigned` falha; depois de `cancelled`, passa.
  - `foto pertence a uma solicitação ou a uma atividade`: as duas ou nenhuma → erro; foto de solicitação com `review` → erro; foto de atividade sem `review` → erro.
  - `histórico aceita evento de ocorrência sem solicitação`
  - Em `client-actions.test.ts`, pendências do Plano 1: `recusa gravar ação com tenant_id de outra prefeitura` (`WITH CHECK`) e o teste "esconde ações de outra prefeitura" passa a criar a própria ação, sem depender da ordem.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/db test` → FAIL.

- [ ] **Step 3: Passada 1 (só o que é novo).** Em `schema.ts`, acrescentar tabelas, enums e colunas novas **sem remover nada**: `work_orders.request_id` passa a nulo; `requests.duplicate_of_id`, `work_orders.completion_note` e o índice antigo continuam. Rodar `pnpm --filter @alocidadao/db exec drizzle-kit generate --name occurrences`. Abrir o SQL gerado e inserir no topo:
```sql
-- Ainda não há dados reais (spec, seção 9): apaga os dados operacionais para as colunas novas obrigatórias.
TRUNCATE status_events, client_actions, work_orders, requests, request_counters;
--> statement-breakpoint
```
- [ ] **Step 4: Passada 2 (só o que sai).** Remover de `schema.ts` `requests.duplicateOfId`, `workOrders.requestId`, `workOrders.completionNote`, o índice `work_orders_one_active_per_request_idx` e o valor `duplicate` (já ausente do enum vindo do `shared`). Rodar `pnpm --filter @alocidadao/db exec drizzle-kit generate --name drop_request_links`. Conferir que o SQL troca o enum `request_status` sem `duplicate` e não recria tabelas.
- [ ] **Step 5: Migração custom** — `pnpm --filter @alocidadao/db exec drizzle-kit generate --custom --name occurrences_rls` e escrever: `ENABLE`/`FORCE` + `tenant_isolation` em `occurrences` e `photos`; `GRANT SELECT, INSERT, UPDATE, DELETE ON occurrences TO app_user`; `GRANT SELECT, INSERT ON photos` + `GRANT UPDATE (review) ON photos TO app_user`; comentário explicando que a revisão é a única alteração permitida na foto.
- [ ] **Step 6: Atualizar `seed-dev-data.ts`, `rls.test.ts` e `client-actions.test.ts`** para o modelo novo (ocorrência antes da solicitação, `gpsLocation` igual a `location`, atividade com `occurrenceId`). O teste `permite só uma atividade ativa por solicitação` sai (coberto pelo novo). Pendência do seed: a checagem de existência da prefeitura demo vai para dentro da transação, com `pg_advisory_xact_lock(hashtext('seed-dev'))` antes dela, e o comentário da função diz que ela exige o dono do banco.
- [ ] **Step 7: Rodar e ver passar** — `pnpm --filter @alocidadao/db test` e `typecheck` → PASS; `pnpm db:migrate && pnpm db:seed:dev` no banco local → sem erro.
- [ ] **Step 8: Commit** — `git commit -m "Ocorrências, atividade sobre a ocorrência e fotos com revisão"`

---

### Task 3: Contas sem senha, prefeitura com status, contrato, papéis internos, auditoria e interesse

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/seed-dev-data.ts`, `packages/db/src/rls.test.ts`, `packages/db/src/client-actions.test.ts`, `packages/db/src/occurrences.test.ts`, `docs/decisoes/0001-isolamento-por-prefeitura.md`
- Create: migrações `0007_*` (passada 1), `0008_*` (passada 2), `0009_platform_rls.sql` (custom)
- Test: `packages/db/src/platform.test.ts`

**Interfaces:**
- Consumes: `TENANT_STATUSES`, `MEMBERSHIP_STATUSES`, `ACCOUNT_STATUSES`, `PLATFORM_ROLES`, `COMMERCIAL_STATUSES` (Task 1).
- Produces:
  - `DbContext` passa a `{ tenantId?: string; userId?: string; platformRole?: PlatformRole }` (sai `platformAdmin`). `withContext` grava `app.platform_role` (`''` quando ausente).
  - SQL: `app_current_platform_role() RETURNS text`; `app_is_platform_admin()` reescrita como `app_current_platform_role() = 'admin'`; `app_is_platform_staff()` = papel `admin` ou `support`.
  - `tenants`: + `status` (`tenant_status`, default `onboarding`), + `displayName` (not null), + `centralPhone` (nulo); − `active`.
  - `users`: `email` passa a nulo; `phone` com CHECK E.164 e índice único parcial `users_phone_active_idx` `WHERE account_status = 'active'`; `cpf` com CHECK de 11 dígitos (continua único); + `accountStatus` (default `active`), + `lastActiveAt` (nulo), + `platformRole` (`platform_role`, nulo); CHECK `phone IS NOT NULL OR cpf IS NOT NULL`; − `passwordHash`, − `isPlatformAdmin`. `users_email_lower_idx` continua único (ignora nulos).
  - `memberships`: + `status` (`membership_status`, default `active`).
  - `tenantContracts`: `id`, `tenantId` (FK tenants), `plan` (text), `startsOn` (date), `endsOn` (date, nulo, CHECK `ends_on >= starts_on`), `includedPanelUsers` (int, CHECK > 0), `createdAt`.
  - `staffAuditEvents`: `id`, `tenantId`, `staffUserId` (FK users), `action` (text), `targetType` (text, nulo), `targetId` (uuid, nulo), `details` (jsonb, nulo), `createdAt`. Índice `(tenant_id, created_at)`.
  - `cityInterest`: PK `(ibge_code, user_id)`, `ibgeCode` (char 7, CHECK), `userId` (FK users), `createdAt`.
  - `municipalityLeads`: `ibgeCode` (PK), `commercialStatus` (default `new`), `updatedAt`, `updatedBy` (FK users).
  - Funções `SECURITY DEFINER`, com `search_path` fixo e `EXECUTE` só para `app_user` (padrão da antiga `auth_find_user_by_email`, que sai): `auth_find_user_by_phone(p_phone text) RETURNS TABLE (id uuid, last_active_at timestamptz, has_email boolean)`, só contas `active`; `auth_find_user_by_cpf(p_cpf text) RETURNS TABLE (id uuid, email text, platform_role text)`, só contas `active`.

**Políticas (migração custom):**

| Tabela               | Leitura                                         | Escrita                                                                                         |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tenants`            | livre (sem mudança)                             | insert/update só `app_is_platform_admin()` (sem mudança de texto; muda a função)                 |
| `users`              | si mesmo, `app_is_platform_staff()` ou vínculo na prefeitura do contexto | insert/update: si mesmo ou `app_is_platform_staff()`. Grants de coluna: `INSERT (id, name, email, phone, cpf)`, `UPDATE (name, email, phone, cpf, last_active_at)`; `platform_role` e `account_status` fora dos grants |
| `tenant_contracts`   | `app_is_platform_staff()`                       | insert/update só `app_is_platform_admin()`                                                     |
| `staff_audit_events` | `tenant_id = app_current_tenant()`              | insert com `tenant_id = app_current_tenant() AND app_is_platform_staff() AND staff_user_id = app_current_user()`; grants `SELECT, INSERT` |
| `city_interest`      | `user_id = app_current_user()` ou staff         | insert com `user_id = app_current_user()`; grants `SELECT, INSERT`                              |
| `municipality_leads` | staff                                           | insert/update staff                                                                             |

- [ ] **Step 1: Escrever os testes que falham** em `platform.test.ts`:
  - `número reaproveitado`: duas contas `active` com o mesmo telefone → erro; com a primeira `frozen` (alterada pelo dono) → passa.
  - `recusa telefone fora do E.164 e CPF com pontuação`
  - `o usuário não consegue se dar papel interno nem mudar o estado da conta` (UPDATE de `platform_role` e de `account_status` como `app_user` → erro de permissão)
  - `suporte não mexe em prefeitura nem contrato`: com `platformRole: 'support'`, insert em `tenants` e em `tenant_contracts` falham; com `'admin'` passam; suporte lê contratos.
  - `suporte dentro da prefeitura enxerga os usuários dela`
  - `auditoria: só a equipe interna grava, a prefeitura lê, ninguém altera`: cidadão com contexto da prefeitura não insere; suporte insere com o próprio `staff_user_id`; contexto de outra prefeitura não lê; UPDATE e DELETE falham.
  - `interesse por cidade: cada um registra o seu, uma vez por município`; cidadão não lê o interesse de outro; staff lê todos.
  - `login acha a conta ativa pelo telefone e pelo CPF, sem contexto`; conta `frozen` não aparece em `auth_find_user_by_phone`.
  - Em `rls.test.ts`: os testes de admin da plataforma passam a usar `platformRole: 'admin'`; o teste do login por e-mail sai.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3: Passada 1** — acrescentar colunas, enums e tabelas novas em `schema.ts`, com `users.passwordHash` passando a nulo e `email` a nulo (sem remover nada). `pnpm --filter @alocidadao/db exec drizzle-kit generate --name accounts_and_platform`. Na migração gerada, antes de `display_name NOT NULL`, preencher: `UPDATE tenants SET display_name = name;` (não há linhas reais, mas o banco de desenvolvimento tem a demo).
- [ ] **Step 4: Passada 2** — remover `tenants.active`, `users.passwordHash`, `users.isPlatformAdmin`. `pnpm --filter @alocidadao/db exec drizzle-kit generate --name drop_passwords`.
- [ ] **Step 5: Migração custom** `platform_rls`: funções de contexto, `DROP FUNCTION auth_find_user_by_email(text)`, as duas funções de login, recriação das políticas de `users` e as políticas e grants da tabela acima.
- [ ] **Step 6: Atualizar `client.ts`, seed e testes existentes.** O seed cria a prefeitura demo com `status: 'active'` e `displayName`, e o agente com `phone` e sem senha. O cidadão demo ganha `phone: '+5511900000002'`. Em `0001-isolamento-por-prefeitura.md`, atualizar os itens 2 e 5 e as consequências: papel `app.platform_role` (admin/suporte), funções de login por telefone e CPF, auditoria só de inserção.
- [ ] **Step 7: Rodar e ver passar** — `pnpm --filter @alocidadao/db test`, `typecheck`, `pnpm db:migrate && pnpm db:seed:dev` → PASS.
- [ ] **Step 8: Commit** — `git commit -m "Contas sem senha, prefeitura com status, papéis internos, auditoria e interesse por cidade"`

---

### Task 4: Consultas geográficas

**Files:**
- Create: `packages/db/src/geo.ts`, migração `0010_*` (gerada)
- Modify: `packages/db/src/schema.ts` (índice), `packages/db/src/index.ts`, `packages/db/src/seed-dev-data.ts` (limite da demo)
- Test: `packages/db/src/geo.test.ts`

**Interfaces:**
- Consumes: `GeoPoint`, `CLUSTERABLE_OCCURRENCE_STATUSES` (Task 1); `occurrences`, `requests`, `categories`, `tenants.status` (Tasks 2 e 3); `withContext`, `geoPoint` (`client.ts`).
- Produces:
  - `findActiveTenantAt(tx: Transaction, point: GeoPoint): Promise<{ id: string; displayName: string } | undefined>`: prefeitura `active` cujo `boundary` contém o ponto (`ST_Contains`). Funciona sem contexto de prefeitura, porque `tenants` tem leitura livre.
  - `findSimilarOccurrences(tx: Transaction, input: { categoryId: string; point: GeoPoint; limit?: number }): Promise<Array<{ id: string; status: OccurrenceStatus; distanceM: number; requestCount: number }>>`: mesma categoria, status em `CLUSTERABLE_OCCURRENCE_STATUSES`, `ST_DWithin(o.location::geography, ponto::geography, categories.cluster_radius_m)`. Ordena pela distância, `limit` padrão 5, distância arredondada para metro inteiro. Não devolve nada que identifique cidadão.
  - Índice `occurrences_location_geog_idx`: gist em `(location::geography)`.
  - O seed dá à prefeitura demo um limite quadrado de ±0,05° em torno de `CENTER`.

- [ ] **Step 1: Escrever os testes que falham** em `geo.test.ts`. O dono cria as prefeituras A e B com limites quadrados vizinhos (`ST_Multi(ST_MakeEnvelope(...,4326))`) e uma prefeitura C `onboarding` cobrindo outro ponto. Testes:
  - `findActiveTenantAt acha a prefeitura do ponto`, `não devolve prefeitura em implantação` e `devolve undefined fora de qualquer limite`.
  - `findSimilarOccurrences acha a ocorrência dentro do raio, mais perto primeiro, com a contagem de relatos` (duas ocorrências a 10 m e 18 m, raio 20; a segunda com 2 solicitações → `requestCount: 2`).
  - `findSimilarOccurrences ignora…`: ocorrência a 25 m com raio 20; status `merged`, `cancelled`, `rejected` e `completed`; outra categoria; ocorrência da prefeitura B no mesmo ponto (contexto da A).
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/db test geo` → FAIL.
- [ ] **Step 3: Implementar** `geo.ts`, o índice em `schema.ts` (`index('occurrences_location_geog_idx').using('gist', sql\`(${t.location}::geography)\`)`), `pnpm --filter @alocidadao/db exec drizzle-kit generate --name occurrence_geography_index` e o limite no seed. Exportar `geo.ts` em `index.ts`.
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/db test` e `typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Prefeitura pelo ponto e ocorrências parecidas"`

---

### Task 5: Rotas `/dev` e Laboratório no modelo novo, com as pendências de teste

**Files:**
- Modify: `apps/api/src/dev/work-orders.ts`, `apps/api/src/dev/work-orders.test.ts`, `apps/api/tsconfig.build.json`, `apps/mobile/src/app/laboratorio/offline.tsx`, `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`, `docs/decisoes/0002-recursos-nativos-offline-e-push.md` (só se citar `completed` como resultado da conclusão)
- Test: `apps/api/src/dev/work-orders.test.ts`

**Interfaces:**
- Consumes: `applyWorkOrderAction`, `ACTIVE_WORK_ORDER_STATUSES`, `workOrderSummarySchema` (Task 1); `occurrences`, `photos`, `workOrders.agentNote`, `statusEvents.occurrenceId` (Task 2); `seedDev` (Tasks 2 a 4).
- Produces: `export function isUniqueViolation(error: unknown): boolean` em `work-orders.ts`. Os contratos HTTP não mudam: mesmas rotas, corpos e códigos de erro. A única diferença visível é que `complete` agora devolve `status: 'awaiting_review'`.

Comportamento:
- `GET /dev/work-orders`: atividades com status em `ACTIVE_WORK_ORDER_STATUSES` (inclui `awaiting_review`). Local e categoria vêm da ocorrência; `protocol`, `description` e `address` vêm da solicitação mais antiga da ocorrência. Resposta declarada com `schema.response[200] = z.array(workOrderSummarySchema)`.
- `POST /dev/work-orders/:id/actions`: transição por `applyWorkOrderAction(order.status, input.action, 'field_agent')`. `complete` grava `agentNote` e `completedAt = occurredAt` e insere uma linha em `photos` por chave (`workOrderId`, `review: 'pending'`, `uploadedBy`). O evento de status leva `occurrenceId` e `workOrderId`. **Pendência:** as fotos são conferidas no armazenamento **antes** de abrir a transação. Assim `storage.head` não roda com a linha travada; a checagem do status continua dentro da transação.
- `POST /dev/work-orders/:id/cancel`: usa `applyWorkOrderAction(…, 'cancel', 'manager')`. Cancelar uma atividade já `cancelled` devolve 200 com o mesmo corpo, sem novo evento (pendência: cancelamento idempotente).

- [ ] **Step 1: Escrever os testes que falham** (adaptando os existentes ao seed novo):
  - `complete moves the work order to awaiting_review and keeps it in the list`
  - `stores the agent note, completedAt equal to occurredAt and one pending photo per key`
  - `records exactly one status event per action, linked to the occurrence`
  - `responds 503 storage_not_configured when completing without storage`
  - `rejects a photo whose content type is not image/jpeg` (422 `photo_invalid`)
  - `cancelling an already cancelled work order is idempotent` (200, contagem de eventos igual)
  - `isUniqueViolation recognizes the code on the error and on its cause` (`{ code: '23505' }`, `{ cause: { code: '23505' } }`, `new Error()` → false)
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3: Implementar** as rotas conforme acima. Em `tsconfig.build.json`, excluir também `src/**/test-fixtures.ts` e `src/test/**` (pendência: `test-fixtures.ts` no `dist`). No Laboratório, `LOCAL_STATUS.complete = 'awaiting_review'`.
- [ ] **Step 4: Rodar e ver passar** — `pnpm turbo run typecheck test` na raiz, `pnpm lint`, `pnpm format:check` → PASS em todos os pacotes. Depois `cd apps/api && pnpm build && ls dist` sem `test-fixtures.js`.
- [ ] **Step 5: Atualizar `spikes-pendencias.md`:** marcar como feitos os itens do Plano 1 resolvidos aqui e nas Tasks 2 e 6. Mover "Rotas reais substituem `/dev/*`" para o Plano 4.
- [ ] **Step 6: Commit** — `git commit -m "Rotas /dev sobre ocorrências, fotos da conclusão e testes pendentes"`

---

### Task 6: Ambiente da API validado na subida

**Files:**
- Create: `apps/api/src/env.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/.env.example` (só se faltar variável)
- Test: `apps/api/src/env.test.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): ApiEnv`, que lança `Error` com uma linha por variável inválida, no formato `NOME: motivo`. `ApiEnv` tem `port`, `host`, `databaseUrl?`, `corsOrigin?`, `s3?` (objeto completo ou ausente), `fcm?`, `apns?`, `devRoutes: boolean`.

Regras:
- `PORT` inteiro de 1 a 65535 (padrão 3333); `HOST` padrão `0.0.0.0`.
- S3: se `S3_ENDPOINT` existe, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` são obrigatórios e não vazios. Hoje eles caem em `''`.
- FCM: `FCM_PROJECT_ID` e `FCM_SERVICE_ACCOUNT_FILE` juntos ou nenhum. APNs: `APNS_TEAM_ID`, `APNS_KEY_ID` e `APNS_KEY_FILE` juntos ou nenhum.
- `devRoutes` = `ENABLE_DEV_ROUTES === 'true' && NODE_ENV !== 'production'`.

- [ ] **Step 1: Testes que falham** — `rejects S3_ENDPOINT without credentials` (mensagem contém `S3_ACCESS_KEY_ID`), `rejects half of the FCM settings`, `rejects a non numeric PORT`, `never enables dev routes in production`, `accepts an empty environment with defaults`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/api test env` → FAIL.
- [ ] **Step 3: Implementar** `env.ts` com Zod. `server.ts` passa a: (a) carregar `.env` de `apps/api` com `process.loadEnvFile('.env')` quando o arquivo existe (pendência: a API não lê `.env`); (b) usar `parseEnv(process.env)`; (c) fechar o pool do banco no `onClose` do Fastify e chamar `app.close()` em `SIGINT`/`SIGTERM` (pendência: pool não fechado).
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/api test` e `typecheck` → PASS. Depois `pnpm --filter @alocidadao/api dev` com `S3_ENDPOINT` e sem chaves deve sair com a mensagem de erro.
- [ ] **Step 5: Commit** — `git commit -m "Ambiente da API validado na subida e pool fechado no desligamento"`
