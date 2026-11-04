# Convite por e-mail e Termos/Privacidade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem é cadastrado (admin da prefeitura, gestor, agente, equipe Alô Cidadão) recebe um convite por e-mail que explica como entrar sem senha; existem textos-modelo de Termos de Uso e Política de Privacidade, publicados num site estático e mostrados no app e no painel; e toda conta aceita os Termos (e declara ciência da Política) antes de usar o sistema, com a API bloqueando quem não aceitou.

**Architecture:**

- **Texto jurídico numa fonte só:** `packages/shared/src/legal/` exporta os dois documentos como dados (`LegalDocument`). App, painel e site renderizam esses dados; nenhum deles tem cópia do texto.
- **Convites na API:** modelos puros em `apps/api/src/messaging/invites.ts` (HTML + texto). O envio acontece **depois** da transação do cadastro, num `sendInvite` que registra a entrega em `invite_deliveries` e nunca lança erro para a rota. O agente só recebe com a prefeitura ativa; a ativação dispara os convites pendentes.
- **Bloqueio dos termos no `requireAuth`:** com o portão ligado (`auth.termsGate`, ligado no `server.ts`), toda rota autenticada confere `users.terms_version` e responde `403 terms_required`, exceto as rotas marcadas `allowWithoutTerms`.

**Tech Stack:** o mesmo dos planos anteriores (Fastify 5, Drizzle, Postgres com RLS, React 19 + Vite, Expo Router, Zod 4, Vitest). O site estático é gerado por um script `tsx` sem framework. Nenhuma dependência nova fora de `apps/site` (que só usa `tsx`, `vite`, `vitest` e `@alocidadao/shared`, todos já presentes no monorepo).

**Spec:** `docs/superpowers/specs/2026-11-04-convite-e-termos-design.md`, aprovado em 04/11/2026.

## Decisões deste plano (além do spec)

- **`TERMS_VERSION`** passa de `'2026-10-23'` para `'2026-11-04'`. Quem tem qualquer `terms_version` não nulo conta como "aceitou" (`termsAccepted = terms_version IS NOT NULL`): versão nova não pede novo aceite (decisão do usuário).
- **Registro de entregas:** tabela nova `invite_deliveries (id uuid pk, user_id uuid not null → users, tenant_id uuid null → tenants, kind invite_kind not null, sent_by uuid null → users, sent_at timestamptz not null default now())`, índice `(user_id, tenant_id, kind, sent_at desc)`. Enum `invite_kind`: `panel`, `agent`, `staff`. `tenant_id` é nulo para `staff`. Serve para: convite pendente de agente (nenhuma linha `agent` para o par usuário/prefeitura) e limite de reenvio.
- **Limite de reenvio:** `INVITE_RESEND_SECONDS = 60` no `shared`. Reenvio antes disso → `429 { code: 'rate_limited', retryAfterSeconds }` (mesmo formato do `app.ts`). O envio automático do cadastro não passa pelo limite.
- **Auditoria:** só a equipe interna é auditada no projeto (`staff_audit_events`). O reenvio feito pela equipe (P3, P6 e painel em modo suporte) grava `invite.resend`; a troca de e-mail do agente grava `agent.email_change`. Ações de admin/gestor da prefeitura continuam sem auditoria, como hoje. `STAFF_AUDIT_ACTIONS` passa de 38 para 40.
- **Remetente:** `EmailMessage` ganha `html?: string` e `fromName?: string`. O Resend recebe `from: "{fromName} <endereço do EMAIL_FROM>"` quando há `fromName`, e `html` junto com `text`. O endereço é extraído do `EMAIL_FROM` (`Nome <addr>` ou só `addr`).
- **Configuração nova (`env.ts`):** `PANEL_URL` (padrão fora de produção `http://localhost:5173`; obrigatória em produção), `AGENT_APP_PLAY_URL` e `AGENT_APP_STORE_URL` (opcionais). Os botões apontam para `${PANEL_URL}/entrar`.
- **Rotas novas:**
  - `POST /panel/managers/:userId/invite` (admin da prefeitura; não vale para o próprio `tenant_admin`, que não tem menu)
  - `POST /panel/agents/:userId/invite` (admin ou gestor que já cadastra agentes; prefeitura `active`, senão `409 tenant_not_active`)
  - `POST /backoffice/staff/:userId/invite` (Admin da equipe, como as outras rotas da P6)
  - `POST /backoffice/tenants/:id/managers/:userId/invite` (Admin e Suporte; vale para gestor e `tenant_admin`)
  - `POST /me/terms` com `{ acceptedTermsVersion: TERMS_VERSION }` → `204`
  - Todas as de convite respondem `200 { maskedEmail }`. Conta sem e-mail → `409 email_missing`; vínculo inativo ou conta congelada → `409 invite_not_allowed`.
