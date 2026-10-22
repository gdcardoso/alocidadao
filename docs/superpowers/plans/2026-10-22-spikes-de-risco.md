# Spikes de risco (nativo, offline com fotos, push) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar no emulador Android (e depois em aparelhos reais) os três riscos que ainda podem mudar a arquitetura: recursos nativos no Expo, atendimento offline com fotos e push direto por FCM/APNs.

**Architecture:** O app ganha Expo Router, um development build e uma área "Laboratório" com uma seção por spike. A API ganha armazenamento S3 (MinIO local, compatível com o DigitalOcean Spaces), um registro de idempotência de ações offline e envio direto de push. A rota `/dev/*` e as telas do Laboratório são **temporárias**: saem quando as funcionalidades reais chegarem. Os módulos de núcleo ficam para o MVP: contexto de conexão, compressão de foto, fila offline, armazenamento e envio de push.

**Tech Stack:**

- App: Expo SDK 58 (expo-router, expo-dev-client, expo-camera, expo-location, expo-image-manipulator, expo-file-system, expo-sqlite, expo-secure-store, expo-crypto, expo-notifications, @react-native-community/netinfo).
- API: Fastify 5 + Zod 4, @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner, google-auth-library, jose.
- Infraestrutura e testes: Postgres 17 + PostGIS, MinIO, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md` (regras), `docs/planejamento-mvp.md` (seção "Testes de risco e próximos passos", critério de pronto de cada spike).

## Global Constraints

- **Expo muda a cada versão:** antes de tocar numa API do Expo, ler `apps/mobile/AGENTS.md` e a documentação da v58 (`https://docs.expo.dev/versions/v58.0.0/`). Instalar pacotes do app só com `npx expo install <pacote>` dentro de `apps/mobile`.
- **Nada de pasta nativa à mão:** não criar nem editar `ios/` e `android/`. Configuração nativa só em `app.json`/`app.config.ts` e config plugins.
- TypeScript `~6.0.3` em todos os pacotes; módulos NodeNext na API e nos pacotes.
- **Nomes e textos:** identificadores no código em inglês, comentários e textos de interface em português (padrão atual do repositório).
- **Fotos:** até 3 por solicitação e até 3 por conclusão, reduzidas no aparelho para o lado maior de **1600 px** e cerca de **300 KB** (spec, seção 8).
- **Push:** o conteúdo leva **só o protocolo e o status**, sem nome, endereço nem descrição (planejamento, "Notificações").
- **Contexto de conexão:** sempre no formato `connectionContextSchema` de `@alocidadao/shared`. O tipo de rede, a geração móvel, a latência até a API, o tempo de envio das fotos e se foi enviado offline vão em cada ação.
- **Isolamento:** toda tabela nova da prefeitura leva `tenant_id`, RLS com `FORCE` e FK composta, no padrão de `packages/db/migrations/0002_row_level_security.sql`.
- **Segredos:** nenhum no git. Ficam fora `google-services.json`, a conta de serviço do Firebase, a chave `.p8` da Apple e qualquer `.env`.
- **Rotas `/dev/*`:** só existem quando `NODE_ENV !== 'production'`. Como ainda não há login, identificam a pessoa pelos cabeçalhos `x-dev-user-id` e `x-dev-tenant-id`.
- **Emulador Android:** acessa o Mac por `10.0.2.2`. Use `EXPO_PUBLIC_API_URL=http://10.0.2.2:3333` e `S3_PUBLIC_ENDPOINT=http://10.0.2.2:9000`. Em aparelho real, troque pelo IP do Mac na rede local.
- **Commits:** mensagem em português, curta, no estilo do histórico, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Antes de cada commit, rodar `pnpm lint`, `pnpm format:check` e `pnpm turbo run typecheck test` sem erros.

## Review Focus

1. **App fechado no meio do envio:** um item da fila fica preso em "enviando". Na abertura seguinte, ele deve voltar para a fila. Coberto pela Task 7, teste `resets items left in flight`.
2. **Resposta perdida depois que o servidor gravou:** o app reenvia a mesma ação. O servidor devolve o mesmo resultado, sem duplicar histórico. Coberto pela Task 6 (`replays a duplicate clientActionId`) e pela Task 7 (`resumes without re-uploading photos`).
3. **Foto enviada, mas a ação falhou:** a nova tentativa não reenvia a foto nem perde a chave dela. Coberto pela Task 7.
4. **"Conectado" sem internet de verdade** (Wi-Fi sem saída, rede instável): a fila não entra em laço. Cada falha empurra a próxima tentativa com espera crescente. Coberto pela Task 7, teste `backs off after a network error`.
5. **Foto inexistente, de outra prefeitura ou grande demais referenciada na conclusão:** o servidor recusa com erro claro e não conclui a atividade. Coberto pela Task 6, teste `rejects photo keys that are missing, foreign or too large`.

---

### Task 1: Expo Router e development build no emulador

**Files:**

- Modify: `apps/mobile/package.json` (`"main": "expo-router/entry"`, dependências novas via `npx expo install expo-router expo-dev-client expo-linking expo-constants react-native-safe-area-context react-native-screens`)
- Modify: `apps/mobile/app.json` (plugin `expo-router`; o `scheme` `alocidadao` já existe)
- Delete: `apps/mobile/App.tsx`, `apps/mobile/index.ts`
- Create: `apps/mobile/src/app/_layout.tsx` (Stack), `apps/mobile/src/app/index.tsx` (o conteúdo atual do App.tsx: saúde da API e rótulos de status, com um link "Laboratório"), `apps/mobile/src/app/laboratorio/index.tsx` (lista das seções: Rede, Câmera e local, Atividades offline, Notificações)
- Create: `apps/mobile/src/lib/api.ts` (exporta o `api` criado com `createApiClient` e `EXPO_PUBLIC_API_URL`)
- Create: `apps/mobile/.env.example` (`EXPO_PUBLIC_API_URL=http://10.0.2.2:3333`)

