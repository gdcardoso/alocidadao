# Pendências herdadas dos spikes de risco

Itens menores achados nas revisões dos spikes (`2026-10-22-spikes-de-risco.md`), que não bloqueiam o uso atual mas devem entrar no plano indicado. Cada plano do MVP começa conferindo esta lista.

## Antes de tudo (não são código)

- Testes em aparelho real (Android e iPhone), entrega real de push (FCM e APNs) e foto de câmera real: roteiros em `docs/decisoes/0002-recursos-nativos-offline-e-push.md`. O plano de notificações depende da entrega real ter funcionado.

## Plano 1 — Modelo de dados

- [x] Teste do `WITH CHECK` de `client_actions` (inserir com `tenant_id` de outra prefeitura); teste "esconde ações de outra prefeitura" depende da ordem.
- [x] `seedDev`: checagem de existência fora da transação; exige superusuário.
- [x] `/dev/*` no modelo novo: a lista de atividades declara `workOrderSummarySchema` como resposta; cancelamento idempotente.
- [x] Testes que faltam: `completedAt` = `occurredAt`, `comment` = relato, contagem exata de eventos, 503 sem armazenamento, tipo de arquivo errado; ramo 23505 sem teste próprio.
- [x] `storage.head` roda com a linha travada; `head()` sem teste do erro repassado; `test-fixtures.ts` vai para o `dist`.
- [ ] Variáveis de ambiente da API validadas na subida (hoje as chaves S3 caem em `''`) — Task 6 do plano 2026-10-23.
- [ ] A API não lê `.env` — Task 6 do plano 2026-10-23.
- [ ] Fechar o pool do banco no desligamento da API — Task 6 do plano 2026-10-23.

## Plano 2 — Acesso

- `client_actions`: amarrar `user_id = app_current_user()` na política quando houver login real.
- `getInstallationId`: duas primeiras chamadas simultâneas podem gerar ids diferentes (entra no trabalho de `devices`).
- Identidade por cabeçalho `x-dev-*` some com o login real.

## Plano 3 — App do cidadão

- `src/lib/api.ts` usa `10.0.2.2` como padrão (só vale no emulador Android): trocar por configuração de build.
- Título repetido no cabeçalho.

## Plano 4 — App do agente

- Rotas reais substituem `/dev/*`: schema de resposta em todas as rotas (hoje só a lista de atividades declara o seu).
- Chave de foto já usada em outra conclusão responde 409 `client_action_conflict`: o 23505 de `photos.storage_key` cai no mesmo ramo do id de ação repetido.
- `useOutboxSync` está só na tela do Laboratório: mover para o layout raiz.
- 408 e 429 no envio de foto viram falha definitiva: tratar como nova tentativa.
- Foto de conclusão recusada por conflito fica órfã no armazenamento; pastas de itens em conflito ou falha não são apagadas; `dir.delete` com erro interrompe a passada.
- Tempo limite de 30 s também no envio da foto (3G fraco); corpo da resposta lido sem tempo limite.
- Banco SQLite sem versão de esquema; `openAppDatabase` guarda a promessa rejeitada.
- Máximo de 3 fotos não é imposto em `enqueueWorkOrderAction`; `occurredAt` e `createdAt` vêm de chamadas diferentes de `now()`.
- Página de login de Wi-Fi público com 200 no envio da foto passa (o servidor recusa depois com 422).
- Estado `online` começa verdadeiro antes do primeiro evento do NetInfo; cartão em conflito mostra o status otimista até atualizar; lista do servidor sem validação; `fetchChain` frágil; `reloadLocal` sem `catch`; sem testes do hook.
- Câmera: decodifica a foto duas vezes; pode passar de 1 MB sem aviso; JPEGs intermediários não são apagados; temporizador da localização não é limpo; mensagem técnica mostrada ao usuário; `PhotoCapture` mora num arquivo de rota.
- iOS: desligar os textos de microfone e de localização "sempre" antes do primeiro TestFlight.

## Plano 7 — Notificações

- FCM: todo 400 `INVALID_ARGUMENT` vira token inválido; com descarte de tokens, um erro de conteúdo apagaria todos. Corrigir antes de descartar tokens.
- HTTP/2: sem teste de reaproveitamento da sessão; sessão com GOAWAY não é fechada; token do APNs sem `encodeURIComponent`; `DeviceTokenNotForTopic` tratado como nova tentativa; bundle id fixo no código; `.p8` ausente derruba a subida.
- App: `app.config.ts` usa `process.cwd()` em vez de `__dirname`.

## Plano 8 — Infraestrutura

- Imagens do MinIO (Chainguard) em `:latest`: fixar por digest; conferir no primeiro CI que o `cgr.dev` é acessível.
- Script `dev` da API só funciona em macOS/Linux.
- Produção: nunca definir `ENABLE_DEV_ROUTES`; definir `NODE_ENV=production`.
