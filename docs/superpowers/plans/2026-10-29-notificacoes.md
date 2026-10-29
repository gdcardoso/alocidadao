# Notificações (Plano 7) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cidadão e o agente recebem push nos momentos do spec, o gestor ganha um sino no painel, o cidadão recebe e-mail na conclusão e a solicitação se confirma sozinha em 7 dias; o envio é simulado enquanto Firebase e Apple não estão configurados.

**Architecture:**

- **Os avisos nascem no banco.** Toda mudança de situação já grava `status_events` na mesma transação (API em TypeScript, `withContext`). Um gatilho `AFTER INSERT` em `status_events` (`SECURITY DEFINER`) aplica as regras do spec e grava, na mesma transação, as linhas de `notification_outbox` (push e e-mail) e de `panel_notifications` (sino). Assim nenhum caminho, inclusive os de desenvolvimento, muda a situação sem aviso.
- **O envio é na API, fora da transação.** Um laço periódico pega lotes da fila por função `SECURITY DEFINER` com `FOR UPDATE SKIP LOCKED`, manda pelos `PushSender` (FCM, APNs ou o de log) e pelo `EmailSender`, e grava o resultado com nova tentativa. O mesmo agendador roda a confirmação automática e a limpeza.
- **Painel:** rotas `/panel/notifications`, sino no shell do painel com consulta a cada minuto. **App:** tocar no push abre a solicitação ou a atividade.