**Interfaces:**

- Produces: as rotas `/laboratorio/rede`, `/laboratorio/camera`, `/laboratorio/offline` e `/laboratorio/notificacoes`, criadas nas tasks 2, 3, 8 e 10; o `api` de `src/lib/api.ts`.

- [ ] **Step 1: Migrar para o Expo Router e gerar o development build**

Run, em `apps/mobile`: `npx expo run:android`
Expected: o build termina, o app abre no emulador e a tela inicial mostra "API: online (alocidadao-api)", com `pnpm --filter @alocidadao/api dev` rodando.

- [ ] **Step 2: Conferir tipos e o diagnóstico do Expo**

Run: `pnpm --filter @alocidadao/mobile typecheck` e `npx expo-doctor` (em `apps/mobile`)
Expected: nenhum erro de tipo; o expo-doctor sem falhas.

- [ ] **Step 3: Commit** — "App com Expo Router e development build"

---

### Task 2: Id de instalação e contexto de conexão

**Files:**

- Create: `apps/mobile/vitest.config.ts` (`include: ['src/**/*.test.ts']`, ambiente `node`); script `"test": "vitest run"` e `vitest` em devDependencies de `apps/mobile/package.json`
- Create: `apps/mobile/src/lib/installation-id.ts`, `apps/mobile/src/lib/installation-id.test.ts`
- Create: `apps/mobile/src/lib/secure-store.ts` (adaptador de `expo-secure-store` para `KeyValueStore`)
- Create: `apps/mobile/src/lib/connection.ts`, `apps/mobile/src/lib/connection.test.ts`
- Create: `apps/mobile/src/app/laboratorio/rede.tsx`

**Interfaces:**

- Produces:
  - `interface KeyValueStore { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }`
  - `getInstallationId(store: KeyValueStore, newId?: () => string): Promise<string>`, com a chave `'installation-id'`; o padrão de `newId` é `randomUUID` de `expo-crypto`
  - `interface NetSnapshot { type: string; isConnected: boolean | null; cellularGeneration: string | null }`
  - `toConnectionContext(net: NetSnapshot, measures: { apiLatencyMs: number | null; uploadDurationMs: number | null; sentOffline: boolean }): ConnectionContext`
  - `measureApiLatency(ping: () => Promise<unknown>, now?: () => number): Promise<number | null>`
  - `readNetSnapshot(): Promise<NetSnapshot>`, que converte o `NetInfo.fetch()`; usado pelas tasks 7, 8 e 10

- [ ] **Step 1: Escrever os testes**

```ts
// installation-id.test.ts
it('creates the id once and reuses it', async () => {
  const store = memoryStore();
  const first = await getInstallationId(store, () => 'id-1');
  const second = await getInstallationId(store, () => 'id-2');
  expect([first, second]).toEqual(['id-1', 'id-1']);
});

// connection.test.ts
const m = { apiLatencyMs: 120, uploadDurationMs: null, sentOffline: false };
it('maps wifi', () =>
  expect(
    toConnectionContext({ type: 'wifi', isConnected: true, cellularGeneration: null }, m),
  ).toMatchObject({ networkType: 'wifi', cellularGeneration: null, apiLatencyMs: 120 }));
it('keeps the cellular generation', () =>
  expect(
    toConnectionContext({ type: 'cellular', isConnected: true, cellularGeneration: '4g' }, m)
      .cellularGeneration,
  ).toBe('4g'));
it('drops unknown generations', () =>
  expect(
    toConnectionContext({ type: 'cellular', isConnected: true, cellularGeneration: null }, m)
      .cellularGeneration,
  ).toBeNull());
it('maps other types to unknown', () =>
  expect(
    toConnectionContext({ type: 'bluetooth', isConnected: true, cellularGeneration: null }, m)
      .networkType,
  ).toBe('unknown'));
it('reports none when disconnected', () =>
  expect(
    toConnectionContext({ type: 'wifi', isConnected: false, cellularGeneration: null }, m)
      .networkType,
  ).toBe('none'));
it('measures latency and returns null on failure', async () => {
  const clock = [1000, 1180];
  expect(
    await measureApiLatency(
      async () => {},
      () => clock.shift()!,
    ),
  ).toBe(180);
  expect(
    await measureApiLatency(async () => {
      throw new Error('offline');
    }),
  ).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @alocidadao/mobile test`
Expected: FAIL (módulos não existem)

- [ ] **Step 3: Implementar `installation-id.ts`, `secure-store.ts` e `connection.ts`**