- **Agente:** `agentCreateBodySchema` ganha `email: z.email()` (obrigatório, minúsculas). `agentRowSchema` ganha `email: z.string().nullable()` (sem máscara, como na lista de gestores). `agentUpdateBodySchema` ganha `{ action: 'change_email', email }`. Erros: `email_in_use`, `email_mismatch` com `maskedEmail` (pessoa achada pelo celular já tem outro e-mail), `email_change_not_allowed`.
- **Mobile, leitura do texto:** telas `apps/mobile/src/app/termos.tsx` e `apps/mobile/src/app/privacidade.tsx` na raiz (fora de `(auth)` e `(app)`), abertas com `?aceite=1` quando vêm de uma caixa de aceite. "Li e concordo" chama `markLegalRead()` de `apps/mobile/src/legal/acceptance-store.ts` e volta.
- **Textos novos de tela** (aprovar o plano aprova estes textos):
  - Caixa: "Li e aceito os Termos de Uso e estou ciente da Política de Privacidade." ("Termos de Uso" e "Política de Privacidade" são links)
  - Botão no fim do texto: "Li e concordo"
  - Tela de aceite (app e painel): título "Antes de continuar"; apoio "Para usar o Alô Cidadão, leia e aceite os Termos de Uso."; botão "Continuar"; link "Sair"
  - Menus: "Reenviar convite"; "Trocar e-mail"
  - Aviso: "Convite reenviado para {e-mail mascarado}."
  - Diálogo "Trocar e-mail": título "Trocar e-mail"; campo "E-mail"; botão "Salvar"
  - Erros: `email_missing` → "Cadastre um e-mail para enviar o convite."; `email_mismatch` → "Esta pessoa já tem outro e-mail cadastrado ({maskedEmail}). Use esse e-mail."; `email_change_not_allowed` → "O e-mail desta pessoa só pode ser trocado pelo suporte do Alô Cidadão."; `tenant_not_active` → "O convite do agente é enviado quando a prefeitura for ativada."; `invite_not_allowed` → "Esta conta não está ativa."
  - Links no painel: "Termos de Uso" e "Política de Privacidade", no rodapé do menu da conta.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4, pnpm 9. Nenhuma dependência nova além do `apps/site` descrito acima.
- **Nomes e textos:** código em inglês; textos em português, copiados das Decisões e do spec sem mudar uma vírgula. Comentários em português. Nomes de teste em português em `packages/db`, em inglês nos outros pacotes.
- **Sem Pencil neste pacote** (decisão do usuário em 04/11/2026). Telas com os componentes de `apps/web/src/ui/*` e `apps/mobile/src/ui/*`.
- **Nunca mencionar senha** em e-mail ou tela.
- **Caixa de aceite sempre começa desmarcada**; botão de continuar desabilitado sem ela.
- **Política = ciência**, nunca "concordo com o tratamento".
- **Falha de envio não desfaz cadastro:** `sendInvite` captura o erro, registra no log (`warn`) e a rota responde normalmente.
- **Isolamento (decisão 0001):** funções novas `SECURITY DEFINER` com `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO app_user`. Não editar migrações 0000–0041.
- **Erros da API:** `{ code }` em snake_case; toda rota declara schema de resposta. Rotas não-GET novas do `/panel` entram em `PANEL_AUDIT_ACTIONS`.
- **Testes:** web com `@testing-library/react` e `vi.mock` do cliente; API com `buildApp`; banco com `owner`/`app` como em `packages/db/src/rls.test.ts`.
- **Commits:** mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antes de cada commit: `pnpm lint`, `pnpm format:check`, testes e typecheck dos pacotes tocados.

## Review Focus

