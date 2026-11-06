# Código de entrada pelo WhatsApp — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O código de 6 dígitos do app (entrada e troca de celular) sai do SMS e vai pelo WhatsApp, através de uma interface nossa que não conhece o provedor; primeiro provedor: WhatsApp Cloud API da Meta.

**Architecture:** A API passa a depender de `PhoneCodeSender` (`send(phone, code)`). Adaptadores em `apps/api/src/messaging/`: `log` (código no log) e `meta` (Graph API, modelo de autenticação). O `server.ts` escolhe o adaptador pela configuração (`PHONE_CODE_PROVIDER`). Se o envio falha, o código é descartado no banco (função nova) e a rota responde 503 `phone_code_not_sent`, liberando novo pedido na hora. O SMS sai do código, dos textos e dos documentos.

**Tech Stack:** Fastify 5, Zod 4, Drizzle + Postgres (funções `SECURITY DEFINER`), Vitest, Expo Router, React 19.

**Spec:** `docs/superpowers/specs/2026-11-05-codigo-por-whatsapp-design.md`

## Global Constraints

- Fora de `apps/api/src/messaging/phone-code-meta.ts` e da leitura de configuração (`env.ts`, `server.ts`), nada cita Meta, WhatsApp Cloud ou provedor: rotas, erros, dependências e banco usam "código pelo celular" / `phoneCode`.
- Códigos de erro da API: `phone_code_not_configured` (sem provedor, 503) e `phone_code_not_sent` (provedor falhou, 503). `sms_not_configured` deixa de existir.
- O adaptador `meta` nunca coloca o código nem o token em log ou em mensagem de erro; o celular em log vai mascarado.
- Tempo limite do adaptador `meta`: 10 s.
- Idioma padrão do modelo: `pt_BR`. Versão padrão da Graph API: `v23.0`.
- Fluxo de entrada inalterado: 60 s entre envios, 5 por hora por número, bloqueio na 5ª tentativa errada, regra dos 90 dias, limites por IP e por conta.
- `TERMS_VERSION` não muda.
- Textos ao usuário em português do Brasil, exatamente como neste plano.
- Antes de cada commit: `pnpm lint`, `pnpm exec prettier --check <arquivos>` e a suíte do pacote tocado.

## Review Focus

1. Provedor fora do ar ou lento (tempo limite): a pessoa pede de novo na hora e recebe 200, não 429 — teste na Task 3.
2. Erro do provedor com corpo que ecoa dados: a mensagem de erro e o log não trazem o código nem o token — teste na Task 2.
3. Celular `+5562982089667`: vai para a Meta como `5562982089667` — teste na Task 2.
4. `PHONE_CODE_PROVIDER=meta` sem credencial: a API não sobe (`parseEnv` lança) — teste na Task 2.
5. Produção sem `PHONE_CODE_PROVIDER`: `/auth/phone/start` responde 503 `phone_code_not_configured` — teste na Task 3.

---

### Task 1: Descartar código que não saiu (banco)

**Files:**

- Create: `packages/db/migrations/0047_discard_code.sql` (e a entrada `0047_discard_code` em `packages/db/migrations/meta/_journal.json`, no formato das anteriores)
- Modify: `packages/db/src/auth.ts` (junto de `issueCode`)
- Test: `packages/db/src/auth.test.ts`

**Interfaces:**

- Produces: `discardCode(db: Executor, id: string): Promise<void>` exportada de `@alocidadao/db`. Apaga o código não usado com esse id; id desconhecido ou já consumido não faz nada.