`toConnectionContext` valida a saída com `connectionContextSchema.parse`. `measureApiLatency` cronometra o `api.health()`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @alocidadao/mobile test`
Expected: PASS

- [ ] **Step 5: Tela `laboratorio/rede.tsx`**

A tela mostra o id de instalação, o tipo de rede, a geração móvel e a latência até a API, e se atualiza a cada mudança do `NetInfo`. Conferir no emulador: ligar e desligar o Wi-Fi e os dados do emulador e ver o tipo mudar.

- [ ] **Step 6: Commit** — "Id de instalação e contexto de conexão no app"

---

### Task 3: Câmera, localização e compressão de foto

**Files:**

- Modify: `packages/shared/src/schemas.ts`, com as constantes `PHOTO_MAX_SIDE_PX = 1600`, `PHOTO_TARGET_BYTES = 300_000`, `PHOTO_MAX_BYTES = 1_000_000` (limite rígido do servidor) e `MAX_PHOTOS_PER_COMPLETION = 3`
- Create: `apps/mobile/src/lib/photo.ts`, `apps/mobile/src/lib/photo.test.ts`
- Create: `apps/mobile/src/lib/location.ts`
- Create: `apps/mobile/src/app/laboratorio/camera.tsx`

**Interfaces:**

- Produces:
  - `fitWithin(width: number, height: number, maxSide?: number): { width: number; height: number }`, com o padrão `PHOTO_MAX_SIDE_PX`
  - `compressToTarget<T extends { bytes: number }>(render: (quality: number) => Promise<T>, qualities?: readonly number[], targetBytes?: number): Promise<T>`, com as qualidades padrão `[0.7, 0.6, 0.5, 0.4]`
  - `compressPhoto(uri: string): Promise<{ uri: string; width: number; height: number; bytes: number }>`, que usa `ImageManipulator` + `fitWithin` + `compressToTarget` e lê o tamanho com `new File(uri).size`
  - `getCurrentPoint(): Promise<{ point: GeoPoint; accuracyM: number | null } | { error: 'permission_denied' | 'unavailable' }>`, com timeout de 15 s
  - um componente `PhotoCapture` (em `camera.tsx`, exportado para a Task 8): `onCaptured(photo)` devolve o resultado de `compressPhoto`

- [ ] **Step 1: Escrever os testes**

```ts
it('fits landscape', () => expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 }));
it('fits portrait', () => expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 }));
it('keeps small photos', () => expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 }));
it('stops at the first quality under the target', async () => {
  const sizes: Record<number, number> = { 0.7: 420_000, 0.6: 290_000, 0.5: 200_000 };
  const calls: number[] = [];
  const r = await compressToTarget(
    async (q) => (calls.push(q), { bytes: sizes[q]! }),
    [0.7, 0.6, 0.5],
  );
  expect(r.bytes).toBe(290_000);
  expect(calls).toEqual([0.7, 0.6]);
});
it('returns the smallest attempt when none fits', async () => {
  const r = await compressToTarget(async (q) => ({ bytes: q * 1_000_000 }), [0.7, 0.4]);
  expect(r.bytes).toBe(400_000);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/mobile test` → FAIL
- [ ] **Step 3: Implementar `photo.ts` e `location.ts`**
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/mobile test` → PASS
- [ ] **Step 5: Tela `laboratorio/camera.tsx`**

A tela usa `CameraView` + `useCameraPermissions`, e as permissões são pedidas só ao tocar em "Tirar foto" e "Pegar localização". Ela mostra a foto, as dimensões e o tamanho antes e depois da compressão, e o ponto com a precisão.

Com a permissão negada, a tela mostra o motivo e o botão "Abrir configurações" (`Linking.openSettings()`), sem travar.

Conferir no emulador:

- uma foto da câmera virtual sai com o lado maior ≤ 1600 e cerca de 300 KB;
- uma localização definida em "Extended controls → Location" aparece na tela;
- negar a permissão mostra a explicação.

- [ ] **Step 6: Commit** — "Câmera, localização e compressão de foto"

---

### Task 4: Armazenamento de fotos (MinIO local + URL assinada)

**Files:**

- Modify: `docker-compose.yml`:
  - serviço `storage` (`minio/minio`, portas `9000:9000` e `9001:9001`, usuário e senha `alocidadao`/`alocidadao-dev`, volume `storage-data`, healthcheck em `/minio/health/live`);
  - serviço `storage-init` (`minio/mc`) que cria o bucket `alocidadao-dev` e termina.
- Modify: `package.json` (raiz), com o script `"infra:up": "docker compose up -d --wait db storage && docker compose run --rm storage-init"`
- Modify: `.github/workflows/ci.yml`, trocando o passo `pnpm db:up` por `pnpm infra:up`
- Create: `apps/api/src/storage/s3.ts`, `apps/api/src/storage/s3.test.ts`
- Create: `apps/api/src/dev/uploads.ts` (rota)
- Modify: `apps/api/src/app.ts` (opções `storage` e `devRoutes`) e `apps/api/src/server.ts` (lê `S3_*` e `NODE_ENV`)
- Modify: `apps/api/.env.example`, com `S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_ENDPOINT=http://10.0.2.2:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=alocidadao-dev`, `S3_ACCESS_KEY_ID=alocidadao` e `S3_SECRET_ACCESS_KEY=alocidadao-dev`

**Interfaces:**

- Produces:
  - `interface StorageConfig { endpoint: string; publicEndpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }` (sempre com `forcePathStyle: true`)
  - `interface Storage { presignUpload(key: string): Promise<{ url: string; headers: Record<string, string> }>; head(key: string): Promise<{ bytes: number; contentType: string } | null> }`
  - `createStorage(config: StorageConfig): Storage`. As URLs entregues ao aparelho são assinadas com `publicEndpoint`; as chamadas do servidor usam `endpoint`.
  - `newPhotoKey(tenantId: string, now?: Date): string` → `{tenantId}/uploads/{yyyy}/{mm}/{uuid}.jpg`
  - Rota `POST /dev/uploads` (cabeçalhos dev) → `{ key: string; url: string; headers: Record<string, string> }`. A URL vale 10 minutos e o `Content-Type` é `image/jpeg`.

- [ ] **Step 1: Escrever o teste de integração (exige `pnpm infra:up`)**

```ts
it('uploads through a presigned url and reads it back', async () => {
  const storage = createStorage(testStorageConfig); // endpoint e publicEndpoint = http://localhost:9000
  const key = newPhotoKey(TENANT_ID);
  const { url, headers } = await storage.presignUpload(key);
  const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(1234) });
  expect(res.ok).toBe(true);
  expect(await storage.head(key)).toEqual({ bytes: 1234, contentType: 'image/jpeg' });
});
it('returns null for a missing key', async () =>
  expect(await createStorage(testStorageConfig).head(`${TENANT_ID}/uploads/nada.jpg`)).toBeNull());
it('prefixes keys with the tenant', () =>
  expect(newPhotoKey(TENANT_ID, new Date('2026-10-22T12:00:00Z'))).toMatch(
    new RegExp(`^${TENANT_ID}/uploads/2026/10/[0-9a-f-]{36}\\.jpg$`),
  ));
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm infra:up && pnpm --filter @alocidadao/api test` → FAIL
- [ ] **Step 3: Implementar `s3.ts`, a rota e a configuração do servidor**
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/api test` → PASS
- [ ] **Step 5: Commit** — "Armazenamento de fotos com URL assinada (MinIO local)"

---

### Task 5: Registro de ações offline no banco e dados de demonstração

**Files:**

- Modify: `packages/db/src/schema.ts`, com a tabela `clientActions` (`client_actions`):
  - `id` uuid PK, gerado no aparelho;
  - `tenant_id`;
  - `user_id` (FK `users`);
  - `kind` text;
  - `target_id` uuid;
  - `response` jsonb not null;
  - `created_at`.
- Create: `packages/db/migrations/0003_client_actions.sql` (`pnpm db:generate` + o trecho de RLS escrito à mão: `ENABLE`/`FORCE`, a policy `tenant_isolation` e `GRANT SELECT, INSERT` para `app_user`, sem UPDATE nem DELETE)
- Create: `packages/db/src/client-actions.test.ts`
- Create: `packages/db/src/testing.ts`, exportado como `@alocidadao/db/testing` em `package.json` `exports`; `src/test/global-setup.ts` passa a usá-lo
- Create: `packages/db/src/seed-dev.ts` + script `"db:seed:dev": "tsx src/seed-dev.ts"` (e `pnpm db:seed:dev` na raiz)

**Interfaces:**

- Produces:
  - `schema.clientActions`
  - `resetTestDatabase(ownerUrl: string): Promise<void>`: cria o banco da URL se não existir (conectando ao banco `postgres`), recria o schema `public` e aplica as migrações
  - `seedDev(db: Database): Promise<{ tenantId: string; teamId: string; agentId: string; workOrderIds: string[] }>`. Ele é idempotente: se a prefeitura de IBGE `9999901` já existe, devolve os ids existentes. Cria:
    - "Prefeitura Demo A";
    - o setor Obras e a equipe "Equipe Obras – Centro";
    - o agente "Agente Demo" (`+5511900000001`) e o cidadão "Cidadão Demo";
    - a categoria "Buraco na via";
    - 3 solicitações a até 300 m de `{ lat: -23.5505, lng: -46.6333 }`, cada uma com uma atividade `assigned` para a equipe.

- [ ] **Step 1: Escrever os testes** (no padrão de `rls.test.ts`: o dono prepara, `app_user` executa)

```ts
it('rejects a repeated client action id', async () => {
  await insertAction(a, ACTION_ID);
  expect(await dbError(insertAction(a, ACTION_ID))).toMatch(/duplicate key/);
});
it('hides actions from another tenant', async () => {
  const rows = await withContext(app.db, { tenantId: b.tenantId }, (tx) =>
    tx.select().from(clientActions),
  );
  expect(rows).toHaveLength(0);
});
it('does not allow rewriting an action', async () =>
  expect(
    await dbError(
      withContext(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.update(clientActions).set({ response: {} }),
      ),
    ),
  ).toMatch(/permission denied/));
it('seeds the demo tenant once', async () => {
  const first = await seedDev(owner.db);
  const second = await seedDev(owner.db);
  expect(second).toEqual(first);
  expect(first.workOrderIds).toHaveLength(3);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/db test` → FAIL
- [ ] **Step 3: Implementar o schema, a migração, `testing.ts` e `seed-dev.ts`**, e rodar `pnpm --filter @alocidadao/db exec drizzle-kit check`
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/db test` → PASS (os 15 testes atuais continuam passando)
- [ ] **Step 5: Commit** — "Registro de ações offline e dados de demonstração"

---

### Task 6: API das atividades para o spike offline

**Files:**

- Modify: `packages/shared/src/schemas.ts`, com `workOrderActionInputSchema` e `workOrderActionResultSchema`
- Create: `apps/api/src/dev/identity.ts` (lê e valida `x-dev-user-id` e `x-dev-tenant-id`; sem eles, responde 401 `{ code: 'dev_identity_required' }`)
- Create: `apps/api/src/dev/work-orders.ts`, `apps/api/src/dev/work-orders.test.ts`
- Create: `apps/api/vitest.config.ts`, com `globalSetup` chamando `resetTestDatabase` em `postgres://alocidadao:alocidadao@localhost:5433/alocidadao_api_test` (banco separado do pacote `db`, para os dois rodarem em paralelo no Turborepo)
- Modify: `apps/api/src/app.ts` (opção `database: Database`), `apps/api/src/server.ts` (`DATABASE_URL`), `apps/api/package.json` (dependência `@alocidadao/db`)

**Interfaces:**

- Consumes: `withContext`, `schema.clientActions`/`workOrders`/`statusEvents`, `seedDev` (Task 5); `Storage.head`, `newPhotoKey` (Task 4); `canTransitionWorkOrder` (shared)
- Produces:
  - `workOrderActionInputSchema = z.object({ clientActionId: z.uuid(), action: z.enum(['start', 'complete']), occurredAt: z.iso.datetime(), note: z.string().trim().min(3).max(2000).optional(), photoKeys: z.array(z.string().min(1)).max(MAX_PHOTOS_PER_COMPLETION), connection: connectionContextSchema })`. Em `complete`, `note` e pelo menos 1 foto são obrigatórios (`superRefine`); em `start`, `photoKeys` vazio.
  - `workOrderActionResultSchema = z.object({ workOrderId: z.uuid(), status: workOrderStatusSchema, duplicate: z.boolean() })`
  - `GET /dev/work-orders` → atividades `assigned`/`in_execution` das equipes da pessoa: `{ id, status, protocol, description, categoryName, address, location: { lat, lng }, dueAt }[]`
  - `POST /dev/work-orders/:id/actions` → 200 com o resultado. Também:
    - 409 `{ code: 'work_order_unavailable', status }`;
    - 422 `{ code: 'photo_invalid', key }`;
    - 404 quando a atividade não existe na prefeitura.
  - `POST /dev/work-orders/:id/cancel` → 200; simula a reatribuição pelo gestor

Regra: tudo numa transação `withContext({ tenantId, userId })`.

1. Se o `clientActionId` já existe em `client_actions`, devolve o `response` gravado com `duplicate: true`.
2. Se a transição não é permitida, responde 409.
3. Em `complete`, cada chave precisa começar com `{tenantId}/` e existir no armazenamento com no máximo `PHOTO_MAX_BYTES`; senão, 422.
4. Atualiza a atividade (`start` → `in_execution`; `complete` → `completed`, `completion_note` e `completed_at = occurredAt`).
5. Insere um `status_events` com `connection`.
6. Grava `client_actions` com o `response`.

- [ ] **Step 1: Escrever os testes** (`app.inject`, banco real e MinIO real)

```ts
it('starts and completes a work order', async () => {
  await act(wo[0], start());
  const res = await act(wo[0], complete({ photoKeys: [await uploadPhoto()] }));
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ status: 'completed', duplicate: false });
});
it('replays a duplicate clientActionId', async () => {
  const action = start();
  await act(wo[1], action);
  const again = await act(wo[1], action);
  expect(again.json()).toMatchObject({ status: 'in_execution', duplicate: true });
  expect(await countStatusEvents(wo[1])).toBe(1);
});
it('refuses actions on a cancelled work order', async () => {
  await inject('POST', `/dev/work-orders/${wo[2]}/cancel`);
  const res = await act(wo[2], start());
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ code: 'work_order_unavailable', status: 'cancelled' });
});
it('rejects photo keys that are missing, foreign or too large', async () => {
  for (const key of [
    `${tenantId}/uploads/nada.jpg`,
    await uploadPhoto({ tenantId: otherTenantId }),
    await uploadPhoto({ bytes: 1_000_001 }),
  ]) {
    const res = await act(freshWorkOrder(), complete({ photoKeys: [key] }));
    expect(res.statusCode).toBe(422);
  }
});
it('hides work orders of another tenant', async () =>
  expect((await act(otherTenantWorkOrder, start())).statusCode).toBe(404));
it('lists only active work orders of the agent teams', async () => {
  const list = (await inject('GET', '/dev/work-orders')).json();
  expect(
    list.every((w: { status: string }) => ['assigned', 'in_execution'].includes(w.status)),
  ).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/api test` → FAIL
- [ ] **Step 3: Implementar os schemas, a identidade dev e as rotas**
- [ ] **Step 4: Rodar e ver passar** — `pnpm turbo run test` → PASS, com `db` e `api` em paralelo
- [ ] **Step 5: Commit** — "API das atividades com ações idempotentes (spike offline)"

---

### Task 7: Fila offline do app (núcleo testável)

**Files:**

- Create: `apps/mobile/src/offline/outbox.ts`, `apps/mobile/src/offline/outbox.test.ts`
- Create: `apps/mobile/src/offline/single-flight.ts`, `apps/mobile/src/offline/single-flight.test.ts`
- Create: `apps/mobile/src/offline/sqlite-outbox-store.ts`. É o `OutboxStore` sobre `expo-sqlite`, com a tabela `outbox`. As fotos são copiadas para `Paths.document/outbox/<id>/`, e a pasta é apagada quando o item fica `done`.
- Create: `apps/mobile/src/offline/http-transport.ts`. É o `Transport` real: `POST /dev/uploads` + `PUT` com `new File(path)` como corpo, e `POST /dev/work-orders/:id/actions`. Falha de rede ou timeout vira `NetworkError`; arquivo inexistente vira `PhotoMissingError`.

**Interfaces:**

- Consumes: `toConnectionContext`, `readNetSnapshot`, `measureApiLatency` (Task 2); `WorkOrderActionInput` (Task 6)
- Produces:
  - `type OutboxStatus = 'pending' | 'sending' | 'done' | 'conflict' | 'failed'`
  - `interface OutboxItem { id: string; workOrderId: string; action: 'start' | 'complete'; occurredAt: string; note: string | null; photoPaths: string[]; photoKeys: (string | null)[]; createdOffline: boolean; status: OutboxStatus; attempts: number; nextAttemptAt: number; lastError: string | null; createdAt: number }`
  - `interface OutboxStore { add(item: OutboxItem): Promise<void>; listDue(now: number): Promise<OutboxItem[]>; update(id: string, patch: Partial<OutboxItem>): Promise<void>; resetInFlight(): Promise<void>; list(): Promise<OutboxItem[]> }`. `listDue` devolve os itens `pending` com `nextAttemptAt <= now`, em ordem de `createdAt`.
  - `interface Transport { uploadPhoto(path: string): Promise<{ key: string; durationMs: number }>; sendAction(workOrderId: string, input: WorkOrderActionInput): Promise<{ kind: 'ok' } | { kind: 'conflict'; status: string } | { kind: 'rejected'; code: string }> }`
  - `class NetworkError extends Error`, `class PhotoMissingError extends Error`
  - `backoffMs(attempts: number): number`: `min(5_000 * 2 ** (attempts - 1), 300_000)`
  - `processOutbox(deps: { store: OutboxStore; transport: Transport; connection: (m: { uploadDurationMs: number | null; sentOffline: boolean }) => Promise<ConnectionContext>; now?: () => number }): Promise<{ sent: number; conflicts: number; failed: number; stoppedByNetwork: boolean }>`
  - `createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T>`: chamadas simultâneas compartilham a mesma execução
  - `enqueueWorkOrderAction(store: OutboxStore, input: { workOrderId: string; action: 'start' | 'complete'; note?: string; photoUris?: string[]; online: boolean }): Promise<OutboxItem>`: gera o `id` com `randomUUID` e guarda as fotos

Regras de `processOutbox`:

1. Chama `resetInFlight()` primeiro e processa os itens um por vez.
2. Marca `sending` e envia as fotos ainda sem chave, gravando cada chave no store assim que ela volta.
3. Envia a ação. Com `ok`, marca `done`; com `conflict`, marca `conflict` e segue para o próximo.
4. `rejected` ou `PhotoMissingError` vira `failed` e segue, com `lastError` = o código.
5. Um `NetworkError` volta o item para `pending` com `attempts + 1` e `nextAttemptAt = now + backoffMs(attempts + 1)`, e **para** a execução.

- [ ] **Step 1: Escrever os testes** (store em memória + transport falso)

```ts
it('sends due items in creation order', async () => {
  /* 3 itens → sent 3, ordem de sendAction = ordem de createdAt */
});
it('resumes without re-uploading photos', async () => {
  transport.failNextSendWith(new NetworkError('timeout'));
  await processOutbox(deps);
  expect(await store.get(item.id)).toMatchObject({ status: 'pending', photoKeys: ['k1'] });
  clock.advance(backoffMs(1));
  await processOutbox(deps);
  expect(transport.uploads).toEqual([item.photoPaths[0]]); // um upload só
  expect((await store.get(item.id)).status).toBe('done');
});
it('marks conflicts and keeps going', async () => {
  /* item 1 conflict, item 2 ok → conflicts 1, sent 1 */
});
it('stops at the first network error', async () => {
  /* item 1 NetworkError → item 2 nem é tentado */
});
it('backs off after a network error', async () => {
  transport.failNextSendWith(new NetworkError('offline'));
  await processOutbox(deps);
  expect((await processOutbox(deps)).sent).toBe(0); // ainda não venceu o prazo
  expect(backoffMs(1)).toBe(5_000);
  expect(backoffMs(10)).toBe(300_000);
});
it('resets items left in flight', async () => {
  await store.update(item.id, { status: 'sending' });
  expect((await processOutbox(deps)).sent).toBe(1);
});
it('fails an item whose photo file is gone', async () => {
  /* PhotoMissingError → failed, lastError 'photo_missing' */
});
it('flags actions created offline', async () => {
  /* createdOffline true → connection chamado com sentOffline true */
});
it('shares one run between concurrent calls', async () => {
  let runs = 0;
  const run = createSingleFlight(async () => {
    runs++;
    await tick();
  });
  await Promise.all([run(), run(), run()]);
  expect(runs).toBe(1);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/mobile test` → FAIL
- [ ] **Step 3: Implementar `outbox.ts` e `single-flight.ts`**, depois `sqlite-outbox-store.ts` e `http-transport.ts`
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/mobile test` e `pnpm --filter @alocidadao/mobile typecheck` → PASS
- [ ] **Step 5: Commit** — "Fila offline de ações do agente"

---

### Task 8: Tela de atividades offline e teste do modo avião

**Files:**

- Create: `apps/mobile/src/offline/work-order-cache.ts`. É uma tabela `work_orders_cache` no mesmo banco SQLite, com `replaceAll(list)`, `list()` e `setLocalStatus(id, status)`.
- Create: `apps/mobile/src/offline/use-outbox-sync.ts`. O hook dispara `processOutbox` (via single-flight):
  - quando o `NetInfo` passa a `isConnected === true` e `isInternetReachable !== false`;
  - quando o app volta ao primeiro plano (`AppState` `active`);
  - quando a pessoa toca em "Sincronizar agora".

  Ele expõe `{ items, syncing, syncNow }`.

- Create: `apps/mobile/src/app/laboratorio/offline.tsx`
- Modify: `apps/mobile/.env.example`, acrescentando as linhas `EXPO_PUBLIC_DEV_USER_ID` e `EXPO_PUBLIC_DEV_TENANT_ID` (os ids impressos pelo `pnpm db:seed:dev`)

**Interfaces:**

- Consumes: `GET /dev/work-orders` (Task 6); `enqueueWorkOrderAction`, `processOutbox`, `createSingleFlight`, `SqliteOutboxStore`, `HttpTransport` (Task 7); `PhotoCapture` (Task 3)

A tela:

- lista as atividades do cache e, com rede, atualiza pelo `GET /dev/work-orders`;
- tem os botões "Iniciar" e "Concluir". Concluir pede de 1 a 3 fotos e o relato; a ação entra na fila e o status local muda na hora;
- mostra a fila com o status de cada item;
- num item em conflito, mostra o texto **"Esta atividade foi reatribuída ou cancelada pela prefeitura. O que você registrou ficou guardado no aparelho."**

- [ ] **Step 1: Implementar o cache, o hook e a tela**
- [ ] **Step 2: Conferir tipos e testes** — `pnpm --filter @alocidadao/mobile typecheck test` → PASS
- [ ] **Step 3: Rodar o roteiro de aceite no emulador** (critério do planejamento: "agente conclui 3 atividades com foto em modo avião e reconecta")

1. `pnpm infra:up && pnpm db:migrate && pnpm db:seed:dev`. Copiar os ids para `apps/mobile/.env` e subir a API (`pnpm --filter @alocidadao/api dev`).
2. Abrir o Laboratório → Atividades offline com rede e ver as 3 atividades.
3. Ativar o modo avião no emulador. Iniciar e concluir as 3 atividades, cada uma com 1 a 3 fotos e relato.
4. Ainda offline, cancelar uma delas pelo terminal: `curl -X POST http://localhost:3333/dev/work-orders/<id>/cancel -H 'x-dev-user-id: <agente>' -H 'x-dev-tenant-id: <prefeitura>'`
5. Desativar o modo avião.

Expected:

- a fila esvazia sozinha;
- 2 atividades ficam `completed`; a cancelada aparece como conflito, com o aviso acima;
- no banco, `select kind, count(*) from client_actions group by kind` dá `start` 2 e `complete` 2. Os inícios recusados pelo conflito não geram registro;
- cada atividade concluída tem exatamente 2 linhas em `status_events`, com `connection->>'sentOffline' = 'true'`;
- as fotos estão no bucket (console do MinIO em `http://localhost:9001`).

Repetir o passo 5 fechando o app à força no meio do envio: ao reabrir, a fila termina sem duplicar.

- [ ] **Step 4: Commit** — "Tela de atividades offline (spike)"

---

### Task 9: Envio de push direto (FCM e APNs) na API

**Files:**

- Create: `apps/api/src/push/types.ts`, `apps/api/src/push/message.ts`, `apps/api/src/push/message.test.ts`
- Create: `apps/api/src/push/fcm.ts`, `apps/api/src/push/fcm.test.ts`
- Create: `apps/api/src/push/apns.ts`, `apps/api/src/push/apns.test.ts`
- Create: `apps/api/src/dev/push.ts` (rota)
- Modify: `apps/api/src/server.ts` (monta os envios só quando as variáveis existem), `apps/api/.env.example`:
  - `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_FILE=./secrets/firebase-service-account.json`
  - `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_FILE=./secrets/apns.p8`, `APNS_PRODUCTION=false`
- Modify: `.gitignore` (`secrets/`, `*.p8`, `google-services.json`, `GoogleService-Info.plist`)

**Interfaces:**

- Produces:
  - `interface PushMessage { title: string; body: string; data: Record<string, string> }`
  - `type PushResult = { kind: 'sent' } | { kind: 'invalid_token' } | { kind: 'retry'; reason: string }`
  - `interface PushSender { send(token: string, message: PushMessage): Promise<PushResult> }`
  - `statusPushMessage(protocol: string, status: RequestStatus): PushMessage` → título `'Alô Cidadão'`, corpo `` `Solicitação ${protocol}: ${REQUEST_STATUS_LABELS[status]}` `` e `data: { protocol, status }`
  - `createFcmSender(opts: { projectId: string; getAccessToken: () => Promise<string>; fetch?: typeof fetch }): PushSender`. Faz `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send` com `message: { token, notification: { title, body }, data, android: { priority: 'high', notification: { channel_id: 'status' } } }`. O token de acesso vem de `GoogleAuth` (google-auth-library), escopo `https://www.googleapis.com/auth/firebase.messaging`.
  - `createApnsSender(opts: { teamId: string; keyId: string; privateKeyPem: string; bundleId: string; production: boolean; request?: Http2Request; now?: () => number }): PushSender`. Usa HTTP/2 (`node:http2`) em `api.sandbox.push.apple.com` (ou `api.push.apple.com` em produção), no caminho `/3/device/{token}`. Cabeçalhos:
    - `authorization: bearer <JWT ES256 com kid e iss, refeito a cada 50 min>`
    - `apns-topic: br.com.alocidadao.app`
    - `apns-push-type: alert`
    - `apns-priority: 10`

    Corpo: `{ aps: { alert: { title, body }, sound: 'default' }, ...data }`. JWT via `jose`.

  - `type Http2Request = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; body: string }>`
  - Rota `POST /dev/push` `{ platform: 'android' | 'ios', token: string, protocol: string, status: RequestStatus }` → o `PushResult`; 503 `{ code: 'push_not_configured' }` sem o envio daquela plataforma

Mapeamento de respostas:

- **FCM:** 200 → `sent`; 404 ou `UNREGISTERED` → `invalid_token`; 400 `INVALID_ARGUMENT` citando o token → `invalid_token`; 429 e 5xx → `retry`.
- **APNs:** 200 → `sent`; 410, ou 400 com `BadDeviceToken`/`Unregistered` → `invalid_token`; 429 e 5xx → `retry`.

- [ ] **Step 1: Escrever os testes**

```ts
it('carries only protocol and status', () => {
  const m = statusPushMessage('2026-000123', 'in_progress');
  expect(m).toEqual({
    title: 'Alô Cidadão',
    body: 'Solicitação 2026-000123: Em atendimento',
    data: { protocol: '2026-000123', status: 'in_progress' },
  });
});
it('fcm: sends the v1 request', async () => {
  /* fetch falso: URL com projectId, Authorization Bearer, body.message.token, channel_id 'status' */
});
it.each([
  [404, 'UNREGISTERED', 'invalid_token'],
  [503, 'UNAVAILABLE', 'retry'],
  [200, null, 'sent'],
])('fcm: maps %i %s to %s', async (status, code, kind) => {
  /* … */
});
it('apns: signs an ES256 token with kid and team', async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  /* request falso captura authorization; decodeProtectedHeader → { alg: 'ES256', kid: KEY_ID }; payload.iss = TEAM_ID */
});
it('apns: uses the sandbox host and topic', async () => {
  /* url começa com https://api.sandbox.push.apple.com/3/device/ ; apns-topic br.com.alocidadao.app */
});
it.each([
  [410, 'Unregistered', 'invalid_token'],
  [400, 'BadDeviceToken', 'invalid_token'],
  [429, 'TooManyRequests', 'retry'],
])('apns: maps %i %s to %s', async () => {
  /* … */
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @alocidadao/api test` → FAIL
- [ ] **Step 3: Implementar `message.ts`, `fcm.ts`, `apns.ts`, a rota e a configuração**
- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @alocidadao/api test` → PASS
- [ ] **Step 5: Commit** — "Envio direto de push por FCM e APNs"

---

### Task 10: Registro do aparelho para push e teste no Android

**Pré-requisitos (feitos pelo Gabriel no console, sem segredo no git):**

- criar o projeto Firebase "alocidadao";
- adicionar o app Android `br.com.alocidadao.app` e baixar o `google-services.json` para `apps/mobile/`;
- gerar a conta de serviço (Firebase Admin) em `apps/api/secrets/firebase-service-account.json`;
- usar um emulador com imagem **Google Play**.

**Files:**

- Create: `apps/mobile/app.config.ts`. Estende o `app.json`, adiciona o plugin `expo-notifications` e define `android.googleServicesFile` como `process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'`, só quando o arquivo existe. Sem o arquivo, o build continua funcionando, só que sem push.
- Create: `apps/mobile/src/lib/push.ts`
- Create: `apps/mobile/src/app/laboratorio/notificacoes.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`, chamando `Notifications.setNotificationHandler` para mostrar o push com o app aberto

**Interfaces:**

- Consumes: `POST /dev/push` (Task 9)
- Produces: `registerForPush(): Promise<{ platform: 'android' | 'ios'; token: string } | { error: 'permission_denied' | 'unsupported' }>`. No Android, cria o canal `'status'` ("Andamento das solicitações", importância alta) **antes** de pedir a permissão. Depois chama `requestPermissionsAsync` e `getDevicePushTokenAsync`. Num simulador sem suporte, responde `unsupported`.

- [ ] **Step 1: Implementar `push.ts`, a tela e a configuração**

A tela mostra o token e tem o botão "Enviar teste", que chama `/dev/push` com o protocolo `2026-000123` e o status "em atendimento". Ela também tem "Enviar em 10 s", para dar tempo de pôr o app em segundo plano ou fechá-lo. Com a permissão negada, mostra a explicação e "Abrir configurações".

- [ ] **Step 2: Gerar o build de novo e conferir tipos** — `npx expo run:android` (o plugin muda o nativo) e `pnpm --filter @alocidadao/mobile typecheck` → sem erros
- [ ] **Step 3: Roteiro de aceite no emulador Android**

Expected: o push "Solicitação 2026-000123: Em atendimento" chega:

- com o app aberto;
- com o app em segundo plano;
- com o app fechado (removido dos recentes).

Um token inventado na rota devolve `{ kind: 'invalid_token' }`.

- [ ] **Step 4: Commit** — "Registro de push no app e teste no Android"

- [ ] **Step 5 (bloqueado até a conta Apple Developer):** criar a chave APNs (`.p8`) em `apps/api/secrets/apns.p8`, com `APNS_TEAM_ID`/`APNS_KEY_ID` no `.env`. Rodar `npx expo run:ios --device` num iPhone e repetir os três cenários do passo 3.

---

### Task 11: Aparelhos reais e registro dos resultados

**Files:**

- Create: `docs/decisoes/0002-recursos-nativos-offline-e-push.md`
- Modify: `docs/planejamento-mvp.md`. Marca os spikes concluídos no checklist e acrescenta a lista "Próximos planos" (abaixo).

- [ ] **Step 1: Repetir no Android real** (`npx expo run:android --device`, com `EXPO_PUBLIC_API_URL` e `S3_PUBLIC_ENDPOINT` apontando para o IP do Mac): os passos de aceite das tasks 3, 8 e 10, em Wi-Fi e em dados móveis.
- [ ] **Step 2: Repetir no iPhone** (`npx expo run:ios --device`), as tasks 3 e 8. A Task 10 depende da conta Apple.
- [ ] **Step 3: Escrever a decisão 0002**, no formato da 0001:
  - o que foi testado e em quais aparelhos;
  - os números medidos: tamanho médio da foto comprimida, tempo de envio por foto em Wi-Fi e em 4G, latência média da API;
  - o que falhou ou exigiu ajuste;
  - a conclusão: a arquitetura do planejamento se mantém ou o que muda.
- [ ] **Step 4: Commit** — "Resultado dos spikes de recursos nativos, offline e push"

## Próximos planos (um de cada vez, depois deste)

1. **Modelo de dados do design:** as migrações da seção 9 do spec (ocorrências, atividade nova, usuários sem senha, prefeitura com status, contrato, papéis internos, auditoria) e as transições novas no `shared`.
2. **Acesso:** código por celular no app, CPF + código por e-mail (Resend, `nao-responda@alocidadao.com.br`) no painel, sessões, `devices` e a regra dos 90 dias.
3. **App do cidadão:** telas 0 a 8, prefeitura pela localização, agrupamento pela 5b e registro offline, reaproveitando a fila da Task 7.
4. **App do agente:** telas A1 a A5, sobre a fila e o cache deste plano.
5. **Painel da prefeitura:** W0 a W7, com mapa, triagem, agrupamento, atribuição, revisão e configurações.
6. **Backoffice:** P1 a P6.
7. **Notificações:** fila de envio, caixa de entrada, e-mails e conclusão automática em 7 dias.
8. **Infraestrutura:** Droplet e Spaces na DigitalOcean, backups, observabilidade e publicação nas lojas.