1. **Pessoa que já existe vira agente** (cidadão com e-mail próprio): o convite vai para o e-mail que já está na conta, e e-mail diferente no cadastro é recusado com `email_mismatch`. Teste na Task 3.
2. **Prefeitura ativada com agentes de situações diferentes** (convidado, desativado, sem e-mail, já com entrega): a ativação envia só a agentes com vínculo `invited`/`active`, com e-mail e sem entrega `agent` registrada; desativado não recebe. Teste na Task 4.
3. **Portão dos termos com app antigo**: o app que não conhece `terms_required` recebe 403 e não pode entrar em laço; o app novo abre a tela de aceite. Teste do portão na Task 5 (rota liberada `/me` e `/auth/logout` respondem sem aceite) e do roteamento na Task 8.
4. **Portão desligado por engano em produção:** `server.ts` liga `termsGate: true`; teste na Task 5 que `buildApp` com `termsGate: true` bloqueia e que o padrão do `parseEnv` em produção não tem como desligar.
5. **E-mail com HTML e nomes com caracteres especiais** (`<`, `&`, aspas no nome da pessoa, da equipe ou da prefeitura): o HTML escapa tudo que vem do banco. Teste na Task 2.

---

### Task 1: Textos-modelo de Termos e Privacidade (com revisão do usuário)

**Files:**
- Create: `packages/shared/src/legal/types.ts`, `packages/shared/src/legal/terms.ts`, `packages/shared/src/legal/privacy.ts`, `packages/shared/src/legal/index.ts`
- Create: `packages/shared/src/legal/legal.test.ts`
- Modify: `packages/shared/src/auth.ts:16` (`TERMS_VERSION = '2026-11-04'`), `packages/shared/src/index.ts` (exportar `legal`)

**Interfaces:**
- Produces:
  ```ts
  type LegalBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };
  type LegalSection = { heading: string; blocks: LegalBlock[] };
  type LegalDocument = { slug: 'termos' | 'privacidade'; title: string; version: string; notice: string; sections: LegalSection[] };
  export const TERMS_OF_USE: LegalDocument;   // slug 'termos', title 'Termos de Uso'
  export const PRIVACY_POLICY: LegalDocument; // slug 'privacidade', title 'Política de Privacidade'
  export const LEGAL_DOCUMENTS: Record<LegalDocument['slug'], LegalDocument>;
  ```
  `version` é `TERMS_VERSION`. `notice` é "Versão de testes. Este texto é um modelo e será substituído pela versão revisada pelo jurídico antes do uso em produção."

- [ ] **Step 1: Teste** `legal.test.ts`: os dois documentos têm `version === TERMS_VERSION`; nenhum texto contém `/senha/i`; a Política não contém `/concordo|consentimento para o tratamento/i`; a Política cita `art. 7º, III` e `art. 23` e `art. 18`; ambos contêm `[A DEFINIR]` ao menos uma vez; `LEGAL_DOCUMENTS.termos === TERMS_OF_USE`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test -- legal` → FAIL (módulo não existe).
- [ ] **Step 3: Escrever os textos** seguindo a lista de tópicos da seção 6 do spec, a partir do que o sistema faz (ler `docs/planejamento-mvp.md` para os dados coletados). Linguagem simples, frases curtas, em português do Brasil. Pontos da empresa/jurídico como `[A DEFINIR: razão social]`, `[A DEFINIR: CNPJ]`, `[A DEFINIR: encarregado e contato]`, `[A DEFINIR: prazo de guarda]`, `[A DEFINIR: foro]`.
- [ ] **Step 4:** teste → PASS; `pnpm --filter @alocidadao/shared typecheck` limpo.
- [ ] **Step 5: Parar e mostrar ao usuário.** O controlador mostra os dois textos completos ao usuário e só segue com o "ok" dele (spec, seção 6). Ajustes pedidos entram antes do commit.
- [ ] **Step 6: Commit** "Textos-modelo de Termos de Uso e Política de Privacidade".

### Task 2: E-mail em HTML e modelos de convite

**Files:**
- Modify: `apps/api/src/messaging/email.ts` (tipos e Resend), `apps/api/src/env.ts` (+ `env.test.ts`)
- Create: `apps/api/src/messaging/invites.ts`, `apps/api/src/messaging/invites.test.ts`
- Modify: `packages/shared/src/` — onde estão `CODE_RESEND_SECONDS`: `INVITE_RESEND_SECONDS = 60`

**Interfaces:**
- Produces:
  ```ts
  interface EmailMessage { to: string; subject: string; text: string; html?: string; fromName?: string }
  type InviteLinks = { panelUrl: string; playStoreUrl: string | null; appStoreUrl: string | null };
  function panelInviteEmail(p: { to: string; name: string; tenantName: string; role: 'tenant_admin' | 'manager'; links: InviteLinks }): EmailMessage;
  function agentInviteEmail(p: { to: string; name: string; tenantName: string; teamName: string; phone: string; links: InviteLinks }): EmailMessage;
  function staffInviteEmail(p: { to: string; name: string; platformRole: PlatformRole; links: InviteLinks }): EmailMessage;
  // env: ApiEnv.invites: InviteLinks
  ```
  Perfil no texto: `tenant_admin` → "Administrador da prefeitura", `manager` → "Gestor"; papel da equipe pelo rótulo já usado na P6.

- [ ] **Step 1: Testes** em `invites.test.ts`:
  - `panelInviteEmail`: `subject === 'Você foi convidado para o painel do Alô Cidadão'`; `fromName === 'Alô Cidadão · Prefeitura de Goiânia'`; `html` contém `href="http://painel.test/entrar"` e "Entrar no painel"; `text` contém "digite o seu CPF" e "Não existe senha"; primeiro nome ("Maria" de "Maria Souza").
  - `agentInviteEmail` com os dois links: dois `href` das lojas, "Iluminação Pública", `(62) •••••-4321` (via `maskPhone`), "código por SMS"; sem links: contém "Procure <b>Alô Cidadão</b> na loja" (HTML) e nenhum "Baixar".
  - `staffInviteEmail`: `subject === 'Você foi adicionado à equipe do Alô Cidadão'`, `fromName === 'Alô Cidadão'`, "Entrar no backoffice".
  - Escape: nome `Ana <b>&"x"` aparece como `Ana &lt;b&gt;&amp;&quot;x&quot;` no HTML.
  - Nenhum dos três contém `/senha/i`.
  - Em `email.test.ts` (criar se não houver): Resend recebe `from: 'Alô Cidadão · Prefeitura de Goiânia <nao-responda@alocidadao.com.br>'` e `html` quando a mensagem tem os dois; sem `fromName`, usa o `from` original.
  - Em `env.test.ts`: `PANEL_URL` obrigatória em produção; padrão `http://localhost:5173` fora; lojas opcionais → `null`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api exec vitest run src/messaging src/env.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** HTML de e-mail com `<table>` e estilos inline, cores `#0057b8` (faixa), `#009e60` (botão), fundo `#f1f5f9`, cartão branco — layout do mockup B (`../.superpowers/brainstorm/*/content/convite-*.html`). Textos da seção 3.3 do spec. Uma função `escapeHtml` local.
