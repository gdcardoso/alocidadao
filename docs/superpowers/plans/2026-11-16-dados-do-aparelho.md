# Dados do aparelho no login e nas solicitações — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardar sistema, versão do sistema, fabricante, modelo e versão do app. Esses dados ficam nos aparelhos da conta, em cada login do app e em cada solicitação. No login do painel, guardar o navegador e o sistema.

**Architecture:**

- Os esquemas zod de `packages/shared` ganham os campos novos, todos opcionais.
- Uma migração acrescenta colunas em `devices` e uma coluna `device jsonb` em `sessions` e em `requests`.
- A API grava esses dados em três pontos que já existem: `startSession`, `PUT /me/devices` e a criação da solicitação.
- O painel interpreta o `User-Agent` com `bowser`.
- O app lê os dados com `expo-device` e os manda no login, no registro do aparelho e no envio da fila.

**Tech Stack:** TypeScript, zod 4, Fastify, Drizzle + Postgres, Expo (`expo-device`), vitest, `bowser`.

**Spec:** `docs/superpowers/specs/2026-11-16-dados-do-aparelho-design.md`

## Global Constraints

- **Campos novos:**
  - Os três campos novos do app são `osVersion`, `manufacturer` e `model`.
  - São **opcionais** em todo esquema, porque o app já instalado não os manda e precisa continuar funcionando.
  - Cada um é uma string de 1 a 64 caracteres.
- **Nada de IMEI,** número de série, ID de publicidade, operadora ou dados do chip.
- **Painel:** guarda só o resultado interpretado do `User-Agent` (`browser`, `browserVersion`, `os`, `osVersion`), nunca o texto bruto.
- **Bibliotecas:** a do `User-Agent` é `bowser` (MIT). `ua-parser-js` 2.x é AGPL e está proibida.
- **Termos:** `TERMS_VERSION` não muda.
- **Conexão:** `status_events.connection` não muda.
- **Ações do agente:** não ganham `device`.
- **Exclusão de conta:** não apaga `requests.device`.
- **Código:** comentários e nomes no estilo do código vizinho, com comentários em português e nomes em inglês.
- **Commits:** em português, com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **App antigo** (corpo sem os campos novos) entrando, registrando o aparelho e enviando solicitação. Esperado: tudo funciona, as colunas novas ficam nulas e nenhum 400. Teste nas Tasks 2 e 3.
- **`PUT /me/devices` sem os campos novos depois de um login que os mandou.** Esperado: os valores gravados continuam, e um campo ausente nunca apaga dado. Teste na Task 2.
- **Login do painel sem `User-Agent`, ou com um texto que não é de navegador** (`curl/8.0`). Esperado: o login funciona e `sessions.device` fica nulo, ou com os campos que o `bowser` souber. Teste na Task 4.
- **Item da fila offline criado antes da atualização do app.** O payload guardado não tem `device`. Esperado: o envio usa o aparelho do momento do envio, sem quebrar. Teste na Task 5.
- **Solicitação repetida (mesmo `clientActionId`) com outro `device`.** Esperado: devolve a original, sem regravar o `device`. Teste na Task 3.

---

### Task 1: Esquemas compartilhados

**Files:**

- Modify: `packages/shared/src/auth.ts` (em volta de `deviceInfoSchema`, linhas 50-55, e de `deviceUpdateBodySchema`, linhas 179-184)
- Modify: `packages/shared/src/schemas.ts` (`createRequestInputSchema`, linha 30)
- Test: `packages/shared/src/auth.test.ts`, `packages/shared/src/schemas.test.ts`

**Interfaces:**

- **Produz, em `auth.ts`:**
  - `appDeviceSchema = z.object({ platform: z.enum(['android','ios']), appVersion: z.string().min(1).max(32), osVersion?, manufacturer?, model? })`. Os três opcionais são `z.string().trim().min(1).max(64).optional()`.
  - `type AppDevice`.
  - `deviceInfoSchema = appDeviceSchema.extend({ installationId: z.uuid() })`, mantendo `type DeviceInfo`.
  - `deviceUpdateBodySchema = appDeviceSchema.extend({ pushToken: z.string().nullable().optional() })`.
  - `browserClientSchema = z.object({ browser, browserVersion, os, osVersion })`, cada um `z.string().max(64).nullable()`, e `type BrowserClient`.
  - `sessionDeviceSchema = z.discriminatedUnion('kind', [appDeviceSchema.extend({ kind: z.literal('app') }), browserClientSchema.extend({ kind: z.literal('browser') })])` e `type SessionDevice`.