- [ ] **Step 1: Testes que falham** em `auth.test.ts`, no estilo dos vizinhos (`emite código e recusa reenvio antes de 60 s`):
  - `'código descartado libera novo envio na hora'`: `issueCode` para um número; `discardCode(db, id)`; novo `issueCode` para o mesmo número e finalidade → `issued: true`.
  - `'código descartado não conta no limite da hora'`: emitir e descartar 5 vezes seguidas o mesmo destino; o 6º `issueCode` → `issued: true`.
  - `'descartar id desconhecido não faz nada'`: `discardCode` com `randomUUID()` resolve sem erro.
  - `'não descarta código já consumido'`: emitir, consumir com o código certo (`consumeCode`), `discardCode`; o `issueCode` seguinte antes de 60 s continua recusado.
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test -- auth` → FALHA (`discardCode` não existe).
- [ ] **Step 3:** Migração com `auth_discard_code(p_id uuid) RETURNS void`, `LANGUAGE sql VOLATILE SECURITY DEFINER`, `SET search_path = public, pg_temp`, `DELETE FROM verification_codes WHERE id = p_id AND consumed_at IS NULL` (confira o nome da coluna de consumo em `0013_auth_functions.sql`), com `REVOKE ALL ... FROM PUBLIC` e `GRANT EXECUTE ... TO app_user`, comentário em português no topo como em `0046_panel_idle_1h.sql`. `discardCode` chama `select auth_discard_code(${id}::uuid)`.
- [ ] **Step 4:** `pnpm db:migrate` e `pnpm --filter @alocidadao/db test` → PASSA.
- [ ] **Step 5: Commit** `feat(db): descarta código de verificação que não foi enviado`

### Task 2: Interface, adaptadores e configuração

**Files:**

- Create: `apps/api/src/messaging/phone-code.ts`, `apps/api/src/messaging/phone-code-meta.ts`
- Test: `apps/api/src/messaging/phone-code.test.ts`, `apps/api/src/messaging/phone-code-meta.test.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/src/env.test.ts`, `apps/api/src/server.ts`, `apps/api/.env.example`

**Interfaces:**

- Produces (em `phone-code.ts`):
  - `interface PhoneCodeSender { send(phone: string, code: string): Promise<void> }` — `phone` no formato `+55…` (`phoneSchema`).
  - `createLogPhoneCodeSender(log: FastifyBaseLogger): PhoneCodeSender` — `log.info({ phone, code }, 'Código pelo celular (log, sem provedor)')`.
  - `maskPhone(phone: string): string` — `'+5562982089667'` → `'+55 62 9****-9667'`.
- Produces (em `phone-code-meta.ts`):
  - `interface MetaWhatsAppConfig { phoneNumberId: string; accessToken: string; templateName: string; templateLanguage: string; graphApiVersion: string }`
  - `createMetaPhoneCodeSender(config: MetaWhatsAppConfig, opts?: { fetch?: typeof fetch; timeoutMs?: number }): PhoneCodeSender`
- Produces (em `env.ts`): `ApiEnv.phoneCode?: { provider: 'log' } | { provider: 'meta'; meta: MetaWhatsAppConfig }`.

- [ ] **Step 1: Testes que falham.**
  - `phone-code.test.ts`: `maskPhone('+5562982089667')` → `'+55 62 9****-9667'`; o sender de log chama `log.info` com `{ phone, code }`.
  - `phone-code-meta.test.ts` (fetch falso que guarda a chamada):
    - `'posts the authentication template'`: URL `https://graph.facebook.com/v23.0/PNID/messages`; cabeçalho `authorization: Bearer TOKEN`; corpo igual a
      ```json
      {
        "messaging_product": "whatsapp",
        "to": "5562982089667",
        "type": "template",
        "template": {
          "name": "codigo_entrada",
          "language": { "code": "pt_BR" },
          "components": [
            { "type": "body", "parameters": [{ "type": "text", "text": "123456" }] },
            {
              "type": "button",
              "sub_type": "url",
              "index": "0",
              "parameters": [{ "type": "text", "text": "123456" }]
            }
          ]
        }
      }
      ```
    - `'rejected send throws without code or token'`: fetch responde 400 com corpo `{"error":{"message":"bad 123456 TOKEN","code":131030}}`; `send` rejeita, e a mensagem do erro contém `400` e `131030` e não contém `123456` nem `TOKEN`.
    - `'gives up after the timeout'`: fetch que respeita `signal` e nunca responde; com `timeoutMs: 20`, `send` rejeita.
  - `env.test.ts`:
    - sem `PHONE_CODE_PROVIDER` → `phoneCode` `undefined`;
    - `PHONE_CODE_PROVIDER=log` → `{ provider: 'log' }`;
    - `meta` com `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_TEMPLATE_NAME` → `meta` com `templateLanguage: 'pt_BR'` e `graphApiVersion: 'v23.0'`; `META_WA_TEMPLATE_LANGUAGE` e `META_WA_GRAPH_VERSION` substituem os padrões;
    - `meta` sem `META_WA_ACCESS_TOKEN` → lança com `META_WA_ACCESS_TOKEN: obrigatória quando PHONE_CODE_PROVIDER=meta`;
    - `PHONE_CODE_PROVIDER=sms` → lança.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- phone-code env` → FALHA.
- [ ] **Step 3: Implementar.**
  - Meta: `AbortSignal.timeout(timeoutMs ?? 10_000)`; o número vai sem o `+`; com resposta não-ok, lê só `error.code` do JSON (se houver) e lança `Error(\`WhatsApp (Meta) recusou o envio: ${status}${code ? \` (${code})\` : ''}\`)`.
  - Env: `PHONE_CODE_PROVIDER: z.enum(['log','meta'])` opcional (vazio = ausente) e as variáveis `META_WA_*`; obrigatórias com `meta` usando o `missing(...)` existente.
  - `server.ts`: monta o sender (`meta` → `createMetaPhoneCodeSender(env.phoneCode.meta)`; `log` → log de `app.log`, como o e-mail faz; sem configuração → `undefined`) e passa em `auth: { ...env.auth, email, phoneCode, termsGate: true }`. Com `log` e `NODE_ENV=production`, depois de criar a app: `app.log.warn('PHONE_CODE_PROVIDER=log em produção: o código de entrada sai no log')`. Troca o comentário do SMS na linha do `auth`.
  - `.env.example`: bloco comentado com `PHONE_CODE_PROVIDER` e as `META_WA_*`, explicando: sem a variável, fora de produção o código sai no log, e em produção a API responde 503; `log` em produção só na homologação. O comentário de `AUTH_DEV_FIXED_CODE` passa a "para testar sem WhatsApp".
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm typecheck` → PASSA. Nesta task a rota ainda recebe `sms`. O `server.ts` só passa `phoneCode` depois que a Task 3 cria o campo; se o typecheck reclamar, deixe a ligação no `server.ts` para a Task 3 e anote no relatório.
- [ ] **Step 5: Commit** `feat(api): envio do código pelo celular independente de provedor, com adaptador da Meta`

### Task 3: Rotas usam `PhoneCodeSender`; SMS sai da API

**Files:**

- Modify: `apps/api/src/app.ts`, `apps/api/src/auth/app-routes.ts`, `apps/api/src/me/routes.ts`, `apps/api/src/auth/codes.ts`, `apps/api/src/server.ts` (se ficou da Task 2)
- Delete: `apps/api/src/messaging/sms.ts`
- Test: `apps/api/src/auth/app-routes.test.ts`, `apps/api/src/me/routes.test.ts`, `apps/api/src/auth/panel-routes.test.ts`

**Interfaces:**

- Consumes: `PhoneCodeSender`, `createLogPhoneCodeSender`, `maskPhone` (Task 2); `discardCode` (Task 1).
- Produces:
  - `AuthOptions.phoneCode?: PhoneCodeSender` (substitui `sms`). Sem ele: fora de produção, log; em produção, 503 `phone_code_not_configured`. `AuthDeps.phoneCode` e `MeDeps` idem.
  - Em `codes.ts`: `deliverPhoneCode(db: Database, sender: PhoneCodeSender, log: FastifyBaseLogger, phone: string, challenge: { challengeId: string; code: string }): Promise<boolean>`. Envia; se falhar, chama `discardCode`, faz `log.warn({ err, phone: maskPhone(phone) }, 'Código pelo celular não enviado')` e devolve `false`.

- [ ] **Step 1: Testes que falham** (os injetores trocam `sms` por `phoneCode: PhoneCodeSender`, que guarda `{ phone, code }`):
  - `app-routes.test.ts`: o teste existente de "O SMS sai nos dois casos" passa a conferir `{ phone, code: '123456' }`.
    - `'provider failure answers 503 phone_code_not_sent and allows retry right away'`: sender que lança na primeira chamada e funciona na segunda; o 1º `/auth/phone/start` → 503 `{ code: 'phone_code_not_sent' }`; o 2º, logo em seguida, → 200.
    - `'production without provider answers 503 phone_code_not_configured'`: `vi.stubEnv('NODE_ENV', 'production')`, app sem `phoneCode` → 503 `{ code: 'phone_code_not_configured' }` (restaurar com `vi.unstubAllEnvs()`).
  - `me/routes.test.ts`: o teste que confere `smsSent` passa a conferir `{ phone, code }`; mais `'phone change provider failure answers 503 phone_code_not_sent'`.
  - `panel-routes.test.ts`: só a troca de `sms` por `phoneCode`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- auth me` → FALHA.
- [ ] **Step 3: Implementar.** Nas duas rotas (`/auth/phone/start`, `/me/phone/start`): sem sender, 503 `phone_code_not_configured`; depois de `issueChallenge`, `if (!(await deliverPhoneCode(...))) return reply.code(503).send({ code: 'phone_code_not_sent' })`. Comentários que falam em SMS passam a "código pelo celular" (ex.: o limite por conta: "cada envio custa"). Apagar `sms.ts` e `smsCodeText`.
- [ ] **Step 4:** `grep -rn -i sms apps/api/src` só pode achar `sms-otp` (nenhum, na API). `pnpm --filter @alocidadao/api test`, `pnpm typecheck`, `pnpm lint` → PASSA.
- [ ] **Step 5: Commit** `refactor(api): rotas mandam o código pelo PhoneCodeSender; SMS removido`

### Task 4: Textos do app, painel, convite, documentos legais e docs

**Files:**

- Modify: `apps/mobile/src/app/(auth)/entrar.tsx`, `apps/mobile/src/app/(auth)/codigo.tsx`, `apps/mobile/src/app/(app)/perfil/celular.tsx`, `apps/mobile/src/app/(app)/perfil/celular-codigo.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/auth/login-flow.ts`, `apps/mobile/src/auth/login-flow.test.ts`, `apps/mobile/src/ui/CodeInput.tsx` (só comentário), `apps/web/src/teams/AgentDialog.tsx`, `apps/api/src/messaging/invites.ts`, `apps/api/src/messaging/invites.test.ts`, `packages/shared/src/legal/terms.ts`, `packages/shared/src/legal/privacy.ts`, `packages/db/src/schema.ts` (comentário), `apps/api/.env` (comentário), `docs/planejamento-mvp.md`

**Interfaces:** nenhuma nova; só textos e o mapa de erros do app.

- [ ] **Step 1: Testes que falham.**
  - `login-flow.test.ts`: `errorMessage('phone_code_not_configured')` → `'Não foi possível enviar o código agora. Tente mais tarde.'`; `errorMessage('phone_code_not_sent')` → `'Não foi possível enviar o código agora. Tente de novo em instantes.'`. Remover o caso de `sms_not_configured`.
  - `invites.test.ts`: `expect(m.text).toContain('código pelo WhatsApp')`.
- [ ] **Step 2:** rodar os dois testes → FALHA.
- [ ] **Step 3: Trocar os textos, exatamente:**
  - `entrar.tsx`, `perfil/celular.tsx`, `dev/kit.tsx`: `Enviaremos um código pelo WhatsApp para confirmar que o número é seu.`
  - `codigo.tsx`, `perfil/celular-codigo.tsx`: `Enviado pelo WhatsApp para {formatPhoneBR(params.phone)}.`
  - Os comentários de `entrar.tsx`, `codigo.tsx`, `login-flow.ts` e `CodeInput.tsx` deixam de citar SMS. O `autoComplete="sms-otp"` fica, porque é o nome do recurso do sistema.
  - `login-flow.ts`, `MESSAGES`: sai `sms_not_configured`; entram as duas mensagens do Step 1.
  - `AgentDialog.tsx`: `Ele recebe o código de acesso pelo WhatsApp neste número.`
  - `invites.ts`: `Você recebe um código por SMS.` → `Você recebe um código pelo WhatsApp.`
  - `terms.ts`: `...um código de 6 dígitos enviado por SMS.` → `...um código de 6 dígitos enviado pelo WhatsApp.`
  - `privacy.ts`: `com o código enviado por SMS ou e-mail` → `com o código enviado pelo WhatsApp ou por e-mail`; `envio de SMS` → `envio de mensagens pelo WhatsApp (Meta)`.
  - `schema.ts`: comentário `Códigos enviados pelo WhatsApp ou e-mail.`
  - `apps/api/.env`: comentário de `AUTH_DEV_FIXED_CODE` igual ao do `.env.example`.
  - `docs/planejamento-mvp.md`:
    - item do Plano 8: tirar "enviar o convite também por SMS e";
    - pergunta em aberto: "(SMS tem custo por mensagem)" → "(o código pelo WhatsApp tem custo por mensagem)";
    - no item 9 ou junto ao 10, uma linha "Código de entrada pelo WhatsApp (independente de provedor; primeiro, a API da Meta). **Feito** (plano `docs/superpowers/plans/2026-11-06-codigo-por-whatsapp.md`)".
- [ ] **Step 4:** `grep -rn -i "sms" apps packages docs/planejamento-mvp.md --exclude-dir=node_modules --exclude-dir=dist` só pode achar `sms-otp`, migrações antigas e testes históricos de outros planos. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` → PASSA.
- [ ] **Step 5: Commit** `feat: textos falam em WhatsApp no lugar de SMS`