- [ ] **Step 4:** testes → PASS; typecheck da API.
- [ ] **Step 5: Commit** "Modelos do e-mail de convite em HTML".

### Task 3: Banco — e-mail do agente, entregas de convite

**Files:**
- Modify: `packages/db/src/schema.ts` (enum `invite_kind`, tabela `inviteDeliveries`)
- Create: migração estrutural `0042_*` (`drizzle-kit generate`) e SQL próprio `0043_invites.sql` (`--custom`)
- Test: `packages/db/src/invites.test.ts`

**Interfaces:**
- Produces (SQL, todas `SECURITY DEFINER`):
  - `panel_find_or_create_agent_user(p_name text, p_phone text, p_email text) RETURNS TABLE (id uuid, email text)` — substitui a de dois parâmetros (fazer `DROP FUNCTION panel_find_or_create_agent_user(text, text)`). Mesmo comportamento de hoje; ao criar, grava o e-mail; achou sem e-mail → grava; achou com e-mail → devolve o existente (a API compara).
  - `panel_change_agent_email(p_user_id uuid, p_email text) RETURNS void` — espelho de `panel_change_manager_email` da 0026 (`panel_require_manager(..., false)`), recusando `email_change_not_allowed` quando a pessoa tem `platform_role`, ou (fora do modo suporte) tem vínculo `manager`/`tenant_admin` em qualquer prefeitura ou `field_agent` em outra prefeitura.
  - `invite_record(p_user_id uuid, p_tenant_id uuid, p_kind invite_kind, p_min_interval_seconds int) RETURNS int` — devolve `0` e insere a entrega (com `sent_by = app_current_user()`), ou devolve os segundos que faltam sem inserir. `p_min_interval_seconds = 0` para o envio automático. Permissão: equipe interna, ou gestor/admin com vínculo ativo em `p_tenant_id`.
  - `invite_pending_agents(p_tenant_id uuid) RETURNS TABLE (user_id uuid, name text, email text, phone text, team_name text)` — só para `app_is_platform_admin()`; agentes com vínculo `invited`/`active`, conta ativa, e-mail não nulo e nenhuma entrega `agent` no par.
  - RLS de `invite_deliveries`: sem acesso direto de `app_user` (só pelas funções).

