# App do agente — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agente de campo usa o mesmo app com as telas A1 a A5 do Pencil. Ele:

- vê as atividades das suas equipes em lista ou mapa, pela distância, com o selo "Nova";
- abre o detalhe com instruções do gestor, rota, fotos e relatos dos cidadãos;
- inicia, conclui com fotos e relato, ou relata impedimento, com ou sem rede;
- atende ao ajuste pedido pelo gestor;
- troca entre os modos agente e cidadão.

**Architecture:**

- **API:** rotas `/agent/*` (audiência `app`, prefeitura pelo cabeçalho `x-tenant-id`, vínculo `field_agent` conferido a cada chamada) substituem `/dev/work-orders` e `/dev/uploads`. O agente só vê atividades das equipes de que é membro. Ações idempotentes por `clientActionId`, como no Plano 3.
- **Banco:** `photos.purpose` separa fotos do relato, da contestação, da conclusão e do impedimento. Sem outras mudanças estruturais: `impediment_reason`, `manager_instructions` e `status_events.details` já existem.
- **App:** um modo por vez (agente ou cidadão), lembrado no aparelho. O modo agente tem grupo de rotas próprio com duas abas (Atividades e Perfil). As atividades de todas as prefeituras do agente ficam num cache SQLite com o detalhe, para abrir e agir sem rede. A fila offline passa a levar a prefeitura em cada item.
- **Simulação do gestor:** até o painel (Plano 5), rotas `/dev` pedem ajuste, reagendam e cancelam, para testar no emulador.

**Tech Stack:** o mesmo do Plano 3 (TypeScript ~6.0.3, Zod 4, Drizzle 0.45, PostgreSQL 17 + PostGIS, Fastify 5, Expo SDK 58 com Expo Router, `expo-sqlite`, `expo-camera`, `expo-location`, `@maplibre/maplibre-react-native` com OpenFreeMap, `lucide-react-native`, Vitest).

**Spec:**

- `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md`, seções 3.3, 6.2, 7 e 8.
- Telas: `docs/superpowers/specs/2026-10-24-telas-agente-pencil.md` (capturas em `docs/superpowers/specs/telas-agente/`), extraída de `design/alocidadao.pen`, que é a referência visual. Os componentes do cidadão estão em `docs/superpowers/specs/2026-10-23-telas-cidadao-pencil.md`.
- Ver também `docs/design-system.md`, `docs/decisoes/0002-recursos-nativos-offline-e-push.md` e a seção "Plano 4" de `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`.

## Decisões deste plano (o spec e o Pencil deixam em aberto)

Decididas com o usuário em 24/10/2026:

- **Iniciar atendimento existe.** Na A2, com a atividade "Atribuída", o botão primário é `Iniciar atendimento` (ícone `play`); depois de iniciar, vira `Concluir atendimento`. "Não consigo resolver" aparece nos dois.
- **Modo Mapa da A1 entra agora**, com MapLibre: pinos com a cor do grupo da categoria, o agente no mapa, tocar no pino mostra o cartão da atividade (tocar no cartão abre o detalhe). Sem rede: `O mapa precisa de internet.`
- **Troca de modo pela pílula e pelo Perfil.** A pílula do topo é tocável: no agente mostra `Agente` (`hard-hat`) e troca para cidadão; no cidadão, só para quem tem vínculo de agente, mostra `Cidadão` (`user`) e troca para agente. No Perfil, a linha `Usar o app como cidadão` ou `Usar o app como agente`. O app lembra o último modo; quem tem vínculo de agente começa no modo agente.
- **Depois de concluir ou relatar impedimento, a atividade fica na lista**, no fim, com o selo "Aguardando revisão" ou "Impedida" e detalhe só de leitura. Sai quando concluída ou cancelada.

Decididas neste plano:

