# Backoffice Alô Cidadão, parte B — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A equipe interna ganha P5 Interesse por cidade, P6 Equipe Alô Cidadão e P7 Auditoria. O suporte resolve de dentro do painel os três casos que hoje mandam "falar com o suporte". Saem também as correções pendentes do 6a.

**Architecture:**

- **Banco primeiro.** Toda regra nova fica em funções `SECURITY DEFINER`: separação entre equipe e prefeitura, travas do último Admin, recuperação de conta congelada e leituras entre prefeituras (P5, P6, P7). Assim nada depende só da tela (decisão 0001).
- **API:** rotas novas em `/backoffice/*`, com `requirePlatformStaff`. As correções do suporte são rotas do backoffice chamadas pelo painel em modo suporte.
- **Auditoria:** `staff_audit_events.tenant_id` passa a aceitar nulo, para ações do backoffice.
- **Web:** telas novas no shell do backoffice do 6a. O painel ganha a variação de modo suporte nas janelas de gestor e agente.

**Tech Stack:** o mesmo do 6a. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-28-backoffice-6b-design.md` (aprovado em 28/10/2026). Ver também `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md`, `docs/superpowers/plans/2026-10-26-backoffice-6a.md` e `docs/decisoes/0001-isolamento-por-prefeitura.md`.

## Decisões deste plano (além do spec)

- **Situações comerciais:**
  - `COMMERCIAL_STATUSES = ['new', 'contacted', 'proposal_sent', 'negotiating', 'won', 'lost']`;
  - rótulos: `Sem contato`, `Contatado`, `Proposta enviada`, `Em negociação`, `Fechado`, `Perdido`.
- **Ações novas da auditoria e rótulos**, que vão à lista de textos para o usuário confirmar:

  | Ação                  | Rótulo                                   |
  | --------------------- | ---------------------------------------- |
  | `staff.create`        | `Adicionou uma pessoa à equipe`          |
  | `staff.update`        | `Editou uma pessoa da equipe`            |
  | `staff.role_change`   | `Trocou o papel de uma pessoa da equipe` |
  | `staff.remove`        | `Removeu uma pessoa da equipe`           |
  | `lead.update`         | `Mudou a situação comercial`             |
  | `account.recover`     | `Recuperou uma conta congelada`          |
  | `account.release_cpf` | `Liberou o CPF de uma conta congelada`   |

- **Alvos novos da auditoria (`target_type`):**
  - `staff` (id da conta);
  - `municipality` (o código IBGE vai em `details.ibgeCode`, porque `target_id` é uuid; código IBGE não é dado pessoal);
  - `user`, nas ações `account.*`.
- **`details` aceita só:** `{ route }`, `{ ibgeCode }` e `{ reason: 'implicit' }`.
- **Rótulo do alvo na P7** (a função resolve na hora de ler):
  - `team`, `category` e `department`: o nome;
  - `occurrence`: o protocolo da solicitação mais antiga da ocorrência;
  - `work_order`: o protocolo da ocorrência dela;
  - `agent`, `manager`, `staff` e `user`: o nome da conta, ou `Conta excluída` se ela foi excluída;
  - `tenant`: o nome de exibição;
  - `municipality`: `Nome — UF`;
  - sem alvo: `—`.
- **Conta congelada (CPF preso), rotas genéricas do backoffice.** Servem à P2, à P6 e ao painel em modo suporte:
  - `POST /backoffice/frozen-accounts/recovery-code` `{ cpf, tenantId: uuid | null }`:
    - envia o código (`purpose` `account_recovery`, `user_id` da conta congelada) para o e-mail dela;
    - 200 `{ challengeId, maskedEmail, retryAfterSeconds }`;
    - 404 `frozen_account_not_found`, 409 `frozen_account_without_email`, 429 `code_rate_limited`.
  - `POST /backoffice/frozen-accounts/recover` `{ challengeId, code, email, tenantId }`:
    - descongela a conta, troca o e-mail pelo informado e revoga as sessões antigas;
    - 204;
    - 400 `invalid_code`, 409 `email_in_use`.
  - `POST /backoffice/frozen-accounts/release-cpf` `{ cpf, tenantId }`:
    - tira o CPF da conta congelada, que continua congelada;
    - 204; 404 `frozen_account_not_found`.
  - **Depois:** a tela repete o cadastro original, e ele passa (o CPF agora é de conta ativa, ou está livre).
  - **Na auditoria,** `tenantId` vira a prefeitura do evento: o modo suporte manda a prefeitura, a P2 e a P6 mandam `null`.
- **Separação equipe × prefeitura (só vínculos ativos):**
  - **Cadastro de gestor:** `panel_find_or_create_manager_user` recusa conta com `platform_role` com `staff_account_not_allowed`.
  - **Cadastro de agente:** `panel_find_or_create_agent_user` faz o mesmo. Texto: `Este número é de alguém da equipe Alô Cidadão. Use outro número.`
  - **Adicionar à equipe:** `platform_staff_add` recusa quem tem vínculo ativo de `manager`, `tenant_admin` ou `field_agent` com `tenant_member_not_allowed`. Texto: `Esta pessoa é gestora ou agente de uma prefeitura. Use outro CPF.`
- **Último Admin:**
  - `platform_staff_set_role`, `platform_staff_remove` e `account_delete` recusam deixar a equipe sem Admin, com `last_platform_admin`. Usam `pg_advisory_xact_lock` para duas remoções simultâneas não passarem juntas.
  - Ninguém troca o próprio papel nem se remove: `self_change_not_allowed`.
  - No app, a exclusão recusada mostra: `Você é o último Admin da equipe Alô Cidadão. Passe o papel a outra pessoa antes de excluir a conta.`
- **Saída implícita do modo suporte.** Ao entrar no modo suporte e ao entrar no painel por login, se o último evento `support.*` da pessoa for `support.enter`, grava antes um `support.leave` naquela prefeitura com `details: { reason: 'implicit' }`. Encerrar por tempo sem atividade fica como pendência.
- **Tempo médio:** cada solicitação conta uma vez, pelo evento `awaiting_confirmation` mais recente dela nos últimos 30 dias (a função é `platform_avg_resolution_days`).
- **Troca no modo suporte:** em modo suporte, `panel_change_manager_email` e `panel_change_agent_phone` deixam de recusar por vínculo em outra prefeitura ou por ser admin. A regra do agente que já usou o app (`last_active_at`) continua: ele troca no Perfil.
- **Rotas novas do backoffice:**
  - `GET /backoffice/city-interest` → `{ items: CityInterestRow[] }`;
  - `GET /backoffice/city-interest.csv`;
  - `PUT /backoffice/city-interest/:ibgeCode/status` `{ status }` → 204;
  - `GET /backoffice/staff` → `{ items: StaffMember[] }`;
  - `POST /backoffice/staff` → `{ id }`;
  - `PATCH /backoffice/staff/:userId` `{ name?, email?, platformRole? }` → 204;
  - `DELETE /backoffice/staff/:userId` → 204;
  - `GET /backoffice/audit?tenantId&staffUserId&from&to&page` → `{ items: AuditRow[], total, page, pageSize }` (`pageSize` 50).
  - Quem pode: P5 admin e suporte; P6 e P7 só admin (403 `admin_only`).
- **CSV da P5:**
  - separador `;`, UTF-8 com BOM, datas `dd/mm/aaaa`;
  - colunas `Posição;Município;UF;Pedidos;Últimos 30 dias;Primeiro pedido;Situação comercial;Já é cliente` (`Sim` ou `Não`);
  - arquivo `interesse-por-cidade.csv`.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. Nenhuma dependência nova.
- **Nomes e textos:**
  - Valores e código em inglês; telas em português, com rótulos mapeados no `shared`.
  - Comentários e mensagens em português.
  - Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
  - Textos das telas copiados do Pencil (extraídos na Task 1) ou das decisões acima, sem mudar uma vírgula.
- **Isolamento (decisão 0001):**
  - A API conecta como `app_user`.
  - `app.platform_role` só depois de `requirePlatformStaff` ou `requirePanelMember`, nunca para token `app`.
  - Leitura entre prefeituras só por funções `SECURITY DEFINER`.
- **Migrações:**
  - Não editar 0000–0024.
  - Mudanças estruturais com `pnpm --filter @alocidadao/db exec drizzle-kit generate`.
  - Funções, políticas e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Toda rota declara schema de resposta.
- **Auditoria:** toda ação nova da equipe grava `staff_audit_events` na mesma transação da alteração (como no 6a), sem dado pessoal em `details`.
- **Visual:** tokens e componentes de `apps/web/src/ui/*` e `apps/web/src/styles/tokens.css`; ícones `lucide-react`; todo botão só com ícone tem `aria-label` e todo campo tem `label`.
- **Testes do web:** `@testing-library/react` com o cliente da API simulado (`vi.mock`).
- **Commits:**
  - Mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  - Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa.
- **Branch:** `backoffice-6b`, no próprio checkout (já criado, com o spec).

## Review Focus

1. **Conta de outra pessoa sem verificação:**
   - Liberar o CPF nunca dá acesso ao histórico da conta antiga.
   - Recuperar a conta só com o código certo enviado ao e-mail _da conta congelada_, nunca ao e-mail digitado no cadastro.
   - O desafio só vale para aquela conta.
   - Testes:
     - `recover rejects a challenge issued for another account` (Task 6);
     - `release keeps the frozen account frozen and without cpf` (Task 2).
2. **Equipe sem Admin:**
   - A última remoção, a troca de papel e a exclusão pelo app são recusadas, inclusive em duas chamadas simultâneas.
   - Testes:
     - `duas remoções simultâneas não deixam a equipe sem admin` (Task 2);
     - `last admin cannot delete the account` (Task 5).
3. **Suporte vendo o que é só do Admin:**
   - P6 e P7 respondem 403 `admin_only` ao suporte, e o menu esconde os itens.
   - Testes:
     - `support gets 403 admin_only on staff and audit` (Task 5);
     - `support does not see Equipe and Auditoria in the menu` (Task 8).
4. **Ação sem auditoria ou com dado pessoal:**
   - Toda rota nova de escrita do backoffice grava uma linha.
   - `details` nunca traz CPF, e-mail, nome ou telefone.
   - Teste `every backoffice write route records an audit event without personal data` (Task 6).
5. **Separação equipe × prefeitura com vínculo inativo:**
   - Vínculo desativado não bloqueia.
   - Quem saiu da equipe pode virar gestor.
   - Testes:
     - `vínculo inativo não impede entrar na equipe`;
     - `ex-equipe pode virar gestor` (Task 2).

---

### Task 1: Pencil das telas novas (com revisão do usuário)

Feita por quem coordena, com as ferramentas do Pencil (MCP `pencil`). Não é tarefa de subagente de código.

**Files:**

- Modify: `design/alocidadao.pen` (só pelas ferramentas do Pencil)
- Modify: `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md`, com a seção nova "Parte B (6b)"
- Create: `docs/superpowers/specs/telas-backoffice/P7-auditoria.png`, `P6-adicionar-pessoa.png`, `P6-menu-e-confirmacoes.png`, `P5-menu-situacao.png`, `P4-conta-congelada.png`

- [ ] **Step 1: Desenhar, no padrão das telas P1–P6 e dos componentes do painel:**
  - **P7 Auditoria:** filtros de prefeitura, pessoa e período; tabela com quando, pessoa, prefeitura, ação e alvo; paginação; vazio.
  - **P6:**
    - janela "Adicionar pessoa" (nome, CPF, e-mail, papel) e "Editar";
    - menu "⋯" com Editar, Trocar papel e Remover da equipe;
    - as duas confirmações.
  - **P5:** menu "⋯" com a escolha da situação, e o selo "Já é cliente".
  - **Conta congelada:** o bloco com "Recuperar conta antiga" (envio do código, campo do código) e "Criar conta nova" (confirmação). Ele aparece na janela de gestor em modo suporte, na P2 e na P6.
- [ ] **Step 2:** Exportar as capturas e escrever a seção "Parte B (6b)" no arquivo de extração, no formato das seções P1–P6: textos exatos, estados e o que ficou de fora.
- [ ] **Step 3:** Mostrar ao usuário e esperar a aprovação. Os ajustes pedidos voltam ao Step 1.
- [ ] **Step 4:** Commit: `Backoffice 6b: telas novas no Pencil`.

---

### Task 2: Banco: equipe, interesse, auditoria sem prefeitura e correções

**Files:**

- Modify: `packages/db/src/schema.ts` (`staffAuditEvents.tenantId` aceita nulo; enum `commercial_status` vem do `shared`)
- Modify: `packages/shared/src/enums.ts` (`COMMERCIAL_STATUSES` com `proposal_sent`)
- Create: `packages/db/migrations/0025_*.sql` (gerada) e `packages/db/migrations/0026_backoffice_6b.sql` (`--custom`)
- Create: `packages/db/src/backoffice-6b.test.ts`
- Modify: `packages/db/src/seed-dev-data.ts`, que ganha `city_interest` de exemplo em 3 municípios sem prefeitura e 1 com prefeitura

**Interfaces:**

- Consumes: `app_is_platform_staff()`, `app_is_platform_admin()`, `platform_require_staff(text)`, `app_current_user()`, `app_current_tenant()`.
- Produces (todas `SECURITY DEFINER`, `GRANT EXECUTE TO app_user`):
  - **P5:**
    - `platform_city_interest() RETURNS TABLE (ibge_code char(7), name text, state text, request_count int, last_30_days int, first_at timestamptz, commercial_status commercial_status, is_customer boolean)`, para a equipe; ordem: `request_count` decrescente e depois nome;
    - `platform_set_lead_status(p_ibge_code char(7), p_status commercial_status) RETURNS void`, para a equipe. Faz upsert em `municipality_leads` e grava `lead.update` sem prefeitura, com `details {ibgeCode}`.
  - **P6:**
    - `platform_staff_list() RETURNS TABLE (user_id uuid, name text, cpf text, email text, platform_role platform_role, last_active_at timestamptz)`, só o admin;
    - `platform_staff_add(p_name text, p_cpf text, p_email text, p_role platform_role) RETURNS uuid`, só o admin. Usa conta ativa com o CPF ou cria uma; erros `already_staff`, `tenant_member_not_allowed` e `cpf_unavailable` (conta congelada; reaproveita a exceção de unicidade). Se a conta tem outro e-mail, recusa `cpf_email_mismatch`, como `platform_find_or_create_tenant_admin`;
    - `platform_staff_update(p_user_id uuid, p_name text, p_email text) RETURNS void`, só o admin;
    - `platform_staff_set_role(p_user_id uuid, p_role platform_role) RETURNS void`, só o admin;
    - `platform_staff_remove(p_user_id uuid) RETURNS void`, só o admin.
    - As cinco funções de escrita gravam a ação `staff.*` na auditoria, sem prefeitura.
  - **P7:** `platform_audit_events(p_tenant_id uuid, p_staff_user_id uuid, p_from date, p_to date, p_limit int, p_offset int) RETURNS TABLE (id uuid, created_at timestamptz, staff_name text, tenant_id uuid, tenant_name text, action text, target_type text, target_label text, total bigint)`, só o admin. As datas valem no horário de Brasília, com `p_to` inclusivo.
  - **Conta congelada (para a equipe):**
    - `platform_frozen_account_by_cpf(p_cpf text) RETURNS TABLE (user_id uuid, email text)`: conta `frozen`, não excluída, com o CPF;
    - `platform_recover_frozen_account(p_user_id uuid, p_email text, p_tenant_id uuid) RETURNS void`: `account_status` vai a `active` e `last_active_at` a `now()`, troca o e-mail, revoga as sessões e grava `account.recover`;
    - `platform_release_frozen_cpf(p_cpf text, p_tenant_id uuid) RETURNS void`: `cpf = NULL` e grava `account.release_cpf`.
  - **Funções que mudam:**
    - `account_delete()`:
      - apaga `city_interest` da pessoa;
      - `platform_role = NULL`, recusando `last_platform_admin`;
      - `installation_id = NULL` nas sessões revogadas.
    - `panel_find_or_create_manager_user` e `panel_find_or_create_agent_user`: recusam `staff_account_not_allowed`.
    - `panel_change_manager_email` e `panel_change_agent_phone`: com `app_is_platform_staff()`, sem as recusas de outro vínculo e de admin.
    - `platform_avg_resolution_days`: uma vez por solicitação.
  - **Trigger** `BEFORE INSERT OR UPDATE` em `municipality_leads`: força `updated_by = app_current_user()` e `updated_at = now()`.
  - **Política de inserção** de `staff_audit_events`: aceita `tenant_id IS NULL` com `app_is_platform_staff()` e `staff_user_id = app_current_user()`. As de leitura continuam por prefeitura.
  - **Ajudante interno** `platform_record_audit(p_tenant_id uuid, p_action text, p_target_type text, p_target_id uuid, p_details jsonb)`, sem `GRANT`.

- [ ] **Step 1: Write the failing tests** em `backoffice-6b.test.ts`:
  - `interesse conta pessoas distintas, os últimos 30 dias e marca município cliente`;
  - `mudar situação comercial grava quem mudou e uma linha de auditoria sem prefeitura`;
  - `equipe lista CPF, e-mail e último acesso só para o admin`;
  - `adicionar à equipe recusa gestor ou agente ativo`;
  - `vínculo inativo não impede entrar na equipe`;
  - `ex-equipe pode virar gestor`;
  - `gestor e agente não podem ser da equipe interna`;
  - `ninguém troca o próprio papel nem se remove`;
  - `duas remoções simultâneas não deixam a equipe sem admin` (duas conexões, `Promise.allSettled`, sobra um admin);
  - `excluir conta apaga interesse, papel interno e installation_id`;
  - `último admin não exclui a conta`;
  - `auditoria filtra por prefeitura, pessoa e período e resolve o rótulo do alvo`;
  - `recover reativa a conta congelada com o e-mail novo e revoga sessões`;
  - `release keeps the frozen account frozen and without cpf`;
  - `suporte troca e-mail de gestor com outro painel e celular de agente em duas prefeituras`;
  - `gestor continua recusado nessas trocas`;
  - `tempo médio conta a solicitação republicada uma vez só`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3:** Implementar a migração estrutural, a `0026` e o seed.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test`, `pnpm --filter @alocidadao/api test` e `pnpm typecheck` → PASS. Depois, `pnpm db:migrate` e `pnpm db:seed:dev --reset` no banco local, e conferir com SQL que nenhuma conta tem `platform_role` e vínculo ativo de gestor ou agente ao mesmo tempo. Se tiver, ajustar o seed.
- [ ] **Step 5:** Commit: `Banco do 6b: equipe, interesse, auditoria sem prefeitura e correções`.

---

### Task 3: Contratos do 6b no `shared`

**Files:**

- Modify: `packages/shared/src/backoffice.ts`, `packages/shared/src/backoffice.test.ts`

**Interfaces:**

- Consumes: `COMMERCIAL_STATUSES`, `PLATFORM_ROLES`, `cpfSchema`, `maskEmail`.
- Produces:
  - **Rótulos:**
    - `COMMERCIAL_STATUS_LABELS`;
    - as ações novas em `STAFF_AUDIT_ACTIONS` e `STAFF_AUDIT_ACTION_LABELS`, com os textos das decisões.
  - **P5:**
    - `cityInterestRowSchema = { ibgeCode, name, state, requestCount, last30Days, firstAt: iso datetime, commercialStatus, isCustomer: boolean }`;
    - `cityInterestResponseSchema = { items }`;
    - `leadStatusBodySchema = { status: CommercialStatus }`.
  - **P6:**
    - `staffMemberSchema = { userId, name, maskedCpf, email, platformRole, lastActiveAt: datetime | null }`;
    - `staffListResponseSchema`;
    - `staffCreateBodySchema = { name (2–80, trim), cpf: cpfSchema, email: z.email() em minúsculas, platformRole }`;
    - `staffUpdateBodySchema`: os campos de create sem `cpf`, todos opcionais, com ao menos um.
  - **P7:**
    - `auditQuerySchema = { tenantId?: uuid, staffUserId?: uuid, from?: iso date, to?: iso date, page: int ≥ 1 = 1 }`;
    - `auditRowSchema = { id, at, staffName, tenantId: uuid | null, tenantName: string | null, action, targetType: string | null, targetLabel: string }`;
    - `auditResponseSchema = { items, total, page, pageSize }`.
  - **Conta congelada:**
    - `frozenAccountCodeBodySchema = { cpf, tenantId: uuid | null }`;
    - `frozenAccountCodeResponseSchema = { challengeId, maskedEmail, retryAfterSeconds }`;
    - `frozenAccountRecoverBodySchema = { challengeId, code: /^\d{6}$/, email, tenantId }`;
    - `frozenAccountReleaseBodySchema = { cpf, tenantId }`.
  - **CSV:** `cityInterestCsv(rows: CityInterestRow[]): string`, com o formato das decisões.

- [ ] **Step 1: Write the failing tests:**
  - `every commercial status and staff audit action has a label`;
  - `city interest csv uses semicolons, BOM, pt-BR dates and Sim/Não`;
  - `staff update body requires at least one field`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/shared test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Contratos do 6b: interesse, equipe, auditoria e conta congelada`.

---

### Task 4: API: Interesse por cidade

**Files:**

- Create: `apps/api/src/backoffice/city-interest.ts`, `apps/api/src/backoffice/city-interest.test.ts`
- Modify: `apps/api/src/backoffice/routes.ts`

**Interfaces:**

- Consumes: `platform_city_interest`, `platform_set_lead_status`, os schemas e o `cityInterestCsv` da Task 3.
- Produces: `registerCityInterestRoutes(instance, { db, preHandler })`, com as três rotas da P5.

- [ ] **Step 1: Write the failing tests:**
  - `lists interest with customer flag for admin and support`;
  - `csv download has attachment header and the expected first line`;
  - `support can change commercial status`;
  - `invalid ibge code is 400`;
  - `app token is 403 not_platform_staff`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test city-interest` → FAIL.
- [ ] **Step 3:** Implementar. O CSV sai com `content-type: text/csv; charset=utf-8` e `content-disposition: attachment; filename="interesse-por-cidade.csv"`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e o typecheck → PASS.
- [ ] **Step 5:** Commit: `API do 6b: interesse por cidade`.

---

### Task 5: API: Equipe Alô Cidadão, Auditoria e exclusão de conta

**Files:**

- Create: `apps/api/src/backoffice/staff-routes.ts`, `apps/api/src/backoffice/audit-routes.ts` e os testes `.test.ts` dos dois
- Modify: `apps/api/src/backoffice/routes.ts`, `apps/api/src/me/routes.ts` (409 `last_platform_admin`) e o teste dela

**Interfaces:**

- Consumes: as funções da Task 2 e os schemas da Task 3; `requirePlatformStaff(db, request, reply, ['admin'])`.
- Produces: as rotas `/backoffice/staff*` e `GET /backoffice/audit`. `DELETE /me` passa a responder 409 `last_platform_admin`.

- [ ] **Step 1: Write the failing tests:**
  - `admin adds, edits, changes role and removes staff`;
  - `support gets 403 admin_only on staff and audit`;
  - `adding a manager to staff is 409 tenant_member_not_allowed`;
  - `removing yourself is 409 self_change_not_allowed`;
  - `audit paginates 50 per page and filters by tenant`;
  - `last admin cannot delete the account`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar. As exceções `check_violation` do banco viram 409 com o mesmo código, e a unicidade de e-mail vira `email_in_use`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e o typecheck → PASS.
- [ ] **Step 5:** Commit: `API do 6b: equipe interna e auditoria`.

---

### Task 6: API: conta congelada, saída implícita do suporte e alvo do agente

**Files:**

- Create: `apps/api/src/backoffice/frozen-accounts.ts`, `apps/api/src/backoffice/frozen-accounts.test.ts`
- Modify:
  - `apps/api/src/backoffice/routes.ts` (saída implícita no `support/enter`);
  - `apps/api/src/auth/panel-routes.ts` (saída implícita no login de quem é da equipe);
  - `apps/api/src/panel/audit.ts` (`POST /panel/teams/:id/agents` com alvo `agent`, id tirado da resposta);
  - `apps/api/src/panel/teams.ts` e `apps/api/src/panel/admin.ts` (`staff_account_not_allowed`);
  - os testes deles.

**Interfaces:**

- Consumes:
  - `issueChallenge` e `hashCode` (`apps/api/src/auth/codes.ts`), `auth_consume_code`, `codeEmail`, o `EmailSender` da app;
  - as funções `platform_frozen_account_by_cpf`, `platform_recover_frozen_account` e `platform_release_frozen_cpf`.
- Produces: as três rotas `/backoffice/frozen-accounts/*` das decisões, para admin e suporte.

- [ ] **Step 1: Write the failing tests:**
  - `recovery code goes to the frozen account email, never the typed one`;
  - `recover rejects a challenge issued for another account`;
  - `recover with a wrong code is 400 invalid_code`;
  - `release then manager create succeeds with a new account`;
  - `frozen account without email is 409 frozen_account_without_email`;
  - `entering another tenant writes an implicit leave for the previous one`;
  - `adding an agent audits the agent as target`;
  - `registering a staff account as manager or agent is 409 staff_account_not_allowed`;
  - `every backoffice write route records an audit event without personal data`: percorre as rotas de escrita de `/backoffice/*` e confere que cada chamada grava uma linha cujo `details` só tem chaves de `route`, `ibgeCode` ou `reason`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar. Para o desafio valer para a conta certa, o `recover` confere que `consumed.purpose === 'account_recovery'` e que `consumed.userId` é a conta congelada do desafio. O limite de envio é o de `auth_issue_code`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e o typecheck → PASS.
- [ ] **Step 5:** Commit: `API do 6b: conta congelada e saída implícita do suporte`.

---

### Task 7: Cliente da API do 6b

**Files:**

- Modify: `packages/api-client/src/index.ts`, `packages/api-client/src/index.test.ts`

**Interfaces:**

- Produces:
  - `backofficeCityInterest()`;
  - `backofficeCityInterestCsvUrl(): string`. A tela baixa o arquivo com `fetch` autenticado; usar o `send` com resposta em texto se ele permitir;
  - `backofficeSetLeadStatus(ibgeCode, status)`;
  - `backofficeStaff()`, `backofficeAddStaff(body)`, `backofficeUpdateStaff(userId, body)`, `backofficeRemoveStaff(userId)`;
  - `backofficeAudit(query)`;
  - `backofficeFrozenAccountCode(body)`, `backofficeRecoverFrozenAccount(body)`, `backofficeReleaseFrozenCpf(body)`.
  - Nenhuma manda `x-tenant-id`.

- [ ] **Step 1: Write the failing tests:** `6b backoffice methods call the right paths without x-tenant-id` (um caso por método, como no 6a).
- [ ] **Step 2:** `pnpm --filter @alocidadao/api-client test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api-client test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Cliente da API: métodos do backoffice 6b`.

---

### Task 8: Web: P6 Equipe Alô Cidadão e menu por papel

**Files:**

- Create:
  - `apps/web/src/backoffice/staff/StaffPage.tsx` e `StaffPage.test.tsx`;
  - `apps/web/src/backoffice/staff/StaffDialog.tsx`;
  - `apps/web/src/backoffice/frozen/FrozenAccountPanel.tsx` e `FrozenAccountPanel.test.tsx` (usado também nas Tasks 11 e 12).
- Modify: `apps/web/src/App.tsx` (rota `/backoffice/equipe`), `apps/web/src/backoffice/backoffice-menu.ts` e `BackofficeSidebar.tsx` (itens com `adminOnly`).

**Interfaces:**

- Consumes: os métodos da Task 7, `use-backoffice-context`, os textos da seção "Parte B (6b)" da Task 1.
- Produces: `FrozenAccountPanel({ cpf, email, tenantId, onResolved }: { cpf: string; email: string; tenantId: string | null; onResolved: () => void })`. O componente mostra "Recuperar conta antiga" (envio e campo do código) e "Criar conta nova" (confirmação), e chama `onResolved` para a tela repetir o cadastro.

- [ ] **Step 1: Write the failing tests:**
  - `admin sees the staff table with masked cpf and role badges`;
  - `add person submits and shows the new row`;
  - `remove asks for confirmation and hides self actions`;
  - `support does not see Equipe and Auditoria in the menu`;
  - `support opening /backoffice/equipe goes back to prefeituras`;
  - `frozen account panel recovers with a code and calls onResolved`;
  - `frozen account panel without email offers only a new account`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar conforme o Pencil.
- [ ] **Step 4:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/web typecheck` → PASS.
- [ ] **Step 5:** Commit: `Backoffice: P6 Equipe Alô Cidadão`.

---

### Task 9: Web: P5 Interesse por cidade

**Files:**

- Create: `apps/web/src/backoffice/interest/CityInterestPage.tsx`, `CityInterestPage.test.tsx` e `CityInterestPage.module.css`
- Modify: `apps/web/src/App.tsx` (rota `/backoffice/interesse`)

**Interfaces:**

- Consumes: `backofficeCityInterest`, `backofficeSetLeadStatus`, o CSV da Task 7, `COMMERCIAL_STATUS_LABELS`.

- [ ] **Step 1: Write the failing tests:**
  - `shows ranking with +N last 30 days and Já é cliente badge`;
  - `changing status from the row menu updates the badge`;
  - `export downloads interesse-por-cidade.csv`;
  - `empty list shows the empty text from Pencil`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar conforme o Pencil.
- [ ] **Step 4:** Testes e typecheck do web → PASS.
- [ ] **Step 5:** Commit: `Backoffice: P5 Interesse por cidade`.

---

### Task 10: Web: P7 Auditoria

**Files:**

- Create: `apps/web/src/backoffice/audit/AuditPage.tsx`, `AuditPage.test.tsx` e `AuditPage.module.css`
- Modify: `apps/web/src/App.tsx` (rota `/backoffice/auditoria`; `ComingSoon` passa a cobrir só as abas da P3)

**Interfaces:**

- Consumes: `backofficeAudit`, `backofficeTenants` (opções do filtro de prefeitura), `backofficeStaff` (opções do filtro de pessoa), `STAFF_AUDIT_ACTION_LABELS`.

- [ ] **Step 1: Write the failing tests:**
  - `lists events with action labels and dash for backoffice actions`;
  - `filters by tenant, person and period and resets to page 1`;
  - `paginates`;
  - `unknown action shows Fez uma alteração`.
- [ ] **Step 2:** Testes do web → FAIL.
- [ ] **Step 3:** Implementar conforme o Pencil. Os filtros vão na URL (`useSearchParams`) para o link ser compartilhável.
- [ ] **Step 4:** Testes e typecheck do web → PASS.
- [ ] **Step 5:** Commit: `Backoffice: P7 Auditoria`.

---

### Task 11: Web: correções do suporte no painel, P2 e ajustes do 6a

**Files:**

- Modify:
  - `apps/web/src/managers/ManagerDialog.tsx` e `apps/web/src/teams/AgentDialog.tsx`, com os testes;
  - `apps/web/src/backoffice/tenants/NewTenantPage.tsx` e `NewTenantPage.module.css` (bloco de conta congelada e o rótulo "Central de atendimento" alinhado), com o teste;
  - `apps/web/src/review/*`: correção do 404 depois de publicar; a causa é investigada no Step 1;
  - `apps/mobile/src/components/ProfileContent.tsx`: mensagem `last_platform_admin`.

**Interfaces:**

- Consumes: `FrozenAccountPanel` (Task 8), `getSupportTenant()` (`apps/web/src/session/support-tenant.ts`) para saber se está em modo suporte.

- [ ] **Step 1:** Reproduzir o 404 de `GET /panel/reviews/:id` depois de publicar e escrever o teste que o pega. Suspeita: a invalidação depois da publicação refaz a consulta do detalhe, que deixou de existir.
- [ ] **Step 2: Write the failing tests:**
  - `in support mode cpf_unavailable shows the frozen account panel and retries`;
  - `outside support mode cpf_unavailable keeps the 6a message`;
  - `staff_account_not_allowed on agent shows the staff phone message`;
  - `new tenant with frozen admin cpf offers recovery`;
  - `publishing a review does not refetch the published detail`;
  - no app, `deleting the account as last admin shows the message`.
- [ ] **Step 3:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 4:** Implementar. Em modo suporte, `email_change_not_allowed` e `phone_change_not_allowed` não chegam mais (a API aceita), e os textos atuais continuam para o gestor.
- [ ] **Step 5:** Testes e typecheck do web e do mobile → PASS.
- [ ] **Step 6:** Commit: `Painel: correções de conta pelo suporte e ajustes do 6a`.

---

### Task 12: Documentação, pendências e passada no navegador

**Files:**

- Modify:
  - `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`: marcar o que o 6b fechou; listar os textos criados sem Pencil para o usuário confirmar; pendências novas, como encerrar o modo suporte por tempo sem atividade e as abas da P3;
  - este plano: seção "Resultado no navegador";
  - `README.md` ou `docs/` onde o 6a documentou o backoffice.

- [x] **Step 1:** Subir API e web (`pnpm dev`, depois de matar processos antigos na porta 3333). No navegador, com o admin e o suporte do seed, passar por:
  - P5 (mudar situação, exportar);
  - P6 (adicionar, editar, trocar papel, remover, último admin);
  - P7 (filtros);
  - modo suporte (troca de e-mail, CPF de conta congelada com recuperar e com criar nova);
  - P2 com CPF congelado.
- [x] **Step 2:** Registrar no plano o que foi visto e o que não deu para ver.
- [x] **Step 3:** `pnpm test`, `pnpm lint`, `pnpm format:check` e `pnpm typecheck` → PASS.
- [x] **Step 4:** Commit: `Backoffice 6b: documentação, pendências e passada no navegador`.

## Resultado no navegador

29/10/2026, Playwright (Chromium) em 1440x900, com o código fixo de desenvolvimento `123456`. Antes da passada: processos antigos das portas 3333 e 5173 parados, `pnpm db:migrate`, `pnpm db:seed:dev --reset` e `pnpm dev`. Entradas: Admin Demo (`11144477735`) e Suporte Demo (`86288366757`).

**Dados criados só no banco de desenvolvimento.** O seed não tem conta congelada. Para a passada, cinco contas congeladas foram inseridas por SQL no banco local (`account_status = 'frozen'`, com CPF e e-mail; CPFs `12312312387`, `32132132178`, `45645645014`, `65465465077` e `11122233396`). Na primeira tentativa de "Criar conta nova" elas estavam sem telefone, o que deu 500 (ver "Problemas"); depois ganharam telefone, como as congeladas de verdade (o número reaproveitado é o único caminho que congela uma conta com CPF). A passada também criou as prefeituras de Campinas (SP) e de Campinas do Sul (RS), mudou situações da P5 e trocou o e-mail de Carlos Demo para `carlos.novo@alocidadao.dev`; o `--reset` não desfaz tudo isso.

**Telas sem Pencil.** O limite de uso do pen.dev bloqueou a Task 1. As telas foram feitas no código seguindo o padrão do Pencil; as capturas abaixo são para o usuário aprovar e, em 31/10, viram o desenho no Pencil (Task 1b).

Capturas em `docs/superpowers/specs/telas-backoffice/`: `P6-equipe.png`, `P6-adicionar-pessoa.png`, `P6-menu-e-confirmacoes.png`, `P6-confirmacao-trocar-papel.png`, `P6-confirmacao-remover.png`, `P6-conta-congelada.png`, `P5-menu-situacao.png`, `P7-auditoria.png`, `P4-conta-congelada.png`, `P4-criar-conta-nova.png`, `P2-conta-congelada.png`.

| Passo                                   | Resultado                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6 lista                                | OK (`P6-equipe`): `Admin Demo` (Admin, `hoje, 11:56`) e `Suporte Demo` (Suporte, `há 3 dias`), CPF mascarado, cartões de papel.                                                                                                                                                                               |
| P6 adicionar                            | OK (`P6-adicionar-pessoa`): `Bruna Equipe` como Suporte; aviso `Bruna Equipe entrou na equipe.`; `nunca entrou` na lista.                                                                                                                                                                                     |
| P6 editar                               | OK: janela `Editar pessoa` (nome e e-mail; CPF só mascarado); nome trocado, aviso `Pessoa salva.`.                                                                                                                                                                                                            |
| P6 trocar papel                         | OK (`P6-menu-e-confirmacoes`, `P6-confirmacao-trocar-papel`): menu `Editar`, `Trocar papel`, `Remover da equipe`; `Trocar o papel de Bruna Equipe Silva?` / `… passa de Suporte para Admin.`; aviso `… agora é Admin.`.                                                                                       |
| P6 remover                              | OK (`P6-confirmacao-remover`): `Remover … da equipe?` com o texto do plano; aviso `… saiu da equipe.`; a linha some.                                                                                                                                                                                          |
| P6 própria linha                        | OK: o menu de `Admin Demo` (quem está logado) só tem `Editar`.                                                                                                                                                                                                                                                |
| P6 último Admin                         | Não dá para provocar pela tela: ninguém troca o próprio papel nem se remove, então sempre sobra quem está agindo. Só os testes cobrem `last_platform_admin` (banco, API e a mensagem do app).                                                                                                                 |
| P6 CPF congelado                        | OK (`P6-conta-congelada`): o bloco aparece no `Salvar`; `Recuperar conta antiga` envia o código (`Enviamos um código para a•••@alocidadao.dev, o e-mail da conta antiga.`); código errado mostra `Código incorreto ou expirado. Confira ou peça um novo.`; com `123456` a conta volta e entra na equipe.      |
| P5 lista                                | OK: 4 municípios, `Cidade Demo — SP` com `Já é cliente`, `+N` nos últimos 30 dias, nota de privacidade.                                                                                                                                                                                                       |
| P5 mudar situação                       | OK (`P5-menu-situacao`): 6 situações, visto na atual; `Contatado` (azul), `Fechado` (verde), `Perdido` (cinza); aviso `Vila Sem Adesão — SP: Contatado.`. O suporte também muda (`Proposta enviada`).                                                                                                         |
| P5 exportar                             | OK: baixa `interesse-por-cidade.csv`, UTF-8 com BOM, `;`, colunas e datas do plano, `Sim` só na Cidade Demo.                                                                                                                                                                                                  |
| P7 lista                                | OK (`P7-auditoria`): as ações da passada com os rótulos novos e os alvos resolvidos (pessoa, `Município — UF`, protocolo, prefeitura); `—` na prefeitura das ações sem prefeitura.                                                                                                                            |
| P7 filtros                              | OK: prefeitura (5 linhas), prefeitura + pessoa (3), `De` (9), `De` depois de `Até` (vazio `Nenhuma ação com estes filtros.`), só `Até` (12); filtros na URL (`?prefeitura=…`, `?de=…&ate=…`).                                                                                                                 |
| Modo suporte, troca de e-mail           | OK: admin entrou na Prefeitura Demo A; e-mail de Carlos Demo trocado, aviso `Gestor salvo.`, auditoria `manager.update` (depois da revisão final, a troca de e-mail grava `manager.email_change`).                                                                                                            |
| Modo suporte, CPF congelado, recuperar  | OK (`P4-conta-congelada`): `Novo gestor` com CPF congelado mostra o bloco; código enviado ao e-mail da conta antiga; a conta volta ativa com o e-mail digitado e vira gestora; auditoria `account.recover` na prefeitura.                                                                                     |
| Modo suporte, CPF congelado, criar nova | OK depois da correção dos dados (`P4-criar-conta-nova`): confirmação `Criar conta nova?` sobre a janela; `Eva Gestora cadastrado como gestor.`; a conta antiga continua congelada e sem CPF; auditoria `account.release_cpf`.                                                                                 |
| P2 CPF congelado, recuperar             | OK (`P2-conta-congelada`): bloco abaixo do e-mail do admin; recuperada, a P2 repete o cadastro e abre a P3 de `Prefeitura de Campinas`.                                                                                                                                                                       |
| P2 CPF congelado, criar nova            | OK: `Prefeitura de Campinas do Sul` criada com conta nova; a antiga continua congelada e sem CPF.                                                                                                                                                                                                             |
| Suporte no backoffice                   | OK: menu só com `Prefeituras` e `Interesse por cidade`; `/backoffice/equipe` e `/backoffice/auditoria` voltam para a P1.                                                                                                                                                                                      |
| Auditoria no banco                      | OK: `staff.create`, `staff.update`, `staff.role_change`, `staff.remove`, `lead.update` (`{ ibgeCode }`), `account.recover` e `account.release_cpf` (sem `details`), `support.enter`/`support.leave`; nenhum dado pessoal em `details`. Na P2 e na P6 a prefeitura vai nula; no modo suporte, a da prefeitura. |

Problemas achados e corrigidos:

- **Menu ⋯ da P5 cortado** (só 3 das 6 situações apareciam): o `main` da página não ocupava a altura toda e o `overflow: auto` cortava o menu da última linha. `.content` da P5 e da P6 ganhou `flex: 1`; o item do `RowMenu` ficou `flex` com espaço entre o texto e o visto (`Sem contato✓` estava colado). Só CSS, sem teste de unidade; conferido no navegador. Commit `Backoffice: menu ⋯ da P5 sem corte e visto separado do texto`.

O que chamou atenção e não foi mudado (anotado nas pendências):

- **Liberar CPF de conta congelada sem telefone dá 500** (`users_phone_or_cpf_check`). Só aconteceu com os dados inseridos à mão; nenhum caminho de hoje congela uma conta com CPF e sem telefone. Corrigido na revisão final: a função recusa com `frozen_account_without_phone` (409) e o bloco mostra uma mensagem.
- **Conta recuperada mantém o nome antigo.** O nome digitado é ignorado (a conta existente vale). Na P6 o aviso usou o nome digitado (`Carla Nova entrou na equipe.`) e a lista mostrou o da conta (`Congelada P6`). Corrigido na revisão final: o aviso usa o nome da lista relida.
- A tabela de gestores tem cabeçalho `⋯` (pendência antiga do 5b).
- O console mostra os 409 do cadastro com CPF congelado (o que abre o bloco) e o 500 acima.

Não executado no navegador (só os testes cobrem):

- P6: `last_platform_admin`, `self_change_not_allowed`, `already_staff`, `tenant_member_not_allowed`, `staff_not_found`, `email_mismatch`; erro de carga.
- Conta bloqueada: `frozen_account_without_email`, `Enviar outro código` e o aviso de 429, `email_in_use` na recuperação, `tenant_not_found`.
- P5: vazio, erro de carga, erro ao mudar situação e ao exportar.
- P7: segunda página (só havia 21 linhas), páginas além da última, parâmetros inválidos na URL, alvo `Conta excluída`.
- Modo suporte: troca de celular de agente com vínculo em outra prefeitura; cadastro de agente com número da equipe; saída implícita (`support.leave` com `reason: 'implicit'`).
- App: exclusão da conta pelo último Admin.
- Conferência de pixels (não há Pencil das telas novas) e larguras menores que 1440.