- [ ] **Step 1: Testes** (nomes em português), entre outros:
  - "cria agente novo já com e-mail"; "pessoa achada pelo celular sem e-mail recebe o e-mail"; "pessoa achada com outro e-mail devolve o e-mail existente sem trocar".
  - "troca de e-mail do agente recusa gestor de outra prefeitura"; "recusa agente de outra prefeitura"; "aceita agente só desta prefeitura"; "equipe interna em modo suporte troca".
  - "invite_record devolve os segundos que faltam dentro do intervalo"; "aceita com intervalo zero"; "recusa quem não é da prefeitura".
  - "pendentes: inclui convidado com e-mail sem entrega; exclui desativado, sem e-mail e já entregue".
  - "app_user não lê invite_deliveries diretamente".
- [ ] **Step 2:** `pnpm db:up && pnpm --filter @alocidadao/db test -- invites` → FAIL.
- [ ] **Step 3:** schema + `pnpm --filter @alocidadao/db exec drizzle-kit generate` + `--custom` para as funções.
- [ ] **Step 4:** `pnpm db:migrate && pnpm --filter @alocidadao/db test` → PASS (suíte inteira do pacote).
- [ ] **Step 5: Commit** "Banco: e-mail do agente e registro dos convites".

### Task 4: API — envio dos convites, reenvio e e-mail do agente

**Files:**
- Create: `apps/api/src/invites/send.ts`, `apps/api/src/invites/routes.ts` (+ `.test.ts` de cada)
- Modify: `apps/api/src/app.ts` (passar `email` e `invites` a painel e backoffice), `apps/api/src/panel/routes.ts`, `apps/api/src/panel/teams.ts` (`addAgent`, `updateAgent`), `apps/api/src/panel/admin.ts` (`createManager`), `apps/api/src/backoffice/create-tenant.ts`, `apps/api/src/backoffice/staff-routes.ts`, `apps/api/src/backoffice/tenants.ts` (ativação), `apps/api/src/panel/audit.ts` (`PANEL_AUDIT_ACTIONS`)
- Modify: `packages/shared/src/panel-admin.ts` (schemas do agente), `packages/shared/src/backoffice.ts` (`invite.resend`, `agent.email_change` + rótulos "Reenviou um convite", "Trocou o e-mail de um agente"; teste de tamanho → 40)
- Modify: `packages/api-client/src/index.ts` (+ teste): `panelResendManagerInvite(tenantId, userId)`, `panelResendAgentInvite(tenantId, userId)`, `backofficeResendStaffInvite(userId)`, `backofficeResendTenantManagerInvite(tenantId, userId)`, todos `→ Promise<{ maskedEmail: string }>`

**Interfaces:**
- Consumes: Task 2 (`*InviteEmail`, `InviteLinks`, `INVITE_RESEND_SECONDS`), Task 3 (funções SQL).
- Produces:
  ```ts
  type InviteDeps = { db: Database; email: EmailSender; links: InviteLinks; log: FastifyBaseLogger };
  // Grava a entrega (intervalo 0) e envia; nunca lança. Chamar depois do commit do cadastro.
  function sendInvite(deps: InviteDeps, ctx: DbContext, target: InviteTarget): Promise<void>;
  type InviteTarget =
    | { kind: 'panel'; userId: string; tenantId: string; to: string; name: string; tenantName: string; role: 'tenant_admin' | 'manager' }
    | { kind: 'agent'; userId: string; tenantId: string; to: string; name: string; tenantName: string; teamName: string; phone: string }
    | { kind: 'staff'; userId: string; to: string; name: string; platformRole: PlatformRole };
  // Reenvio: confere conta/vínculo, aplica INVITE_RESEND_SECONDS, envia e devolve o e-mail mascarado.
  function resendInvite(deps: InviteDeps, ctx: DbContext, target: InviteTarget): Promise<{ maskedEmail: string } | { retryAfterSeconds: number }>;
  ```