**Tech Stack:** o mesmo dos planos anteriores. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-29-notificacoes-design.md` (aprovado em 29/10/2026). Ver também `docs/planejamento-mvp.md` ("Notificações"), `docs/decisoes/0002-recursos-nativos-offline-e-push.md` e `docs/decisoes/0001-isolamento-por-prefeitura.md`.

## Decisões deste plano (além do spec)

- **Tipos de aviso** (`NOTIFICATION_KINDS` no `shared`):

  | Tipo                            | Para              | Canal        | Texto (`{p}` = protocolo)                                                       |
  | ------------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------- |
  | `request_in_progress`           | cidadão           | push         | `Solicitação {p}: em atendimento`                                               |
  | `request_rejected`              | cidadão           | push         | `Solicitação {p}: recusada. Veja o motivo no app`                               |
  | `request_awaiting_confirmation` | cidadão           | push, e-mail | `Solicitação {p}: concluída. Confira as fotos`                                  |
  | `request_reopened`              | cidadão           | push         | `Solicitação {p}: voltou para análise`                                          |
  | `work_order_assigned`           | agentes da equipe | push         | `Nova atividade: {p}`                                                           |
  | `work_order_rework`             | agentes da equipe | push         | `Ajuste pedido: {p}`                                                            |
  | `work_order_completed`          | gestores e admins | sino         | `Solicitação {p}: concluída com fotos` / `Solicitação {p}: concluída sem fotos` |
  | `work_order_impeded`            | gestores e admins | sino         | `Solicitação {p}: impedimento registrado`                                       |
  | `request_contested`             | gestores e admins | sino         | `Solicitação {p}: contestada pelo cidadão`                                      |
  | `occurrence_new`                | gestores e admins | sino         | `Solicitação {p}: nova, aguardando análise`                                     |
  | `request_cancelled`             | gestores e admins | sino         | `Solicitação {p}: cancelada pelo cidadão`                                       |

  Título do push: `Alô Cidadão`. Os textos acima vão ao usuário junto com este plano; aprovar o plano aprova os textos.

- **E-mail da conclusão:** assunto `Solicitação {p}: concluída`; corpo `A prefeitura concluiu o atendimento da sua solicitação {p}. Abra o app Alô Cidadão, confira as fotos e diga se o problema foi resolvido. Sem resposta em 7 dias, a solicitação é confirmada automaticamente.` Só texto, como o e-mail do código.
- **Regras do gatilho** (o evento é uma linha nova de `status_events`; "ator" é `actor_user_id`; ninguém é avisado do que fez):
  - **Evento de solicitação** (`request_id` não nulo, `work_order_id` nulo):
    - Cidadão (dono, `requests.citizen_id`): se `from_status` não é nulo, o ator não é o cidadão e `to_status` não é `completed`, o tipo sai de `to_status`: `in_progress` → `request_in_progress`; `rejected` → `request_rejected`; `awaiting_confirmation` → `request_awaiting_confirmation` (push e e-mail); `open` → `request_reopened`.
    - Sino: `from_status` nulo e `to_status = 'open'` e a ocorrência tem só esta solicitação → `occurrence_new`; `awaiting_confirmation` → `open` com o ator igual ao dono → `request_contested`; `to_status = 'cancelled'` com o ator igual ao dono → `request_cancelled`.
  - **Evento de atividade** (`work_order_id` não nulo):
    - Agentes: `from_status` nulo e `to_status = 'assigned'` (atribuição ou repasse) → `work_order_assigned`; `to_status = 'rework_requested'` → `work_order_rework`. Reagendar (`impeded` → `assigned`) não avisa.
    - Sino: `to_status = 'awaiting_review'` → `work_order_completed`, com `details.withPhotos` verdadeiro se a atividade tem foto `completion` criada na mesma transação (`photos.created_at = now()`; as fotos são gravadas antes do evento, `apps/api/src/agent/actions.ts:159-173`); `to_status = 'impeded'` → `work_order_impeded`.
  - **Evento só da ocorrência** (os dois nulos): nada.
  - **Destinatários:** conta `active` e não excluída. Agentes: `team_members` da equipe da atividade com vínculo `field_agent` ativo na prefeitura. Sino: vínculo `manager` ativo com `department_managers` do setor da categoria da ocorrência, mais vínculo `tenant_admin` ativo; uma linha por pessoa.
  - **Protocolo:** o da solicitação, nos eventos de solicitação; o da solicitação mais antiga da ocorrência, nos eventos de atividade (como a lista do agente, `apps/api/src/agent/work-orders.ts:63-69`).
- **Fila:** `notification_outbox` com `channel` (`push`, `email`), `status` (`pending`, `sent`, `failed`, `skipped`), até 5 tentativas com espera de 1, 5, 30 e 120 minutos. `retry` do sender reagenda; `invalid_token` limpa o token e conta como feito para aquele aparelho; sem aparelho com token (ou sem e-mail) → `skipped`. O push vai para todos os tokens distintos da pessoa.
- **Dados escondidos do push** (todos texto): `kind`, `tenantId` e `requestId` (cidadão) ou `workOrderId` (agente). Nenhum outro dado.
- **Agendador na API:** a cada 5 s processa a fila (lote de 50); a cada 10 min roda `auto_confirm_requests()` e a limpeza (`panel_notifications` com mais de 90 dias; fila `sent`/`failed`/`skipped` com mais de 30 dias). Desligado nos testes; parado no `onClose`.
- **Sem FCM/APNs configurados:** sender de log (`Push (log, sem provedor)`, com plataforma, tipo e protocolo, sem o token inteiro), como o e-mail.
- **Painel:** `GET /panel/notifications` (30 mais recentes e `unreadCount`), `POST /panel/notifications/:id/read`, `POST /panel/notifications/read-all`. Em modo suporte (`platformRole`), lista vazia e as marcações respondem 204 sem efeito.
- **Para onde o sino leva:** `work_order_completed` → `/revisao?atividade={workOrderId}`; `work_order_impeded` → `/impedimentos?atividade={workOrderId}`; `occurrence_new` → `/triagem?ocorrencia={occurrenceId}`; `request_contested` e `request_cancelled` → `/solicitacoes?ocorrencia={occurrenceId}` (conferir na Task 7 que a lista abre a gaveta por esse parâmetro; se não abrir, usar a rota que já abre a `OccurrenceDrawer`).
- **Logout do app:** apaga o `push_token` do aparelho da sessão (`sessions.installation_id`). Registrar um token tira o mesmo token de qualquer outro registro (`device_claim_push_token`).

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. Nenhuma dependência nova.
- **Nomes e textos:** valores e código em inglês; textos em português, mapeados no `shared`, copiados das Decisões sem mudar uma vírgula. Comentários em português. Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
- **Conteúdo do push:** só `Alô Cidadão`, o protocolo e o texto do tipo; nunca nome, endereço, descrição, categoria ou equipe.
- **Isolamento (decisão 0001):** a API conecta como `app_user`; leitura de outra pessoa (aparelhos, fila) ou entre prefeituras só por funções `SECURITY DEFINER` com `SET search_path = public, pg_temp`, `REVOKE ... FROM PUBLIC` e grant só ao que precisa.
- **Migrações:** não editar 0000–0030. Estruturais com `pnpm --filter @alocidadao/db exec drizzle-kit generate`; funções, gatilhos, políticas e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Toda rota declara schema de resposta.
- **Falha de envio nunca desfaz nem trava a ação** que gerou o aviso.
- **Visual (web):** tokens e componentes de `apps/web/src/ui/*`; ícones `lucide-react`; botão só com ícone tem `aria-label`. Sem Pencil do sino: seguir o padrão do painel e listar os textos novos no relatório (validação no Pencil em 31/10 ou no sistema rodando).
- **Testes:** web com `@testing-library/react` e cliente simulado (`vi.mock`); API com `buildApp` e senders falsos; banco com `owner`/`app` como em `packages/db/src/rls.test.ts`.
- **Commits:** mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa.
- **Branch:** `notificacoes`, no próprio checkout, a partir do `main`.

## Review Focus

1. **Aviso em dobro:** duas instâncias processando a fila, nova tentativa depois de um envio que deu certo, ou o mesmo token em dois registros. Esperado: cada aparelho recebe uma vez. Testes: `duas pegadas simultâneas não pegam a mesma linha` (Task 3); `sends once per distinct token` (Task 5).
2. **Quem agiu não é avisado,** inclusive o admin que também é gestor e o gestor que atribui. Testes: `quem agiu não recebe o aviso do sino` e `gestor que é admin recebe uma linha só` (Task 2).
3. **Destinatário que saiu:** agente tirado da equipe, gestor inativo, conta congelada ou excluída entre o evento e o envio. Esperado: não recebe. Testes: `vínculo inativo não recebe` (Task 2); `pegada pula conta congelada ou excluída` (Task 3).
4. **Envio falhando:** sender lança exceção ou FCM fora do ar. Esperado: a ação do usuário já foi gravada, a linha é reagendada e o laço continua. Teste: `a throwing sender reschedules and the loop keeps going` (Task 5).
5. **Confirmação automática rodando duas vezes** ou com outra solicitação da ocorrência ainda aguardando. Esperado: confirma uma vez, sem push, e só fecha a ocorrência quando nenhuma solicitação aguarda. Testes: `confirmação automática roda duas vezes sem duplicar` e `ocorrência só fecha sem outra aguardando` (Task 3).

---

### Task 1: Tipos, textos e tabelas

**Files:**

- Create: `packages/shared/src/notifications.ts` (e export em `index.ts`), `packages/shared/src/notifications.test.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0031_*.sql` (gerada) e `0032_notifications_access.sql` (`--custom`)

**Interfaces:**

- Produces (`shared`):
  - `NOTIFICATION_KINDS` (os 11 da tabela das Decisões), `type NotificationKind`; `CITIZEN_PUSH_KINDS`, `AGENT_PUSH_KINDS`, `PANEL_NOTIFICATION_KINDS`.
  - `notificationText(kind: NotificationKind, protocol: string, details?: { withPhotos?: boolean }): string` — o texto da tabela.
  - `PUSH_TITLE = 'Alô Cidadão'`; `completionEmail(protocol: string): { subject: string; text: string }`.
  - `panelNotificationSchema` `{ id, kind, protocol, text, occurrenceId, workOrderId: uuid | null, createdAt, readAt: string | null }` e `panelNotificationsResponseSchema` `{ items, unreadCount }`.
- Produces (`db`):
  - `notification_outbox (id, tenant_id, user_id, channel text check in ('push','email'), kind text, protocol text, request_id uuid null, work_order_id uuid null, details jsonb null, status text check in ('pending','sent','failed','skipped') default 'pending', attempts int default 0, next_attempt_at timestamptz default now(), last_error text null, created_at, sent_at null)`; índice parcial `(next_attempt_at) where status = 'pending'`. Sem grant ao `app_user` (só funções).
  - `panel_notifications (id, tenant_id, user_id, kind text, protocol text, occurrence_id uuid, work_order_id uuid null, details jsonb null, read_at timestamptz null, created_at)`; índice `(user_id, tenant_id, created_at desc)`. RLS `FORCE`: `tenant_id = app_current_tenant() and user_id = app_current_user()`; grant `SELECT` e `UPDATE (read_at)` ao `app_user`.

- [ ] **Step 1: Failing tests:** `notificationText` devolve cada texto da tabela (um caso por tipo, inclusive com e sem fotos); `completionEmail('2026-000123')` devolve o assunto e o corpo das Decisões; os três grupos de tipos não se sobrepõem e juntos dão `NOTIFICATION_KINDS`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → FAIL.
- [ ] **Step 3:** Implementar o `shared`, as tabelas no `schema.ts`, gerar a 0031 e escrever a 0032 (RLS, grants). Teste de banco em `packages/db/src/notifications.test.ts`: `cada pessoa só vê os próprios avisos do sino da prefeitura atual` e `app_user não lê a fila`.
- [ ] **Step 4:** testes do `shared` e do `db`, `pnpm typecheck` → PASS. `pnpm db:migrate` no banco local.
- [ ] **Step 5:** Commit: `Notificações: tipos, textos e tabelas`.

---

### Task 2: Gatilho que gera os avisos

**Files:**

- Create: `packages/db/migrations/0033_notify_from_status_event.sql` (`--custom`)
- Modify: `packages/db/src/notifications.test.ts`

**Interfaces:**

- Consumes: as tabelas da Task 1.
- Produces: `notify_from_status_event()` (`SECURITY DEFINER`, `RETURNS trigger`) e o gatilho `status_events_notify AFTER INSERT ON status_events FOR EACH ROW`. Aplica as "Regras do gatilho" das Decisões e grava em `notification_outbox` (`channel` `push`; e `email` também em `request_awaiting_confirmation`) e em `panel_notifications`. `details` só `{ "withPhotos": bool }`.

- [ ] **Step 1: Failing tests** (inserindo eventos como as ações fazem, com dados montados pelo `owner`):
  - `atribuir avisa o cidadão e os agentes da equipe`;
  - `recusar depois de impedimento avisa o cidadão`;
  - `junção com ocorrência em atendimento avisa o cidadão`;
  - `publicar avisa o cidadão por push e e-mail`;
  - `contestação avisa os outros moradores e o sino, e não quem contestou`;
  - `cancelar e confirmar não avisam o cidadão; cancelar vai ao sino`;
  - `confirmação automática não avisa ninguém`;
  - `ocorrência nova vai ao sino; apoio a ocorrência na fila não vai`;
  - `concluir com e sem fotos muda o texto do sino`;
  - `impedimento vai ao sino; reagendar não avisa`;
  - `pedir ajuste avisa os agentes`;
  - `quem agiu não recebe o aviso do sino`;
  - `gestor que é admin recebe uma linha só`;
  - `gestor de outro setor não recebe`;
  - `vínculo inativo não recebe` (agente e gestor);
  - `protocolo da atividade é o da solicitação mais antiga`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3:** Implementar a 0033.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test`, `pnpm --filter @alocidadao/api test` (as ações continuam passando com o gatilho) → PASS.
- [ ] **Step 5:** Commit: `Notificações: gatilho dos avisos`.

---

### Task 3: Funções da fila, dos aparelhos e da confirmação automática

**Files:**

- Create: `packages/db/migrations/0034_notification_functions.sql` (`--custom`)
- Create: `packages/db/src/notifications.ts` (wrappers TypeScript, export no `index.ts`)
- Modify: `packages/db/src/notifications.test.ts`

**Interfaces:**

- Produces (SQL, `SECURITY DEFINER`, grant ao `app_user`):
  - `notification_claim_batch(p_limit int) RETURNS TABLE (id uuid, channel text, kind text, protocol text, tenant_id uuid, request_id uuid, work_order_id uuid, details jsonb, attempts int, push_tokens jsonb, email text)`: linhas `pending` com `next_attempt_at <= now()`, `FOR UPDATE SKIP LOCKED`; marca `attempts = attempts + 1` e `next_attempt_at = now() + 10 min` (trava de quem pegou). `push_tokens` = lista de `{platform, token}` distintos dos aparelhos da pessoa; conta congelada ou excluída → a linha vai a `skipped` e não volta.
  - `notification_finish(p_id uuid, p_status text, p_retry_in_seconds int, p_error text) RETURNS void`: `sent`/`skipped`/`failed`, ou volta a `pending` com `next_attempt_at = now() + p_retry_in_seconds`.
  - `device_clear_push_token(p_token text) RETURNS void`; `device_claim_push_token(p_token text) RETURNS void` (tira o token de registros de outras contas e de outros aparelhos da mesma conta; usa `app_current_user()`).
  - `auto_confirm_requests() RETURNS int`: solicitações `awaiting_confirmation` com `status_changed_at <= now() - interval '7 days'` (o 7 vem de `AUTO_CONFIRM_AFTER_DAYS`, citado no comentário) vão a `completed` com evento sem ator; a ocorrência vai a `completed` com evento próprio só se nenhuma outra solicitação dela aguarda (como `apps/api/src/citizen/requests.ts` na confirmação do cidadão). `FOR UPDATE SKIP LOCKED`. Devolve quantas confirmou.
  - `notification_cleanup() RETURNS void`: os prazos das Decisões.
- Produces (TS, `packages/db/src/notifications.ts`): `claimNotifications(db, limit)`, `finishNotification(db, id, result)`, `clearPushToken(db, token)`, `claimPushToken(tx, token)`, `autoConfirmRequests(db)`, `cleanupNotifications(db)`.

- [ ] **Step 1: Failing tests:**
  - `duas pegadas simultâneas não pegam a mesma linha` (duas conexões, `Promise.all`);
  - `pegada traz os tokens distintos da pessoa e o e-mail`;
  - `pegada pula conta congelada ou excluída`;
  - `nova tentativa volta à fila no tempo pedido`;
  - `token reivindicado sai de outra conta`;
  - `confirmação automática confirma depois de 7 dias e não antes`;
  - `confirmação automática roda duas vezes sem duplicar`;
  - `ocorrência só fecha sem outra aguardando`;
  - `confirmação automática não gera push`;
  - `limpeza apaga avisos do sino com mais de 90 dias`.
- [ ] **Step 2:** testes do `db` → FAIL.
- [ ] **Step 3:** Implementar a 0034 e os wrappers.
- [ ] **Step 4:** testes do `db` e typecheck → PASS.
- [ ] **Step 5:** Commit: `Notificações: fila, aparelhos e confirmação automática`.

---

### Task 4: Correções do push e sender de log

**Files:**

- Modify: `apps/api/src/push/fcm.ts`, `apns.ts`, `http2.ts`, `message.ts` e os testes; `apps/api/src/env.ts` (e teste); `apps/api/src/server.ts`; `apps/mobile/app.config.ts`
- Create: `apps/api/src/push/log.ts`

**Interfaces:**

- Produces:
  - `createLogPushSender(log: { info: (obj: object, msg: string) => void }): PushSender` — sempre `sent`; registra `Push (log, sem provedor)` com plataforma, `data.kind`, protocolo e só os 8 últimos caracteres do token.
  - `notificationPushMessage(kind: NotificationKind, protocol: string, data: { tenantId: string; requestId?: string; workOrderId?: string }, details?: { withPhotos?: boolean }): PushMessage` em `message.ts` (substitui `statusPushMessage`; ajustar `dev/push.ts`).
  - `APNS_BUNDLE_ID` (padrão `br.com.alocidadao.app`) no `env.ts`.

- [ ] **Step 1: Failing tests:**
  - `fcm treats INVALID_ARGUMENT without token detail as retry, not invalid token`;
  - `fcm treats UNREGISTERED and invalid registration token as invalid token`;
  - `apns encodes the device token in the path`;
  - `apns treats DeviceTokenNotForTopic as invalid token`;
  - `apns uses the configured bundle id`;
  - `http2 reuses the session for two requests and reconnects after goaway`;
  - `missing p8 file disables apns with a warning instead of crashing` (função de montagem dos senders extraída do `server.ts`, por exemplo `buildPushSenders(env, log)` em `push/senders.ts`);
  - `log sender logs kind and protocol, never the whole token`;
  - `notification message carries only kind, tenant and id`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar; `app.config.ts` com `__dirname` no lugar de `process.cwd()`.
- [ ] **Step 4:** testes e typecheck da API e do mobile → PASS.
- [ ] **Step 5:** Commit: `Push: correções e envio pelo log`.

---

### Task 5: Envio da fila, agendador, aparelhos e logout

**Files:**

- Create: `apps/api/src/notifications/dispatcher.ts`, `scheduler.ts` e testes
- Modify: `apps/api/src/app.ts` (opção `notifications`), `server.ts`, `me/routes.ts` (registro do aparelho), `auth/app-routes.ts` (logout), `messaging/email.ts` (usa `completionEmail`)

**Interfaces:**

- Consumes: Task 3 (wrappers), Task 4 (`buildPushSenders`, `notificationPushMessage`), `completionEmail` e `EmailSender`.
- Produces:
  - `dispatchNotifications(deps: { db; push: { android: PushSender; ios: PushSender }; email: EmailSender; log }, limit = 50): Promise<number>` — pega um lote, envia, chama `finishNotification`; espera da nova tentativa pelas Decisões (60, 300, 1800, 7200 s); na 5ª falha, `failed`.
  - `startScheduler(deps, { dispatchEveryMs = 5000, maintenanceEveryMs = 600000 }): { stop(): Promise<void> }` — não sobrepõe execuções; erro numa rodada vai ao log e não para o agendador.
  - `buildApp` ganha `notifications?: { scheduler: boolean }` (desligado por padrão; `server.ts` liga).

- [ ] **Step 1: Failing tests:**
  - `dispatches a citizen push to every device and marks sent`;
  - `sends once per distinct token`;
  - `invalid token clears it and still marks sent when another device received`;
  - `retry reschedules with the backoff and fails after the fifth attempt`;
  - `a throwing sender reschedules and the loop keeps going`;
  - `email row sends the completion email`;
  - `scheduler runs auto confirm and cleanup on its interval`;
  - `registering a push token removes it from another account`;
  - `logout clears the push token of the session device`;
  - `assigning an occurrence end to end queues pushes for the citizen and the agents` (rota real do painel + `dispatchNotifications` com senders falsos).
- [ ] **Step 2:** testes da API → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** testes e typecheck da API → PASS. `pnpm dev` local: atribuir uma ocorrência pelo painel e ver `Push (log, sem provedor)` no log da API.
- [ ] **Step 5:** Commit: `Notificações: envio, agendador e aparelhos`.

---

### Task 6: Rotas do sino e cliente da API

**Files:**

- Create: `apps/api/src/panel/notifications.ts` e teste
- Modify: `apps/api/src/panel/routes.ts`, `packages/api-client/src/index.ts` e teste

**Interfaces:**

- Consumes: `panelNotificationsResponseSchema`, `notificationText`, `requirePanelMember`.
- Produces: as três rotas das Decisões; `panelNotifications(tenantId)`, `panelReadNotification(tenantId, id)`, `panelReadAllNotifications(tenantId)` no cliente.

- [ ] **Step 1: Failing tests:** `lists the 30 latest with text and unread count`; `marks one and all as read`; `another manager cannot mark my notification` (404); `support mode gets an empty list and no-op reads`; `agent token gets 403`.
- [ ] **Step 2:** testes da API e do cliente → FAIL.
- [ ] **Step 3:** Implementar; o texto sai de `notificationText` (o banco guarda tipo e `details`).
- [ ] **Step 4:** testes e typecheck → PASS.
- [ ] **Step 5:** Commit: `Painel: rotas do sino`.

---

### Task 7: Sino no painel

**Files:**

- Create: `apps/web/src/shell/NotificationBell.tsx`, `NotificationBell.module.css`, `NotificationBell.test.tsx`
- Modify: `apps/web/src/shell/PanelLayout.tsx` ou `Sidebar.tsx` (onde couber no padrão do painel)

**Interfaces:**

- Consumes: os métodos da Task 6; `usePanel()`.

- [ ] **Step 1: Failing tests:** `shows the unread count and the list with relative time`; `clicking an item marks it read and navigates to its place` (um caso por destino das Decisões); `mark all as read clears the count`; `refetches every minute`; `hidden in support mode`; `empty list shows the empty text`.
- [ ] **Step 2:** testes do web → FAIL.
- [ ] **Step 3:** Implementar: consulta com `refetchInterval: 60_000`, como `panelCounts`; botão com `aria-label` `Avisos`; textos novos (vazio, "Marcar todos como lidos") no relatório.
- [ ] **Step 4:** testes e typecheck do web → PASS.
- [ ] **Step 5:** Commit: `Painel: sino de avisos`.

---

### Task 8: Tocar no push no app

**Files:**

- Create: `apps/mobile/src/lib/notification-route.ts` e teste
- Modify: `apps/mobile/src/app/_layout.tsx` (ou o ponto onde a sessão está pronta)

**Interfaces:**

- Produces: `routeForNotification(data: Record<string, unknown>): { href: string; tenantId?: string; agent: boolean } | null` — cidadão → `/solicitacao/{requestId}`; agente → `/agente/atividade/{workOrderId}` com o `tenantId` para escolher a prefeitura no modo agente; dado desconhecido → `null`.

- [ ] **Step 1: Failing tests:** `citizen kinds open the request`; `agent kinds open the work order with the tenant`; `unknown or missing ids return null`; no layout, `a tapped notification navigates after the session is ready` e `cold start uses the last notification response`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar com `addNotificationResponseReceivedListener` e `getLastNotificationResponseAsync`, usando a troca de modo e de prefeitura que o app já tem para o agente.
- [ ] **Step 4:** testes e typecheck do mobile → PASS.
- [ ] **Step 5:** Commit: `App: abrir a solicitação ou a atividade pelo push`.

---

### Task 9: Documentação, pendências e passada no navegador

**Files:**

- Modify: `docs/superpowers/plans/2026-10-22-spikes-pendencias.md` (marcar o que o Plano 7 fechou; textos novos para o usuário confirmar; o sino no desenho de 31/10; entrega real de push com Firebase e Apple continua no fim), `docs/decisoes/0002-recursos-nativos-offline-e-push.md` (a fila e o envio), este plano (seção "Resultado no navegador").

- [ ] **Step 1:** Subir API e web; com o seed, atribuir, concluir pelo agente (rota de desenvolvimento), publicar, contestar e cancelar; conferir o log `Push (log, sem provedor)`, o e-mail no log e o sino de um gestor e de um admin. Captura do sino aberto em `docs/superpowers/specs/telas-painel/` (ou a pasta de capturas do painel) para o usuário.
- [ ] **Step 2:** Registrar no plano o que foi visto e o que não deu.
- [ ] **Step 3:** `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck` → PASS.
- [ ] **Step 4:** Commit: `Notificações: documentação, pendências e passada no navegador`.

## Resultado no navegador

29/10/2026, Playwright (Chromium) em 1440x900, com o código fixo de desenvolvimento `123456`. API (`tsx watch`, porta 3333, código deste branch) e web (Vite, porta 5199) que já estavam no ar, com o log da API lido do arquivo de saída; `pnpm db:migrate` antes (0031–0034 já aplicadas). Sem `--reset` do seed: a passada usou os dados que já estavam no banco de desenvolvimento.

**Como as ações foram feitas.** Painel no navegador: atribuir (Carlos Demo, gestor de Obras) e publicar. App pela API, com um script local: login por celular do Agente Demo e dos três cidadãos do seed, cada um com um aparelho com token falso (`PUT /me/devices`), para o push não sair `skipped`; o agente iniciou, concluiu (com uma foto enviada ao MinIO) e registrou impedimento pelas rotas reais `/agent/*`; o cidadão contestou e cancelou por `/citizen/requests/:id/contest` e `/cancel`. **'Concluída sem fotos'** não sai pela API (concluir exige foto): foi simulada por SQL no banco local, com a atividade `rework_requested` → `awaiting_review` e o evento sem foto nova. No fim, os quatro aparelhos saíram do app (`/auth/logout`) e ficaram sem token.

Captura em `docs/superpowers/specs/telas-painel/`: `sino-avisos.png` (sino aberto de Carlos Demo, 9 não lidos).

| Passo                         | Resultado                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atribuir (ocorrência de 3)    | OK: no log, 3 `Push (log, sem provedor)` `request_in_progress` (`Solicitação 2026-000127: em atendimento`, `…128`, `…129`, android) e 1 `work_order_assigned` (`Nova atividade: 2026-000127`, ios), com só o fim do token (`…-plano-7`). Fila: 4 linhas `sent`.                                                 |
| Concluir com foto (agente)    | OK: sino `Solicitação 2026-000127: concluída com fotos` para Carlos Demo, Rita Demo (admin) e Eva Gestora (`withPhotos: true`). Nenhum push.                                                                                                                                                                    |
| Concluir sem foto (simulação) | OK: `Solicitação 2026-000262: concluída sem fotos` (`withPhotos: false`). O sino também mostra 'sem fotos' para as conclusões do seed, que não têm foto de conclusão.                                                                                                                                           |
| Impedimento (agente)          | OK: sino `Solicitação 2026-000260: impedimento registrado` para os três.                                                                                                                                                                                                                                        |
| Publicar (painel)             | OK: 3 push `Solicitação {p}: concluída. Confira as fotos` e 3 `E-mail (log, sem provedor)` com assunto `Solicitação {p}: concluída` e o corpo do plano, para `cidadao.demo`, `cidadao2.demo` e `cidadao3.demo@alocidadao.dev`.                                                                                  |
| Contestar (Cidadão Demo)      | OK: push `Solicitação 2026-000128: voltou para análise` e `…129` para as outras duas cidadãs; quem contestou não recebe nada. Sino `Solicitação 2026-000127: contestada pelo cidadão`.                                                                                                                          |
| Cancelar (Cidadão Demo 3)     | OK: sino `Solicitação 2026-000119: cancelada pelo cidadão`; nenhum push.                                                                                                                                                                                                                                        |
| Sino do gestor                | OK (`sino-avisos`): contador 9, lista do mais novo para o mais antigo, não lidos em destaque, hora 'há 1 min'. Tocar leva e marca como lido (contador 9 → 8 → 7): contestada → `/solicitacoes?ocorrencia=…` com a gaveta aberta; impedimento → `/impedimentos?atividade=…`; concluída → `/revisao?atividade=…`. |
| Marcar todos como lidos       | OK: o contador some e o botão sai do cabeçalho; no banco, os 9 de Carlos Demo lidos e os de Rita Demo e Eva Gestora intactos.                                                                                                                                                                                   |
| Sino do admin                 | OK: Rita Demo (Admin da prefeitura) vê os mesmos avisos com o próprio contador (9); cancelada → `/solicitacoes?ocorrencia=…` abre a gaveta da ocorrência cancelada ('Cancelada há 1 min').                                                                                                                      |
| Modo suporte                  | OK: Suporte Demo entrou na Prefeitura Demo A; o menu não tem o botão 'Avisos'.                                                                                                                                                                                                                                  |
| Logout do app                 | OK: `POST /auth/logout` do Cidadão Demo 3 apagou o token do aparelho da sessão.                                                                                                                                                                                                                                 |

O que não deu para ver:

- **Vazio** ('Nenhum aviso por enquanto.') e **'99+'**: nenhuma conta do seed estava sem aviso ou com mais de 99; só os testes do `NotificationBell` cobrem.
- **'Nova, aguardando análise'** (`occurrence_new`): pede uma solicitação nova criada pelo app (fotos e GPS); não foi criada na passada. Coberto pelos testes do gatilho.
- **Confirmação automática em 7 dias, nova tentativa e falha do envio:** dependem do tempo ou de um provedor que falha; só os testes cobrem.
- **Push de verdade e toque no push:** sem Firebase e Apple; o toque no push (troca de modo, partida a frio) ficou no roteiro de aparelho do `0002` (seção 5).

Problemas achados e corrigidos:

- **Teste de push do Laboratório quebrado:** a tela mandava `status` para `/dev/push`, que desde a Task 4 pede `kind`; com o provedor configurado daria 400. O corpo saiu para `lib/lab-push.ts`, com teste. Commit `App: teste de push do Laboratório com o tipo do aviso`.

O que chamou atenção e não foi mudado (anotado nas pendências): 'concluída sem fotos' só aparece para eventos sem foto gravados fora da API; o nome acessível do botão do sino não diz quantos avisos há.