- **O que o agente vê:** atividades com status `assigned`, `in_execution`, `rework_requested`, `awaiting_review` e `impeded` das equipes de que é membro, em todas as prefeituras de `me.agentTenants`.
- **Ordem da A1:** primeiro as que pedem ação (`assigned`, `in_execution`, `rework_requested`) pela distância ao aparelho (sem localização: pelo prazo e, empatando, pela atribuição mais antiga); depois as só de leitura, da mudança mais recente para a mais antiga.
- **Selo "Nova":** atividade "Atribuída" que o agente ainda não abriu neste aparelho. "Aberta" = chave `{id}:{assignedAt}` gravada no SQLite ao abrir o detalhe; reagendar muda `assignedAt` e a atividade volta a ser nova.
- **Selos de status do agente** (sem ícone, como no Pencil): Atribuída `border`/`text-secondary`; Em execução `primary-soft`/`primary`; Ajuste pedido `warning-soft`/`warning`; Aguardando revisão `success-soft`/`success`; Impedida `danger-soft`/`danger`. Rótulos de `WORK_ORDER_STATUS_LABELS`.
- **Tempo do cartão:** `Chegou {há}` (nova), `Atribuída {há}`, `Iniciada {há}`, `Devolvido {há}`, `Enviada {há}` (aguardando revisão e impedida), onde `{há}` é `agora`, `há N min`, `há N h` ou `há N dias`. Com envio na fila: `Aguardando envio`.
- **Distância:** `350 m` abaixo de 1 km; `1,2 km` com uma casa e vírgula. Na A2: `A 350 m de você`. Sem localização, a distância some.
- **Local na conclusão:** o app lê a posição ao abrir a A3. Até `AGENT_NEAR_SITE_M = 100` m da ocorrência: faixa `success-soft` `Você está no local da ocorrência (a 8 m)`. Mais longe: faixa `warning-soft`, ícone `map-pin-x`, `Você está a 1,2 km do local da ocorrência. Pode concluir assim mesmo.` Sem posição: faixa `warning-soft`, ícone `map-pin-off`, `Não foi possível confirmar sua localização. Pode concluir assim mesmo.` Lendo: `Confirmando sua localização…`. Nunca bloqueia. A API guarda posição e distância no `details` do evento.
- **Impedimento:** motivos fixos `missing_material` "Falta material ou equipamento" (`package-x`), `inaccessible` "Local inacessível" (`ban`), `needs_other_team` "Precisa de outra equipe" (`users`), `not_municipal` "Não é da prefeitura" (`landmark`), `other` "Outro motivo" (`circle-ellipsis`). Detalhes obrigatórios (3 a 1000), até 1 foto. `work_orders.impediment_reason` guarda o código; o evento guarda os detalhes em `comment` e `{ reason, location, distanceM }` em `details`.
- **Ajuste pedido (contrato que o painel do Plano 5 vai usar):** o evento para `rework_requested` guarda a mensagem em `comment` e `{ reasons, discardedPhotoIds }` em `details`, com `reasons` entre `new_photos`, `new_note`, `return_to_site`. Título do cartão da A5: `Gestor pediu novas fotos`, `Gestor pediu um novo relato`, `Gestor pediu para voltar ao local`; mais de um motivo: `Gestor pediu ajustes`. Botão primário da A5: `Enviar novas fotos` (`camera`) quando `new_photos` está entre os motivos; senão `Concluir atendimento`. A A3 do reenvio vem com o relato anterior preenchido e começa sem fotos; as fotos não descartadas continuam na atividade.
- **Cartão do gestor (A2):** autor `{nome} (Gestor de {setor}) · prazo: {23 out}`. `{nome}` é quem atribuiu (evento para `assigned` mais recente); `{setor}` é o setor da equipe. Sem prazo, sem `· prazo: …`; sem autor conhecido, só `prazo: 23 out`. Sem instruções, o texto é `Sem instruções do gestor.` em `text-secondary`. Na A5: `{nome} (Gestor de {setor}) · devolvido {há}`.
- **Atividade só de leitura** (aguardando revisão, impedida): sem rodapé; no topo, linha `info` + `Enviado ao gestor. Aguardando a revisão.` ou `Impedimento enviado. Aguardando a decisão do gestor.`
- **Textos que o Pencil não tem:**
  - Cabeçalho do detalhe: `Ocorrência {protocolo} · {n} relatos` (`1 relato`).
  - Relatos: `Sem observação` quando o relato não tem texto; link `Ver os {n} relatos` quando há mais de 3; tela `Relatos dos cidadãos` com todos.
  - A1 resumo: `{n} atividades · ordenadas pela distância` (`1 atividade`); sem localização, `… · ordenadas pelo prazo`.
  - A1 vazia: título `Nenhuma atividade agora`; texto `Quando o gestor atribuir uma atividade à sua equipe, ela aparece aqui.`
  - A1 sem cache e sem rede ou com erro: `Não foi possível carregar as atividades.` e botão `Tentar de novo`.
  - Faixa offline: `Sem conexão · {n} envios aguardando sinal`, `Sem conexão · 1 envio aguardando sinal`, ou `Sem conexão` com a fila vazia. Online, a faixa some.
  - Envio recusado pelo servidor (conflito, atividade de outra equipe, vínculo encerrado): aviso no topo da A1, `danger-soft`, `{Categoria} · {endereço}: o gestor mudou esta atividade e seu envio não foi aplicado.`, botão `Remover envio`.
  - Vínculo encerrado: o app volta ao modo cidadão e mostra uma vez `Seu acesso como agente foi encerrado pela prefeitura.`
  - A3: remover foto (`x` sobre a miniatura, `Remover foto {i}`); informação com 1 cidadão: `O gestor revisa as fotos e o relato antes de enviar ao cidadão que relatou.`
  - Fechar A3/A4 com algo preenchido: título `Descartar o que você preencheu?`, botões `Descartar` e `Continuar editando`.
- **Envio:** iniciar, concluir e impedimento sempre passam pela fila (com ou sem rede) e a fila é acionada em seguida; a tela volta à A1 com o status otimista.
- **Abrir rota:** Android `geo:0,0?q={lat},{lng}({endereço})` (o sistema oferece os apps de mapa); iOS `http://maps.apple.com/?daddr={lat},{lng}`.
- **Barra de abas do agente:** `Atividades` (`clipboard-list`) e `Perfil` (`user`), distribuídas por igual, sem o vão do botão central.
- **Várias prefeituras ou equipes:** a lista junta todas. O cabeçalho mostra o nome da equipe quando é uma só; com várias, `{n} equipes`.
- **Laboratório:** saem as telas `laboratorio/offline` e `laboratorio/entrar` e a chave `LAB_TENANT_KEY` (o modo agente as substitui). Ficam rede, câmera e notificações.
- **Fotos sem rede:** as URLs assinadas do detalhe vencem; sem rede, a foto que não carrega mostra o fundo da pilha com o ícone `image-off`.
- Push de nova atividade e de ajuste pedido fica para o Plano 7.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. No app, instalar dependências com `npx expo install` (ver `apps/mobile/AGENTS.md`). Nunca editar `android/` ou `ios/` à mão.
- **Nomes e textos:**
  - Identificadores em inglês.
  - Comentários e mensagens em português.
  - Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
  - Textos das telas copiados do Pencil (`telas-agente-pencil.md`) ou da seção de decisões acima, sem mudar uma vírgula.
- **Isolamento (decisão 0001):**
  - A API conecta como `app_user`.
  - Toda leitura e escrita de dados da prefeitura passa por `withContext` com a prefeitura do cabeçalho, depois de `requireTenantMember(..., ['field_agent'])`.
  - O agente só lê e age sobre atividades de equipes em que está em `team_members`; fora disso, 404 `work_order_not_found`.