- [ ] **Step 1: Testes da API** (`buildApp` com `EmailSender` falso que guarda as mensagens):
  - P2 cria prefeitura → 1 e-mail `panel` para o admin com `fromName` da prefeitura.
  - `POST /panel/managers` → 1 e-mail `panel` com perfil "Gestor".
  - `POST /panel/teams/:id/agents` sem `email` → 400; com e-mail em prefeitura `onboarding` → 201 e **nenhum** e-mail; em prefeitura `active` → 1 e-mail `agent` com o nome da equipe.
  - Agente achado pelo celular com outro e-mail → `409 email_mismatch` com `maskedEmail` (Review Focus 1); com o mesmo e-mail → 201 e e-mail para ele.
  - `POST /backoffice/staff` → 1 e-mail `staff`.
  - Ativar prefeitura com 2 agentes pendentes, 1 desativado e 1 sem e-mail → 2 e-mails `agent`; ativar de novo não se aplica (já ativa); reativar suspensa não envia (Review Focus 2).
  - `EmailSender` que lança → cadastro responde 201 e o erro vai para o log.
  - Reenvio: 200 com `maskedEmail`; segundo reenvio em menos de 60 s → `429 rate_limited` com `retryAfterSeconds`; conta sem e-mail → `409 email_missing`; vínculo inativo → `409 invite_not_allowed`; agente em prefeitura `onboarding` → `409 tenant_not_active`.
  - Reenvio pela equipe (P3, P6 e painel em modo suporte) grava `invite.resend` na auditoria.
  - `PATCH /panel/agents/:userId` `change_email` → 200 e grava; pessoa com acesso ao painel → `409 email_change_not_allowed`; e-mail de outra conta → `409 email_in_use`; não envia convite sozinho.
  - Teste que já existe em `audit.test.ts` (toda rota não-GET do `/panel` está no mapa) continua passando com as rotas novas.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api exec vitest run src/invites src/panel src/backoffice` → FAIL.
- [ ] **Step 3: Implementar.** As rotas de cadastro juntam o `InviteTarget` dentro da transação e chamam `sendInvite` depois dela. `addAgent` compara o e-mail devolvido pela função SQL com o do corpo (minúsculas) e recusa `email_mismatch`. Ativação: dentro da transação de `tenant.activate`, lê `invite_pending_agents`; depois do commit, `sendInvite` para cada um.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test`, `pnpm --filter @alocidadao/shared test`, `pnpm --filter @alocidadao/api-client test` → PASS; typecheck.
- [ ] **Step 5: Commit** "Convites por e-mail no cadastro, na ativação e no reenvio".

### Task 5: API — aceite dos termos e bloqueio

**Files:**
- Modify: `apps/api/src/auth/plugin.ts` (`registerAuth`, `requireAuth`), `apps/api/src/app.ts` (`AuthOptions.termsGate?: boolean`, padrão `false`), `apps/api/src/server.ts` (`termsGate: true`), `apps/api/src/me/routes.ts` (`termsAccepted`, `POST /me/terms`), `apps/api/src/auth/app-routes.ts` (logout liberado)
- Modify: `packages/shared/src/auth.ts` (`meResponseSchema.termsAccepted: z.boolean()`, `acceptTermsBodySchema`), `packages/api-client/src/index.ts` (`acceptTerms()`)
- Test: `apps/api/src/auth/terms-gate.test.ts`, `apps/api/src/me/routes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function registerAuth(app: FastifyInstance, secret: string | undefined, options?: { termsGateDb?: Database }): void;
  function requireAuth(audiences: readonly SessionAudience[], options?: { allowWithoutTerms?: boolean }): preHandler;
  // 403 { code: 'terms_required' } quando o portão está ligado e users.terms_version é nulo
  const acceptTermsBodySchema = z.object({ acceptedTermsVersion: z.literal(TERMS_VERSION) });
  // MeResponse.termsAccepted: boolean
  // api-client: acceptTerms(): Promise<void>
  ```
  Liberadas (`allowWithoutTerms: true`): `GET /me`, `POST /me/terms`, `POST /auth/logout`, `PUT /me/devices/:installationId`. O cadastro do cidadão (`/auth/signup`) não usa `requireAuth` e já grava o aceite.

- [ ] **Step 1: Testes:**
  - Com `termsGate: true`: usuário sem `terms_version` → `GET /panel/context` 403 `terms_required`; `GET /me` 200 com `termsAccepted: false`; `POST /auth/logout` 204; `POST /me/terms` com a versão atual → 204, e depois `GET /panel/context` 200 e `termsAccepted: true`.
  - `POST /me/terms` com versão antiga → 400.
  - Usuário com `terms_version = '2026-10-23'` (antiga) → não é bloqueado (decisão do usuário).
  - Com `termsGate` ausente → nada bloqueia (os testes existentes não mudam).
- [ ] **Step 2:** `pnpm --filter @alocidadao/api exec vitest run src/auth/terms-gate.test.ts src/me` → FAIL.
- [ ] **Step 3: Implementar.** `requireAuth` lê o `Database` do portão por um decorator da aplicação; a conferência é um `SELECT terms_version IS NOT NULL` com `withContext(db, { userId })`.
- [ ] **Step 4:** suíte da API e do `shared` → PASS; typecheck de todo o monorepo (`pnpm typecheck`, porque `MeResponse` mudou).
- [ ] **Step 5: Commit** "Aceite dos termos com bloqueio na API".