- **Produz, em `schemas.ts`:** `createRequestInputSchema` ganha `device: appDeviceSchema.optional()`.

- [ ] **Step 1: Testes que falham**
  - Em `auth.test.ts`:
    - `deviceInfoSchema` aceita `{ installationId, platform: 'android', appVersion: '1.0.0' }` (app antigo) e também `{ ..., osVersion: '16', manufacturer: 'samsung', model: 'SM-S908E' }`;
    - recusa `model` com 65 caracteres e `model: ''`;
    - `sessionDeviceSchema` aceita `{ kind: 'browser', browser: 'Chrome', browserVersion: '142.0', os: 'Windows', osVersion: null }`.
  - Em `schemas.test.ts`: `createRequestInputSchema` aceita um corpo válido sem `device` e com `device: { platform: 'ios', appVersion: '1.0.0', osVersion: '18.1', manufacturer: 'Apple', model: 'iPhone 15' }`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → os testes novos falham.
- [ ] **Step 3:** Implementar as interfaces acima e exportá-las pelo `index.ts`, se o pacote reexportar por lá.
- [ ] **Step 4:** `pnpm --filter @alocidadao/shared test && pnpm --filter @alocidadao/shared typecheck` → passam.
- [ ] **Step 5:** Commit `feat(shared): dados do aparelho nos esquemas`.

### Task 2: Banco, login do app e registro do aparelho

**Files:**

- Modify: `packages/db/src/schema.ts` (`sessions`, linha 160; `devices`, linha 184; `requests`, linha 534)
- Create: `packages/db/migrations/0048_device_details.sql`, gerado com `pnpm --filter @alocidadao/db db:generate --name device_details`, mais o `meta/` que o drizzle-kit atualiza
- Modify: `apps/api/src/auth/session.ts` (`startSession`)
- Modify: `apps/api/src/me/routes.ts` (`PUT /me/devices/:installationId`, linhas 192-227)
- Test: `apps/api/src/auth/app-routes.test.ts`, `apps/api/src/me/routes.test.ts`

**Interfaces:**

- **Consome, da Task 1:** `DeviceInfo`, `SessionDevice` e `deviceUpdateBodySchema`.
- **Produz:**
  - **colunas:**
    - em `devices`: `osVersion text`, `manufacturer text` e `model text`, todas nulas;
    - em `sessions`: `device jsonb` nula, tipada com `$type<SessionDevice>()`;
    - em `requests`: `device jsonb` nula, tipada com `$type<AppDevice>()`.
  - **`startSession`:** ganha o parâmetro opcional `client?: BrowserClient | null`, usado pelo painel na Task 4.
  - **`sessions.device`:**
    - app: `{ kind: 'app', platform, appVersion, osVersion?, manufacturer?, model? }`, a partir de `device` sem o `installationId`;
    - painel: `{ kind: 'browser', ...client }`;
    - nulo quando não há nenhum dos dois.