- **Migrações:** não editar 0000–0017. Estruturais com `drizzle-kit generate`; funções, RLS e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Toda rota `/agent/*` declara schema de resposta (sucesso e erros).
- **O agente nunca vê:** nome, telefone ou e-mail de cidadãos; fotos de conclusão de outras atividades.
- **Visual (Pencil):** tokens de `theme.ts`; títulos Lexend 600, texto Source Sans 3; ícones Lucide; alvos de toque de pelo menos 44; todo ícone tocável com `accessibilityLabel`; respeitar a escala de fonte sem cortar texto. Cores literais novas do Pencil (`#78350F`) entram em `theme.ts` com nome (`warningStrong`).
- **Limites:** `MAX_PHOTOS_PER_COMPLETION = 3` (já existe); `MAX_PHOTOS_PER_IMPEDIMENT = 1`; `AGENT_NEAR_SITE_M = 100`.
- **Commits:** mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa. Hermes não tem `Array.prototype.toSorted`.
- Entre as Tasks 1 e 5, `pnpm typecheck` na raiz pode falhar em `apps/mobile` (o contrato da ação muda). A Task 5 devolve a raiz ao verde.

## Review Focus

1. **Ação offline sobre atividade que mudou:** o gestor cancelou, reatribuiu a outra equipe ou pediu ajuste enquanto o agente estava sem rede. O envio fica como recusado com o aviso da A1, sem tentar para sempre, e as fotos guardadas são apagadas ao remover. Testes `action on a work order of another team is 404` e `complete on a cancelled work order is 409 work_order_unavailable` (Task 4); `conflicting agent action shows the notice and removal deletes its photos` (Task 6).
2. **Mesma ação reenviada:** reenviar a mesma conclusão (mesmo `clientActionId`) não duplica fotos nem eventos; a mesma chave de foto em outra conclusão responde 409 `photo_already_used`. Testes `resending the same clientActionId returns the first result` e `photo key used by another completion is 409 photo_already_used` (Task 4).
3. **Agente de outra equipe ou prefeitura:** listar, ver ou agir sobre atividade de equipe da qual não é membro responde 404; prefeitura sem vínculo `field_agent` ativo, 403 `not_a_member`. Testes `list shows only my teams' work orders` e `detail of another team's work order is 404` (Task 3).
4. **O detalhe do agente não vaza dados de cidadãos:** sem nome, telefone ou e-mail; só fotos das solicitações (relato e contestação) daquela ocorrência. Teste `detail exposes reports and photos without citizen identity` (Task 3).
5. **Vínculo encerrado com envios na fila:** o app volta ao modo cidadão com o aviso, e os envios daquela prefeitura viram recusados em vez de travar a fila. Testes `403 not_a_member rejects the item instead of retrying` (Task 5) e `losing the agent role switches to citizen mode with the notice` (Task 7).

---

### Task 1: Contratos do agente no `shared`

**Files:**

- Create: `packages/shared/src/agent.ts`, `packages/shared/src/agent.test.ts`
- Modify: `packages/shared/src/schemas.ts` (ação da atividade), `packages/shared/src/schemas.test.ts`, `packages/shared/src/enums.ts` (propósito da foto), `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: `geoPointSchema`, `distanceMeters` (`geo.ts`); `photoViewSchema`, `uploadResponseSchema` (`citizen.ts`); `workOrderStatusSchema`; `categoryOptionSchema` (ícone e grupo).
- Produces:
  - `PHOTO_PURPOSES = ['report', 'contest', 'completion', 'impediment']`, `photoPurposeSchema` em `enums.ts`.
  - `IMPEDIMENT_REASONS = ['missing_material', 'inaccessible', 'needs_other_team', 'not_municipal', 'other']`, `impedimentReasonSchema`, `IMPEDIMENT_REASON_LABELS` (textos das decisões).
  - `REWORK_REASONS = ['new_photos', 'new_note', 'return_to_site']`, `reworkReasonSchema`, `reworkDetailsSchema = { reasons: ReworkReason[] (min 1), discardedPhotoIds: uuid[] }`.
  - `MAX_PHOTOS_PER_IMPEDIMENT = 1`, `AGENT_NEAR_SITE_M = 100`.
  - `deviceLocationSchema = geoPointSchema.extend({ accuracyM: z.number().nonnegative().nullable() })`.
  - `workOrderActionInputSchema` passa a aceitar `action: 'start' | 'complete' | 'report_impediment'`, mais `location: deviceLocationSchema.nullable()` (padrão `null`) e `impedimentReason?: ImpedimentReason`. Regras: `complete` exige `note` e 1 a 3 fotos; `report_impediment` exige `impedimentReason`, `note` (3 a 1000) e no máximo 1 foto; `start` não leva fotos, nota nem motivo.
  - `agentWorkOrderCardSchema = { id, tenantId, status, protocol, categoryName, categoryIcon, categoryGroup, address: string | null, location: GeoPoint, teamName, reportCount: int, dueAt: datetime | null, assignedAt: datetime, statusChangedAt: datetime }`.
  - `agentWorkOrderDetailSchema = agentWorkOrderCardSchema.extend({ managerInstructions: string | null, assignedBy: { name, departmentName } | null, reports: { description: string, createdAt: datetime }[], photos: PhotoView[], citizenCount: int, rework: { reasons: ReworkReason[], message: string, byName: string | null, departmentName: string | null, at: datetime } | null, previousNote: string | null })`.
  - `devManagerActionBodySchema = discriminatedUnion('action', [{ action: 'request_rework', reasons, message (3..1000), discardedPhotoIds }, { action: 'reschedule', dueAt: datetime | null }])`.

- [ ] **Step 1: Write the failing tests** em `agent.test.ts` e `schemas.test.ts`:
  - `report_impediment requires a reason, a note and at most one photo`;
  - `start rejects photos, note and reason`;
  - `complete keeps requiring a note and one to three photos`;
  - `location defaults to null and accepts accuracy`;
  - `rework details require at least one reason`;
  - `agent detail parses a card with rework and no assigner`;
  - `dev manager action rejects a short rework message`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/shared test` e `pnpm --filter @alocidadao/shared typecheck` → PASS.