### Task 6: Painel e backoffice — e-mail do agente e "Reenviar convite"

**Files:**
- Modify: `apps/web/src/teams/AgentDialog.tsx` (campo E-mail no `AddAgentDialog`; novo `ChangeEmailDialog`), `apps/web/src/teams/AgentsTable.tsx` (coluna E-mail; itens "Trocar e-mail" e "Reenviar convite"), `apps/web/src/teams/TeamsPage.tsx`
- Modify: `apps/web/src/managers/ManagersPage.tsx`, `apps/web/src/backoffice/staff/StaffPage.tsx`, `apps/web/src/backoffice/tenants/tabs/ManagersTab.tsx`
- Create: `apps/web/src/ui/invite-errors.ts` (mensagens das Decisões por `code`)
- Test: os `.test.tsx` vizinhos de cada arquivo

**Interfaces:**
- Consumes: Task 4 (métodos do `api-client`, schemas do agente).

- [ ] **Step 1: Testes:**
  - Adicionar agente sem e-mail mantém "Adicionar" desabilitado; com e-mail envia `{ name, phone, email }`; `email_mismatch` mostra a mensagem com o e-mail mascarado.
  - Menu do agente: "Reenviar convite" só com e-mail e status diferente de `inactive`; "Trocar e-mail" sempre que não `inactive`; ao reenviar mostra "Convite reenviado para m•••@goiania.go.gov.br."; `429` mostra a espera; `tenant_not_active` mostra a mensagem das Decisões.
  - Gestores: "Reenviar convite" no menu de gestor ativo; não aparece em desativado.
  - P6: "Reenviar convite" em toda linha, menos na própria.
  - P3 Gestores: menu ⋯ com "Reenviar convite" em cada linha (inclusive admin da prefeitura).
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test -- teams managers backoffice` → FAIL.
- [ ] **Step 3: Implementar** com `RowMenu`, o diálogo e o aviso (toast) que as telas já usam.
- [ ] **Step 4:** testes e typecheck do web → PASS.
- [ ] **Step 5: Commit** "Painel: e-mail do agente e reenvio de convite".

### Task 7: Painel — aceite dos termos e leitura do texto

**Files:**
- Create: `apps/web/src/legal/LegalDocumentView.tsx` (renderiza `LegalDocument`), `apps/web/src/legal/LegalDialog.tsx` (texto + "Li e concordo" opcional), `apps/web/src/legal/TermsCheckbox.tsx`, `apps/web/src/legal/TermsGate.tsx` (+ testes)
- Modify: `apps/web/src/App.tsx` (`<TermsGate>` dentro dos dois `RequireSession`), menu da conta do painel e do backoffice (links)

**Interfaces:**
- Consumes: Task 1 (`LEGAL_DOCUMENTS`), Task 5 (`termsAccepted`, `acceptTerms`).
- Produces: `TermsCheckbox({ checked, onChange }: { checked: boolean; onChange(next: boolean): void })` — o rótulo com os dois links; cada link abre `LegalDialog` com "Li e concordo", que chama `onChange(true)` e fecha.

- [ ] **Step 1: Testes:**
  - `TermsGate` com `me.termsAccepted === false` mostra "Antes de continuar" e não renderiza o `Outlet`; caixa começa desmarcada; "Continuar" desabilitado até marcar; "Li e concordo" no diálogo dos Termos marca a caixa; "Continuar" chama `acceptTerms` e mostra o painel; "Sair" chama o logout.
  - Resposta `403 terms_required` de qualquer chamada leva à tela de aceite (invalidar `me`).
  - Links do menu da conta abrem o diálogo sem "Li e concordo".
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test -- legal App` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** testes e typecheck → PASS. Conferir à mão no navegador (`pnpm dev`, login com um gestor do seed: os usuários do seed não têm aceite e devem ver a tela).
- [ ] **Step 5: Commit** "Painel: aceite dos termos".

### Task 8: App — leitura do texto, cadastro e aceite no primeiro acesso