- [ ] **Step 1: Testes que falham**
  - `app-routes.test.ts`, teste `sign in stores device details on the device and the session`:
    - o login do app manda `device` com `osVersion: '16', manufacturer: 'samsung', model: 'SM-S908E'`;
    - a linha de `devices` tem esses 3 valores;
    - a sessão criada tem `device` igual a `{ kind: 'app', platform: 'android', appVersion: <a do teste>, osVersion: '16', manufacturer: 'samsung', model: 'SM-S908E' }`.
  - `app-routes.test.ts`, teste `sign in from an old app without device details still works`:
    - status de sucesso;
    - `devices.model` é `null`;
    - `sessions.device` é `{ kind: 'app', platform, appVersion }`.
  - `routes.test.ts`, teste `device update keeps stored details when the body omits them`:
    - um `PUT` com `model: 'SM-S908E', osVersion: '16', manufacturer: 'samsung'`, depois outro `PUT` só com `platform` e `appVersion`;
    - a linha continua com `model: 'SM-S908E'`, `osVersion: '16'` e `manufacturer: 'samsung'`;
    - um terceiro `PUT` com `osVersion: '17'` troca só a versão.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- app-routes me/routes` → os testes novos falham.
- [ ] **Step 3: Implementar**
  - **Esquema e migração:**
    - colunas no `schema.ts`;
    - gerar a migração `0048_device_details`;
    - conferir que o SQL tem só `ALTER TABLE … ADD COLUMN`, sem mexer em política nem em grant.
  - **Upsert em `devices`** (em `startSession` e no `PUT /me/devices`):
    - grava `osVersion`, `manufacturer` e `model`;
    - no `onConflictDoUpdate`, cada um entra no `set` só quando veio definido, como já é feito com `pushToken` em `me/routes.ts:221`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test && pnpm --filter @alocidadao/api test` → passam (os testes da API rodam as migrações).
- [ ] **Step 5:** Commit `feat(api): guarda os dados do aparelho no login e no registro do aparelho`.

### Task 3: Aparelho na solicitação

**Files:**

- Modify: `apps/api/src/citizen/create-request.ts` (insert em `requests`, em volta da linha 169)
- Test: `apps/api/src/citizen/create-request.test.ts`

**Interfaces:**

- **Consome:**
  - `createRequestInputSchema.device`, da Task 1;
  - a coluna `requests.device`, da Task 2.

- [ ] **Step 1: Testes que falham**, em `create-request.test.ts`
  - Teste `stores the device of the submission`:
    - o corpo tem `device: { platform: 'android', appVersion: '1.0.0', osVersion: '16', manufacturer: 'samsung', model: 'SM-S908E' }`;
    - a linha de `requests` tem `device` igual a esse objeto.
  - Teste `request without device (old app) is created with null device`: 201 e `device` igual a `null`.
  - Teste `a repeated submission keeps the first device`:
    - o mesmo `clientActionId`, reenviado com `model: 'Outro'`;
    - a resposta tem `duplicate: true`;
    - `requests.device.model` continua `'SM-S908E'`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- create-request` → os testes novos falham.
- [ ] **Step 3:** Gravar `device: input.device ?? null` no insert de `requests`.
- [ ] **Step 4:** O mesmo comando → passa.
- [ ] **Step 5:** Commit `feat(api): solicitação guarda o aparelho do envio`.

### Task 4: Navegador e sistema no login do painel

**Files:**

- Create: `apps/api/src/auth/user-agent.ts`
- Create: `apps/api/src/auth/user-agent.test.ts`
- Modify: `apps/api/package.json` (dependência `bowser`, com `pnpm --filter @alocidadao/api add bowser`)
- Modify: `apps/api/src/auth/panel-routes.ts` (`/auth/panel/verify`, chamada de `startSession` na linha 145)
- Test: `apps/api/src/auth/panel-routes.test.ts`

**Interfaces:**

- **Consome:**
  - `BrowserClient`, da Task 1;
  - o parâmetro `client` de `startSession`, da Task 2.
- **Produz:** `parseUserAgent(userAgent: string | undefined): BrowserClient | null`.
  - Devolve `null` sem texto, ou quando o `bowser` não reconhece nem o navegador nem o sistema.
  - Os campos que ele não souber ficam `null`.
  - Cada valor é cortado em 64 caracteres.

- [ ] **Step 1: Testes que falham**
  - `user-agent.test.ts`, teste `parses Chrome on Windows`:
    - entrada: `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'`;
    - saída: `{ browser: 'Chrome', browserVersion: '142.0.0.0', os: 'Windows', osVersion: 'NT 10.0' }` (o `osVersion` é o que o `bowser` devolver, fixado no teste depois da primeira execução).
  - `user-agent.test.ts`, teste `parses Safari on macOS`:
    - entrada: `'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'`;
    - saída: `browser: 'Safari'`, `os: 'macOS'`.
  - `user-agent.test.ts`, teste `returns null without user agent`: `parseUserAgent(undefined)` e `parseUserAgent('')` → `null`.
  - `panel-routes.test.ts`, teste `panel sign in stores browser and system on the session`:
    - o `inject` do verify com `headers: { 'user-agent': <o do Chrome acima> }`;
    - `sessions.device` tem `kind: 'browser'`, `browser: 'Chrome'` e `os: 'Windows'`.
  - `panel-routes.test.ts`, teste `panel sign in without user agent still works`: 200 e `sessions.device` igual a `null`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- user-agent panel-routes` → falham.
- [ ] **Step 3:** Implementar `parseUserAgent` com `Bowser.parse` e passar `client: parseUserAgent(request.headers['user-agent'])` para `startSession`.
- [ ] **Step 4:** O mesmo comando → passa. Rodar também `pnpm lint`.
- [ ] **Step 5:** Commit `feat(api): login do painel guarda navegador e sistema`.

### Task 5: App manda os dados do aparelho

**Files:**

- Modify: `apps/mobile/src/lib/register-device.ts` (`deviceInfo()`)
- Modify: `apps/mobile/src/offline/outbox.ts` (`ProcessOutboxDeps`, linha 179; `sendCreateRequest`, linha 284)
- Modify: `apps/mobile/src/offline/outbox-service.ts` (montagem das dependências da fila)
- Modify: `apps/mobile/src/offline/test-helpers.ts` (dependência falsa)
- Test: `apps/mobile/src/offline/outbox.test.ts`

**Interfaces:**

- **Consome, da Task 1:** `AppDevice`.
- **Produz:**
  - **`deviceInfo(): AppDevice`:**
    - `osVersion` vem de `Device.osVersion`;
    - `manufacturer` vem de `Device.manufacturer`;
    - `model` vem de `Device.modelName`;
    - cada um só entra quando não é nulo nem vazio, cortado em 64 caracteres.
  - **`ProcessOutboxDeps`:** ganha `device: () => AppDevice`.
    - O `outbox-service.ts` passa `deviceInfo`.
    - O `sendCreateRequest` monta o envio com `device: deps.device()`.
    - O `device` não entra no payload guardado na fila: é lido no envio, e por isso o item antigo da fila também ganha `device`.
  - **Ações do agente:** o `sendWorkOrderAction` não muda.

- [ ] **Step 1: Teste que falha**, em `outbox.test.ts`, teste `create request sends the device of the phone`:
  - com a dependência falsa `device: () => ({ platform: 'android', appVersion: '1.0.0', model: 'SM-S908E' })`, o transporte falso recebe o envio com esse `device`;
  - com um item cujo payload guardado não tem `device` (fila antiga), o `device` também é enviado.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test -- outbox` → falha.