- [ ] **Step 5:** Commit: `Contratos do agente: impedimento, ajuste pedido e atividade`.

---

### Task 2: Propósito das fotos e dados de exemplo do agente

**Files:**

- Create: `packages/db/migrations/0018_*.sql` (gerada) e a migração de preenchimento, se o `generate` não cobrir.
- Modify: `packages/db/src/schema.ts` (`photos.purpose`), `packages/db/src/seed-dev.ts`, `packages/db/src/seed-dev-data.ts`, testes de `photos` e do seed em `packages/db/src/`.

**Interfaces:**

- Consumes: `PHOTO_PURPOSES` (Task 1).
- Produces:
  - `photos.purpose` (`photo_purpose` enum, NOT NULL). Preenche as linhas existentes: `requestId` → `report`, `workOrderId` → `completion`. `CHECK`: `report`/`contest` só com `request_id`; `completion`/`impediment` só com `work_order_id`.
  - Seed de desenvolvimento (idempotente), além do que já existe:
    - um gestor com nome (`Carlos Demo`, o gestor CPF `52998224725`) que atribuiu as atividades: evento `status_events` para `assigned` com `actor_user_id` dele em cada atividade;
    - instruções do gestor e prazo nas três atividades de exemplo (a primeira com o texto do Pencil: `Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h.`);
    - uma quarta atividade em `rework_requested`, com o evento de devolução (`comment` com o texto do Pencil `As fotos 2 e 3 ficaram escuras e não mostram o buraco tapado. Tire uma de perto e uma de longe, com a rua aparecendo.`, `details` `{ reasons: ['new_photos'], discardedPhotoIds: [] }`) e `agent_note` anterior;
    - uma ocorrência com 3 solicitações de cidadãos diferentes (para "relatos" e contagem).