**Files:**
- Create: `apps/mobile/src/app/termos.tsx`, `apps/mobile/src/app/privacidade.tsx`, `apps/mobile/src/app/(app)/aceite.tsx`, `apps/mobile/src/legal/acceptance-store.ts`, `apps/mobile/src/legal/LegalDocumentView.tsx`, `apps/mobile/src/legal/TermsCheckbox.tsx`, `apps/mobile/src/legal/terms-route.ts` (+ testes Node)
- Modify: `apps/mobile/src/app/(auth)/quase-la.tsx` (usar `TermsCheckbox`), `apps/mobile/src/app/(app)/_layout.tsx` (redirecionar para `aceite` quando `me.termsAccepted === false`), `apps/mobile/src/components/ProfileContent.tsx` (linhas abrem `/termos` e `/privacidade` no app em vez do navegador), `apps/mobile/src/auth/session-context.tsx` (403 `terms_required` atualiza `me`)

**Interfaces:**
- Consumes: Task 1, Task 5.
- Produces:
  ```ts
  // acceptance-store.ts
  function markLegalRead(): void;                    // chamada pelo "Li e concordo"
  function useLegalReadSignal(onRead: () => void): void; // a tela da caixa marca ao voltar
  // terms-route.ts (Node, testável)
  function needsTermsAcceptance(me: MeResponse | null): boolean; // me?.termsAccepted === false
  ```

- [ ] **Step 1: Testes** (Node, como `app-mode.test.ts`): `needsTermsAcceptance` com `null` → `false` (sem rede não bloqueia), com `termsAccepted: false` → `true`; `markLegalRead` chama o ouvinte registrado uma vez e nenhum depois de desmontado.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test -- legal` → FAIL.
- [ ] **Step 3: Implementar.** `aceite.tsx` tem os textos das Decisões, chama `acceptTerms`, atualiza `me` e volta para `homeFor(mode)`; "Sair" faz logout. As telas `termos`/`privacidade` com `?aceite=1` mostram "Li e concordo" no fim; sem o parâmetro, não.
- [ ] **Step 4:** testes e typecheck do mobile → PASS. Conferir no simulador: agente do seed entra, vê "Antes de continuar", lê os Termos, "Li e concordo" marca a caixa, "Continuar" leva às atividades; cadastro de cidadão novo com a caixa nova.
- [ ] **Step 5: Commit** "App: aceite dos termos e leitura no app".

### Task 9: Site estático com /termos e /privacidade

**Files:**
- Create: `apps/site/package.json` (`@alocidadao/site`; scripts `build: tsx src/build.ts`, `test: vitest run`, `typecheck: tsc --noEmit`, `preview: vite preview --outDir dist`, com `vite` em devDependencies na mesma versão do `apps/web`), `apps/site/tsconfig.json`, `apps/site/src/render.ts`, `apps/site/src/build.ts`, `apps/site/src/styles.css`, `apps/site/src/render.test.ts`
- Modify: `pnpm-workspace.yaml` se precisar; `turbo.json` se o pacote precisar de saída (`dist/**`)

**Interfaces:**
- Consumes: Task 1 (`LEGAL_DOCUMENTS`).
- Produces: `renderLegalPage(doc: LegalDocument): string`, `renderHome(): string`; `build.ts` grava `dist/index.html`, `dist/termos/index.html`, `dist/privacidade/index.html`, `dist/styles.css`.

- [ ] **Step 1: Testes:** `renderLegalPage(TERMS_OF_USE)` contém `<title>Termos de Uso · Alô Cidadão</title>`, o `notice`, cada `heading` em `<h2>`, `lang="pt-BR"`, e escapa `<`/`&` do texto; `renderHome()` tem links para `/termos`, `/privacidade` e `https://portal.alocidadao.com.br`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/site test` → FAIL.
- [ ] **Step 3: Implementar.** HTML semântico, cores e fontes da marca (Lexend nos títulos e Source Sans 3 no texto, como o painel; pelas Google Fonts), legível no celular (largura máxima ~720px, margem 16px).
- [ ] **Step 4:** `pnpm --filter @alocidadao/site build` gera os 4 arquivos; testes → PASS; `pnpm lint`/`format:check`.
- [ ] **Step 5: Commit** "Site estático com Termos e Privacidade".

### Task 10: Verificação final

- [ ] **Step 1:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` → tudo verde (anotar o total de testes).
- [ ] **Step 2:** Rodar ponta a ponta local (`pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed:dev`, `pnpm dev`): criar um gestor no painel e conferir o e-mail no log da API (HTML e texto); cadastrar agente com prefeitura ativa e ver o convite; reenviar e ver o limite; entrar como gestor novo e passar pela tela de aceite.
- [ ] **Step 3:** Atualizar `docs/planejamento-mvp.md` (pendências: SMS de convite e publicação do site no Plano 8; troca do texto jurídico antes da produção) e commitar.