- [ ] **Step 3:** Implementar. O login (`apps/mobile/src/app/(auth)/codigo.tsx:48`) e o `registerDevice` já usam `deviceInfo()` e passam a mandar os campos novos sem outra mudança.
- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test && pnpm --filter @alocidadao/mobile typecheck` → passam.
- [ ] **Step 5:** Commit `feat(mobile): envia os dados do aparelho no login e nas solicitações`.

### Task 6: Política de privacidade e conferência final

**Files:**

- Modify: `packages/shared/src/legal/privacy.ts` (lista "Todas as pessoas", linhas 56-62)
- Test: `packages/shared/src/legal/legal.test.ts`

- [ ] **Step 1: Teste que falha**, em `legal.test.ts`, teste `privacy policy lists the device details`: o texto da política contém `fabricante`, `modelo`, `versão do sistema` e `navegador`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test -- legal` → falha.
- [ ] **Step 3:** Trocar o item "dados do aparelho" por:

  ```
  'dados do aparelho: sistema (Android ou iOS) e a versão dele, fabricante e modelo do celular, versão do app, um identificador da instalação e o código usado para enviar notificações. No painel, o navegador e o sistema do computador;',
  ```

  Na seção de finalidades (linha 77), acrescentar à lista o item:

  ```
  'Saber em quais aparelhos e navegadores o serviço é usado, para testar e dar suporte a eles.',
  ```

  Não mudar `TERMS_VERSION`.

- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` na raiz → tudo passa. Se `format:check` não existir, rodar `npx prettier --check .`.
- [ ] **Step 5:** Commit `docs(legal): política cita modelo, fabricante, versão do sistema e navegador`.