- [ ] **Step 1: Write the failing tests:**
  - `foto de solicitação não pode ter propósito de conclusão`;
  - `foto de atividade não pode ter propósito de relato`;
  - `migração preenche o propósito das fotos existentes`;
  - `seed cria atividade com ajuste pedido e autor da atribuição`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3:** Implementar (`drizzle-kit generate`; preenchimento e `CHECK` em SQL próprio se preciso). Ajustar os pontos que inserem fotos: `apps/api/src/citizen/*` grava `report` na criação e `contest` na contestação; as ações do agente gravam na Task 4. O detalhe do cidadão passa a filtrar as fotos da conclusão também por `purpose = 'completion'`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test`, `pnpm --filter @alocidadao/api test` e `pnpm typecheck` nesses pacotes → PASS. Rodar `pnpm db:migrate` e `pnpm db:seed:dev` no banco local.
- [ ] **Step 5:** Commit: `Propósito das fotos e atividades de exemplo do agente`.

---

### Task 3: Lista, detalhe e envio de foto do agente na API

**Files:**

- Create: `apps/api/src/agent/routes.ts`, `apps/api/src/agent/work-orders.ts` (lista e detalhe), `apps/api/src/agent/work-orders.test.ts`
- Modify: `apps/api/src/app.ts` (escopo `/agent`, ao lado do cidadão), `apps/api/src/dev/*` (sai lista e upload)

**Interfaces:**

- Consumes: `requireAuth(['app'])`, `requireTenantMember(db, request, reply, ['field_agent'])` (`auth/tenant-context.ts`), `withContext`, `storage.presignUpload`, `storage.presignGet`, `newPhotoKey(tenantId)`; schemas da Task 1; `apiErrorSchema`.
- Produces:
  - `registerAgentRoutes(instance, { db, storage })`.
  - **`GET /agent/work-orders`** → `agentWorkOrderCardSchema[]`, só equipes do agente e os 5 status das decisões. `protocol` = protocolo da primeira solicitação da ocorrência; `reportCount` = solicitações não canceladas; `assignedAt` = evento para `assigned` mais recente (ou `created_at`); `statusChangedAt` = último evento da atividade.
  - **`GET /agent/work-orders/:id`** → `agentWorkOrderDetailSchema`. `reports` em ordem de criação (todas as solicitações não canceladas, texto vazio como `''`); `photos` = fotos `report` e `contest` dessas solicitações, URLs assinadas; `citizenCount` = solicitações ativas; `rework` só em `rework_requested`, do último evento para esse status; `previousNote` = `agent_note`.
  - **`POST /agent/uploads`** → `uploadResponseSchema` (chave `newPhotoKey(tenantId)`).
  - Respostas de erro: 400 `tenant_required`, 401, 403 `not_a_member`, 404 `work_order_not_found`, 503 `database_not_configured`/`storage_not_configured`.
  - Saem `GET /dev/work-orders` e `POST /dev/uploads` (e os testes deles migram para cá).

- [ ] **Step 1: Write the failing tests** em `work-orders.test.ts`:
  - `list shows only my teams' work orders` (outra equipe da mesma prefeitura não aparece);
  - `list hides completed and cancelled work orders`;
  - `list card has category icon, report count and assignedAt`;
  - `detail of another team's work order is 404`;
  - `detail exposes reports and photos without citizen identity` (sem `name`, `phone`, `email` em nenhum nível do JSON; nenhuma foto de conclusão);
  - `detail shows rework with reasons, message and author`;
  - `detail without instructions has null assignedBy when nobody assigned`;
  - `agent of another tenant gets 403 not_a_member`;
  - `upload returns a key under the tenant prefix`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- agent` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `typecheck` → PASS.
- [ ] **Step 5:** Commit: `API do agente: lista, detalhe e envio de foto`.

---

### Task 4: Ações do agente e simulação do gestor na API

**Files:**

- Create: `apps/api/src/agent/actions.ts`, `apps/api/src/agent/actions.test.ts`, `apps/api/src/dev/manager-actions.ts`, `apps/api/src/dev/manager-actions.test.ts`
- Modify: `apps/api/src/agent/routes.ts`, `apps/api/src/dev/work-orders.ts` (sai a rota de ações; fica `POST /dev/work-orders/:id/cancel`)

**Interfaces:**

- Consumes: `applyAction` atual de `apps/api/src/dev/work-orders.ts` (mover, não copiar), `applyWorkOrderAction`, `isUniqueViolation`/`violatedConstraint` (`db-errors.ts`), Task 1 e Task 2.
- Produces:
  - **`POST /agent/work-orders/:id/actions`** (`workOrderActionInputSchema`) → `workOrderActionResultSchema`.
    - Ordem: replay por `clientActionId` (como hoje) → fotos (prefixo da prefeitura, `head`, tamanho e tipo) → trava a atividade → membro da equipe (senão 404) → `applyWorkOrderAction(..., 'field_agent')` (senão 409 `work_order_unavailable { status }`) → grava.
    - `complete`: `agent_note`, `completed_at`, fotos `completion` com `review = 'pending'`.
    - `report_impediment`: `impediment_reason` = código; foto `impediment` com `review = 'pending'`.
    - Evento: `comment` = nota; `details` = `{ location, distanceM }` (distância de `location` até a ocorrência, `null` sem local) e `reason` no impedimento.
    - Chave de foto já usada: 409 `photo_already_used` (23505 em `photos.storage_key`), separado de `client_action_conflict`.
  - **`POST /dev/work-orders/:id/manager`** (`devManagerActionBodySchema`), só com rotas de desenvolvimento: `request_rework` (de `awaiting_review`; marca `review = 'discarded'` nas fotos de `discardedPhotoIds`; evento com `comment` e `details` das decisões) e `reschedule` (de `impeded` para `assigned`, novo `due_at`, evento para `assigned`). Ator: o gestor da prefeitura (primeiro `manager` ativo; teste usa o do seed).

- [ ] **Step 1: Write the failing tests:**
  - `start then complete moves to awaiting_review with note and photos`;
  - `complete records distance to the occurrence in the event details`;
  - `report_impediment stores the reason code, the note and one photo`;
  - `report_impediment from rework_requested is allowed`;
  - `complete on a cancelled work order is 409 work_order_unavailable`;
  - `action on a work order of another team is 404`;
  - `resending the same clientActionId returns the first result` (sem fotos nem eventos a mais);
  - `photo key used by another completion is 409 photo_already_used`;
  - `dev request_rework discards the chosen photos and records reasons`;
  - `dev reschedule brings an impeded work order back to assigned`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test -- actions manager` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `typecheck` → PASS.
- [ ] **Step 5:** Commit: `API do agente: iniciar, concluir, impedimento e simulação do gestor`.

---

### Task 5: Cliente da API e fila do agente no app

**Files:**

- Modify: `packages/api-client/src/index.ts` (+ teste), `apps/mobile/src/offline/outbox.ts`, `outbox.test.ts`, `outbox-schema.ts`, `outbox-schema.test.ts`, `http-transport.ts`, `http-mapping.ts`, `http-mapping.test.ts`, `sqlite-outbox-store.ts`, `outbox-service.ts`, `apps/mobile/src/auth/native-session.ts`
- Delete: `apps/mobile/src/app/laboratorio/offline.tsx`, `apps/mobile/src/app/laboratorio/entrar.tsx` (e o link no índice do Laboratório)

**Interfaces:**

- Consumes: rotas das Tasks 3 e 4; schemas da Task 1.
- Produces:
  - `api-client`: `RequestOptions` ganha `tenantId?: string` (cabeçalho `x-tenant-id`); métodos `agentWorkOrders(tenantId)`, `agentWorkOrder(tenantId, id)`, `agentUpload(tenantId)`, todos validando a resposta com os schemas.
  - `WorkOrderActionPayload = { tenantId, workOrderId, action: 'start' | 'complete' | 'report_impediment', occurredAt, note: string | null, impedimentReason: ImpedimentReason | null, location: DeviceLocation | null }`. Itens antigos sem `tenantId` (fila da versão 1, do Laboratório) são migrados para `rejected` com código `missing_tenant` na versão 2 do esquema (`PRAGMA user_version` 2).
  - `enqueueWorkOrderAction(deps, { tenantId, workOrderId, action, note?, impedimentReason?, location?, photoUris?, online, userId })`: recusa mais fotos que o limite da ação; `occurredAt` e `createdAt` vêm do mesmo `now()`.
  - `HttpTransport`: caminhos `/agent/*`; `x-tenant-id` vem do item (`payload.tenantId`), não mais da chave do Laboratório; `uploadPhoto(path, kind, tenantId)`.
  - `mapActionResponse`: 404 `work_order_not_found` e 403 `not_a_member` → `rejected` (sem nova tentativa); 409 `photo_already_used` → `rejected`.
  - Correções da lista de pendências do Plano 4: `openAppDatabase` não guarda a promessa rejeitada (nova tentativa na próxima chamada); `dir.delete` com erro não interrompe a passada (registra e segue); a pasta de fotos de item `conflict`/`failed`/`rejected` é apagada ao remover o item (`removeOutboxItem`).
  - Sai `LAB_TENANT_KEY` (e a leitura dela em `createSessionTransport` e no `session-context`).

- [ ] **Step 1: Write the failing tests:**
  - `agent requests send the tenant header` (api-client);
  - `agent work order list rejects an invalid response` (api-client);
  - `enqueue rejects a second impediment photo`;
  - `enqueue uses one clock for occurredAt and createdAt`;
  - `v1 work order items without tenant become rejected on migration`;
  - `403 not_a_member rejects the item instead of retrying`;
  - `404 work_order_not_found rejects the item`;
  - `failing photo folder delete does not stop the pass`;
  - `removing a rejected item deletes its stashed photos`;
  - `openAppDatabase retries after a failed open`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api-client test` e `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** testes dos dois pacotes, `pnpm typecheck` e `pnpm lint` na raiz → PASS.
- [ ] **Step 5:** Commit: `Fila do agente com prefeitura por item e rotas reais`.

---

### Task 6: Cache das atividades e modelo da lista

**Files:**

- Create: `apps/mobile/src/agent/work-order-store.ts` (SQLite), `apps/mobile/src/agent/agent-view.ts`, `apps/mobile/src/agent/agent-view.test.ts`, `apps/mobile/src/agent/use-agent-work-orders.ts`
- Delete: `apps/mobile/src/offline/work-order-cache.ts` (tabela antiga apagada na versão 2 do esquema)
- Modify: `apps/mobile/src/ui/format.ts` (+ teste), `apps/mobile/src/offline/outbox-schema.ts`

**Interfaces:**

- Consumes: Task 5 (`agentWorkOrders`, `agentWorkOrder`, fila), `distanceMeters`, `WORK_ORDER_STATUS_LABELS`, `getCurrentPoint`.
- Produces:
  - Tabela `agent_work_orders (id PK, tenant_id, card_json, detail_json NULL, updated_at)` e `agent_seen (key PK)`; `AgentWorkOrderStore` com `replaceTenant(tenantId, cards)`, `list()`, `saveDetail(detail)`, `detail(id)`, `markSeen(id, assignedAt)`, `seenKeys()`. `clearOfflineData` apaga as duas.
  - `formatAgoPrecise(since, now)` → `'agora' | 'há N min' | 'há N h' | 'há N dias'` (1 → `há 1 dia`); `formatDistance(m)` → `'350 m' | '1,2 km'`.
  - `agent-view.ts` (puro):
    - `toAgentList({ cards, queue, seen, here, now })` → `{ summary: string, items: AgentCardView[], notices: AgentQueueNotice[] }`, com a ordem, o selo "Nova", o status otimista dos envios na fila (`start` → `in_execution`, `complete` → `awaiting_review`, `report_impediment` → `impeded`), `Aguardando envio`, distância e textos das decisões.
    - `AgentCardView = { id, tenantId, categoryName, categoryIcon, categoryGroup, address, distance: string | null, badge: { label, tone }, isNew, reportsLabel, timeLabel, location }`.
    - `offlineBanner(online, pendingCount)` → `string | null`.
    - `teamHeader(cards)` → nome da equipe ou `{n} equipes`.
  - `useAgentWorkOrders()`: lê o cache na hora, atualiza de todas as prefeituras de `me.agentTenants` quando online (e depois de cada passada da fila com envio), baixa o detalhe de cada atividade para o cache, e devolve `{ list, refreshing, error, refresh, online }`. Em 403 `not_a_member`, chama `refreshMe`.

- [ ] **Step 1: Write the failing tests** em `agent-view.test.ts` e `format.test.ts`:
  - `actionable work orders come first, by distance`;
  - `without location the list is ordered by due date and says so`;
  - `read-only work orders go last, newest change first`;
  - `assigned work order not seen is new, rescheduled one is new again`;
  - `queued start shows in execution and waiting to send`;
  - `conflicting agent action shows the notice and removal deletes its photos` (aviso com o texto das decisões; a remoção chama `removeOutboxItem`);
  - `offline banner counts pending sends with singular and plural`;
  - `team header names one team or counts several`;
  - `formatAgoPrecise covers minutes, hours and days`;
  - `formatDistance uses meters below 1 km and a comma above`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Cache das atividades do agente e modelo da lista`.

---

### Task 7: Modo agente e troca de modo

**Files:**

- Create: `apps/mobile/src/auth/app-mode.ts`, `apps/mobile/src/auth/app-mode.test.ts`, `apps/mobile/src/ui/ModePill.tsx`, `apps/mobile/src/app/(app)/agente/_layout.tsx`, `apps/mobile/src/app/(app)/agente/(tabs)/_layout.tsx`, `apps/mobile/src/app/(app)/agente/(tabs)/atividades.tsx` (casca; a A1 vem na Task 8), `apps/mobile/src/app/(app)/agente/(tabs)/perfil.tsx`
- Modify: `apps/mobile/src/auth/session-context.tsx`, `apps/mobile/src/auth/login-flow.ts` (`HOME_ROUTE` por modo), `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/solicitacoes.tsx` (pílula e aviso), `apps/mobile/src/app/(app)/(tabs)/perfil.tsx` (linha de troca; o conteúdo vira um componente usado pelas duas abas), `apps/mobile/src/ui/TabBar.tsx` (variante de duas abas)

**Interfaces:**

- Consumes: `me.agentTenants` (`/me`), `secure-store`.
- Produces:
  - `type AppMode = 'agent' | 'citizen'`; `resolveMode(me, stored: AppMode | null) → AppMode` (sem vínculo → `citizen`; com vínculo → `stored ?? 'agent'`); `homeFor(mode)` → `/(app)/agente/(tabs)/atividades` ou `/(app)/(tabs)/solicitacoes`.
  - No contexto da sessão: `mode`, `setMode(mode)` (grava em `app-mode` no secure-store e navega para `homeFor`), `isAgent`. `app-mode` não é apagado ao sair: `resolveMode` já ignora o modo agente para quem não tem vínculo.
  - Ao atualizar `me` sem `agentTenants` estando no modo agente: muda para cidadão e mostra uma vez o aviso de vínculo encerrado.
  - `ModePill({ mode, onPress? })`: os dois visuais das decisões; sem `onPress`, não é tocável.
  - `TabBar` com `variant: 'citizen' | 'agent'`.

- [ ] **Step 1: Write the failing tests** em `app-mode.test.ts`:
  - `citizen without agent role is always citizen`;
  - `agent starts in agent mode and keeps the last mode`;
  - `losing the agent role switches to citizen mode with the notice`;
  - `home route follows the mode`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador: entrar com o agente do seed (`+5511900000001`) cai no modo agente; a pílula troca para cidadão e volta; o Perfil troca também; o cidadão do seed não vê pílula.
- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5:** Commit: `Modo agente, pílula e troca pelo Perfil`.

---

### Task 8: A1 Minhas atividades (lista e mapa)

**Files:**

- Create: `apps/mobile/src/ui/agent/WorkOrderCard.tsx`, `apps/mobile/src/ui/agent/OfflineBanner.tsx`, `apps/mobile/src/ui/agent/SegmentedControl.tsx`, `apps/mobile/src/ui/agent/WorkOrderMap.tsx`
- Modify: `apps/mobile/src/app/(app)/agente/(tabs)/atividades.tsx`, `apps/mobile/src/ui/theme.ts` (`warningStrong: '#78350F'`)

**Interfaces:**

- Consumes: `useAgentWorkOrders`, `toAgentList`, `offlineBanner`, `teamHeader` (Task 6); `ModePill` (Task 7); `CategoryIcon`; MapLibre como em `(app)/ajustar-local.tsx`.
- Produces: tela A1 conforme a seção A1 da extração, com:
  - faixa offline, cabeçalho com equipe, título e pílula, seletor `Lista`/`Mapa`, resumo, cartões;
  - avisos de envio recusado com `Remover envio`;
  - vazia, carregando, erro com `Tentar de novo`, puxar para atualizar;
  - mapa com pinos por grupo, o agente no mapa, cartão do pino e texto offline;
  - toque no cartão → `/(app)/agente/atividade/{id}`.

- [ ] **Step 1:** Implementar. Conferir no emulador com o seed:
  - lista ordenada pela distância (GPS do emulador em -23.5505, -46.6333), selo "Nova" na atribuída não aberta, cartão "Ajuste pedido";
  - modo avião: faixa `Sem conexão`, lista vinda do cache;
  - mapa com os pinos e o cartão ao tocar.

  Comparar com `docs/superpowers/specs/telas-agente/A1-minhas-atividades.png`.

- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 3:** Commit: `A1: minhas atividades em lista e mapa`.

---

### Task 9: A2 e A5 Detalhe da atividade e iniciar atendimento

**Files:**

- Create: `apps/mobile/src/agent/detail-view.ts`, `apps/mobile/src/agent/detail-view.test.ts`, `apps/mobile/src/app/(app)/agente/atividade/[id].tsx`, `apps/mobile/src/app/(app)/agente/atividade/[id]/relatos.tsx`, `apps/mobile/src/ui/agent/ManagerCard.tsx`, `apps/mobile/src/ui/agent/LocationCard.tsx`, `apps/mobile/src/ui/agent/ReportList.tsx`, `apps/mobile/src/lib/open-route.ts`

**Interfaces:**

- Consumes: `AgentWorkOrderStore.detail`/`markSeen`, `agentWorkOrder` (Task 5/6), `enqueueWorkOrderAction` + `syncOutbox`, `PhotoStack` e a galeria do Plano 3 (`/(app)/galeria` com fotos e índice por parâmetro), `actionLock` (`lib/action-lock.ts`).
- Produces:
  - `toAgentDetail(detail, { here, queue, now })` (puro) → `{ title, subtitle, manager: { tone: 'instructions' | 'rework', title, text, author } , location: { address, distance }, photos, reports: { shown (até 3), moreLabel: string | null }, footer: 'start' | 'complete' | 'rework' | null, readOnlyNote: string | null }`, com os textos das decisões.
  - `openRoute(location, address)` (Android `geo:`; iOS Apple Maps).
  - Tela A2/A5: abre do cache (sem rede também), atualiza quando online, marca como vista; `Iniciar atendimento` enfileira `start` com trava contra toque duplo; `Concluir atendimento`/`Enviar novas fotos` → `/(app)/agente/atividade/{id}/concluir`; `Não consigo resolver` → `/(app)/agente/atividade/{id}/impedimento`.

- [ ] **Step 1: Write the failing tests** em `detail-view.test.ts`:
  - `assigned shows instructions and the start footer`;
  - `in execution shows the complete footer`;
  - `rework shows the reason title, message, author and resend footer`;
  - `several rework reasons use the generic title`;
  - `missing instructions say so and keep the due date`;
  - `awaiting review and impeded are read-only with their note`;
  - `reports show three, an empty one as Sem observação, and the more link`;
  - `queued start makes the footer complete`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador: A2 da atividade com instruções, galeria, `Ver os 3 relatos`, `Abrir rota no mapa`, `Iniciar atendimento` com e sem rede; A5 da atividade com ajuste. Comparar com `A2-detalhe-da-atividade.png` e `A5-ajuste-pedido.png`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5:** Commit: `A2 e A5: detalhe da atividade, rota e iniciar atendimento`.

---

### Task 10: A3 Concluir atendimento e A4 Não consigo resolver

**Files:**

- Create: `apps/mobile/src/agent/finish-form.ts`, `apps/mobile/src/agent/finish-form.test.ts`, `apps/mobile/src/app/(app)/agente/atividade/[id]/concluir.tsx`, `apps/mobile/src/app/(app)/agente/atividade/[id]/impedimento.tsx`, `apps/mobile/src/ui/agent/PhotoThumbs.tsx`, `apps/mobile/src/ui/agent/LocationBand.tsx`, `apps/mobile/src/ui/agent/ReasonOption.tsx`
- Modify: `apps/mobile/src/components/photo-capture.tsx`, `apps/mobile/src/lib/photo-native.ts`, `apps/mobile/src/lib/location.ts`, `apps/mobile/app.config.ts` (textos de permissão do iOS)

**Interfaces:**

- Consumes: `enqueueWorkOrderAction` + `syncOutbox` (Task 5), `toAgentDetail` dados do cache (Task 9), `PhotoCapture`, `getCurrentPoint`, `ConfirmDialog`, `actionLock`.
- Produces:
  - `finish-form.ts` (puro): `locationBand(here: DeviceLocation | null | 'reading', site: GeoPoint)` → `{ tone: 'success' | 'warning' | 'neutral', icon, text }`; `canSendCompletion({ photos, note })` (1 a 3 fotos, nota de 3+); `canSendImpediment({ reason, note, photos })` (motivo, nota de 3+, até 1 foto); `infoText(citizenCount)`; `hasDraft(form)`.
  - A3 conforme a extração e as decisões: contador `obrigatório · {n} de 3`, miniaturas com remover, `Tirar foto` some com 3, faixa de local, relato (preenchido com `previousNote` no reenvio), rodapé com o aviso offline; envia `complete` com `location` e volta à A1.
  - A4: motivos (escolha única, selecionado com `circle-check`), detalhes, uma foto opcional, informação, `Enviar ao gestor` em `warning`; envia `report_impediment` e volta à A1.
  - Fechar com rascunho → diálogo `Descartar o que você preencheu?`.
  - Correções de câmera da lista de pendências: a foto é decodificada uma vez; foto acima de `PHOTO_MAX_BYTES` depois da última qualidade é recusada com `A foto ficou grande demais. Tire outra.`; os JPEGs intermediários são apagados; o temporizador da localização é limpo; a tela nunca mostra mensagem técnica (`Não foi possível usar a câmera. Tente de novo.`).
  - `app.config.ts`: sem texto de microfone e sem localização "sempre" no iOS (`expo-camera` com `recordAudioAndroid: false` e sem `microphonePermission`; `expo-location` só com o texto de uso em primeiro plano).

- [ ] **Step 1: Write the failing tests** em `finish-form.test.ts` (e nos testes de `photo.ts`, se a regra de tamanho for pura):
  - `near the site shows success with the distance`;
  - `far from the site warns without blocking`;
  - `unknown location warns without blocking`;
  - `completion needs one to three photos and a note`;
  - `impediment needs a reason and a note and allows one photo`;
  - `info text uses singular for one citizen`;
  - `photo still too big after the last quality is refused`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/mobile test` → FAIL.
- [ ] **Step 3:** Implementar. Conferir no emulador:
  - concluir com 2 fotos online; concluir em modo avião e reconectar (a fila envia e a atividade fica "Aguardando revisão");
  - relatar impedimento sem foto e com foto;
  - pedir ajuste pela rota `/dev/work-orders/:id/manager` e reenviar pela A5 com o relato preenchido;
  - cancelar uma atividade pela rota `/dev` com envio na fila e ver o aviso `Remover envio`;
  - reagendar uma impedida e ver o selo "Nova" de novo.

  Comparar com `A3-concluir-atendimento.png` e `A4-nao-consigo-resolver.png`.

- [ ] **Step 4:** `pnpm --filter @alocidadao/mobile test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5:** Commit: `A3 e A4: concluir atendimento e relatar impedimento`.

---

### Task 11: Design system, pendências e passada final no emulador

**Files:**

- Modify: `docs/design-system.md`, `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`, `docs/planejamento-mvp.md`, `docs/decisoes/0002-recursos-nativos-offline-e-push.md`, este plano (seção "Resultado no emulador")

- [ ] **Step 1:** Em `docs/design-system.md`: registrar os componentes novos do agente (faixa offline, pílula de modo, controle segmentado, cartão de atividade, cartão do gestor azul e âmbar, opção de motivo, botão primário em `warning`, faixa de local), a cor `warningStrong` `#78350F`, o peso 700 do selo "Nova", o selo de status sem ícone no agente e a sombra da barra de abas como exceção permitida.
- [ ] **Step 2:** Em `spikes-pendencias.md`: marcar `[x]` os itens do Plano 4 resolvidos (rotas reais com schema de resposta, chave de foto já usada, fotos e pastas órfãs, versão do esquema e `openAppDatabase`, máximo de fotos e relógio único, câmera, textos do iOS, status que o agente vê, login do Laboratório). Os que ficarem abertos passam para o Plano 8, com "(veio do Plano 4)". Acrescentar no Plano 5: o painel grava o ajuste pedido no formato `reworkDetailsSchema` e usa `POST /dev/work-orders/:id/manager` como referência; mostrar a distância da conclusão na revisão (W3). Acrescentar no Plano 7: push de nova atividade e de ajuste pedido para os agentes da equipe.
- [ ] **Step 3:** Em `planejamento-mvp.md`, marcar o Plano 4 como feito. Em `0002`, registrar que o fluxo offline do agente saiu do Laboratório para o modo agente.
- [ ] **Step 4:** Passada final no emulador, do zero (desinstalar o app, `pnpm db:seed:dev`):
  - entrar com o agente do seed → modo agente → A1 com as atividades;
  - abrir a nova (o selo some), iniciar, concluir com 2 fotos;
  - em modo avião, relatar impedimento com foto; reconectar;
  - atender ao ajuste pedido;
  - trocar para cidadão pela pílula, registrar uma solicitação, voltar para agente pelo Perfil;
  - sair → entrar de novo: volta no último modo.

  Registrar o resultado neste plano, numa seção "Resultado no emulador" no fim, com data e o que falhou.

- [ ] **Step 5:** `pnpm format:check` → PASS. Commit: `Design system e pendências após o app do agente`.
