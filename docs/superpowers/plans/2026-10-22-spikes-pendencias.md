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
- [x] Variáveis de ambiente da API validadas na subida (hoje as chaves S3 caem em `''`)
- [x] A API não lê `.env`
- [x] Fechar o pool do banco no desligamento da API

## Plano 2 — Acesso

- [x] `client_actions`: amarrar `user_id = app_current_user()` na política quando houver login real.
- [x] `getInstallationId`: duas primeiras chamadas simultâneas podem gerar ids diferentes (entra no trabalho de `devices`).
- [x] Identidade por cabeçalho `x-dev-*` some com o login real.
- [x] Suporte ainda pode alterar telefone, e-mail e CPF de qualquer conta que não seja da equipe interna: trocar por funções que exigem verificação e estreitar o `UPDATE` direto.
- [x] `auth_find_user_by_cpf` devolve o e-mail completo e permite enumerar telefones e CPFs: a API mascara o e-mail e limita tentativas.

## Plano 3 — App do cidadão

- [x] `src/lib/api.ts` usa `10.0.2.2` como padrão (só vale no emulador Android): trocar por configuração de build.
- [x] Título repetido no cabeçalho.
- [x] O evento de conclusão guarda o relato interno do agente em `status_events.comment`: não mostrar ao cidadão (ou mover para `details`).
- [x] Solicitação que apoia ocorrência já em atendimento nasce "Em atendimento" (6.1): regra ainda não codificada.
- [x] Aviso antes de "Sair" quando há itens não enviados na fila.
- [x] Telas 1, 2, 3 e "Quase lá" sobre a sessão desta etapa.
- [x] Registrar o token de push com `PUT /me/devices`.
- [x] Saída forçada (renovação recusada) não apaga os dados offline do usuário anterior: marcar a fila por usuário ou limpar ao trocar de conta; o token de acesso não é descartado quando uma rota responde 401.
- [x] Dois códigos de 429: `rate_limited` (por IP ou conta) e `code_rate_limited` (por destino); as telas tratam os dois.
- [x] `api-client` sobrescreve o `init.signal` de quem chama.

Os demais itens deste plano continuam em aberto e passaram para o Plano 4 (Laboratório) ou o Plano 8 (API e testes).

## Plano 4 — App do agente

- [x] Rotas reais substituem `/dev/*`: schema de resposta em todas as rotas (hoje só a lista de atividades declara o seu).
- [x] Chave de foto já usada em outra conclusão responde 409 `client_action_conflict`: o 23505 de `photos.storage_key` cai no mesmo ramo do id de ação repetido.
- [x] `useOutboxSync` está só na tela do Laboratório: mover para o layout raiz.
- [x] 408 e 429 no envio de foto viram falha definitiva: tratar como nova tentativa.
- [x] Foto de conclusão recusada por conflito fica órfã no armazenamento; pastas de itens em conflito ou falha não são apagadas; `dir.delete` com erro interrompe a passada. (No aparelho, resolvido; a foto já enviada ao armazenamento passou para o Plano 8.)
- [x] Tempo limite de 30 s também no envio da foto (3G fraco); corpo da resposta lido sem tempo limite.
- [x] Banco SQLite sem versão de esquema; `openAppDatabase` guarda a promessa rejeitada.
- [x] Máximo de 3 fotos não é imposto em `enqueueWorkOrderAction`; `occurredAt` e `createdAt` vêm de chamadas diferentes de `now()`.
- Página de login de Wi-Fi público com 200 no envio da foto passa (o servidor recusa depois com 422). Passou para o Plano 8.
- [x] Estado `online` começa verdadeiro antes do primeiro evento do NetInfo; cartão em conflito mostra o status otimista até atualizar; lista do servidor sem validação; `fetchChain` frágil; `reloadLocal` sem `catch`; sem testes do hook. (A tela do Laboratório saiu; o que sobrou no modo agente passou para o Plano 8.)
- [x] Câmera: decodifica a foto duas vezes; pode passar de 1 MB sem aviso; JPEGs intermediários não são apagados; temporizador da localização não é limpo; mensagem técnica mostrada ao usuário.
- [x] `PhotoCapture` mora num arquivo de rota.
- [x] iOS: desligar os textos de microfone e de localização "sempre" antes do primeiro TestFlight.
- [x] Decidir quais status o agente vê na lista (hoje `/dev` lista todos os ativos, inclusive `awaiting_review` e `impeded`).
- [x] Login do Laboratório pode terminar sem prefeitura salva se `me` falhar. (veio do Plano 3) (A tela saiu: o modo agente usa `me.agentTenants`.)

## Plano 5 — Painel

- Restringir a leitura de `staff_audit_events` a admin e gestor da prefeitura e à equipe interna (hoje qualquer contexto da prefeitura lê); não gravar dados pessoais em `details`.
- Admin e gestor da prefeitura ainda não conseguem cadastrar nem achar pelo telefone um usuário de fora: precisa de função `SECURITY DEFINER`.
- `merged_into_id` sem `CHECK` ligando ao status `merged` (e diferente do próprio id).
- `status_events.request_id` não é amarrado à mesma ocorrência (precisa acompanhar a junção).
- Exigir e-mail e CPF para gestor e admin é regra da API (o banco só exige telefone ou CPF); vale também para o Plano 6.
- Decidir onde o painel guarda o token de renovação (cookie `httpOnly` ou memória).
- Cadastro de gestor com função `SECURITY DEFINER`.
- O login do painel aceita gestor de prefeitura suspensa ou em implantação (`has_panel_access` não olha o status).
- Um token do painel continua valendo em `/me` depois de perder o vínculo: as rotas do painel conferem o vínculo a cada chamada.
- Troca de e-mail de quem tem acesso ao painel é feita pelo admin (hoje `PATCH /me` recusa com `email_managed_by_admin`).
- A máscara do e-mail usa a caixa original, enquanto o envio usa minúsculas.
- CPF com espaço ou `/` é recusado (só `.` e `-` são removidos); `PanelStartBody` é o tipo de saída (o cliente precisa de `z.input`).
- ~~Categorias na ordem do Pencil~~: decidido em 26/10 manter a ordem alfabética.
- Fotos da contestação aparecem como "Sua foto · abertura" no detalhe e na galeria: o `PhotoView` não diz a origem da foto. Decidido em 26/10: legenda "Sua foto · contestação".

- Ajuste pedido: o painel grava o evento para `rework_requested` no formato `reworkDetailsSchema` (mensagem em `comment`; `{ reasons, discardedPhotoIds }` em `details`) e usa `POST /dev/work-orders/:id/manager` como referência.
- Revisão (W3): mostrar a distância da conclusão ao local da ocorrência (`details.distanceM` do evento de conclusão).
- Textos do app do agente criados sem Pencil (confirmados pelo usuário em 26/10): 'Foto do cidadão'; 'Esta atividade não está mais com você' / 'Ela foi concluída, cancelada ou passada para outra equipe.' / 'Voltar para minhas atividades'; 'Não foi possível carregar a atividade' / 'Confira sua internet e tente de novo.'; 'Não foi possível iniciar. Tente de novo.'; 'Não foi possível enviar. Tente de novo.'; 'O gestor revisa as fotos e o relato.'; pílula 'Cidadão' (fundo surface com borda).

## Plano 6 — Backoffice

- `municipality_leads.updated_by` não é forçado a `app_current_user()` e `updated_at` não muda no `UPDATE`.
- Exigir e-mail e CPF para gestor e admin (regra da API, ver Plano 5).
- Correções de conta pelo suporte, com função própria e auditoria.
- Excluir conta ainda não apaga `city_interest` nem tira `platform_role` da conta excluída.
- Sessões revogadas de conta excluída guardam `installation_id`.
- Ao criar uma prefeitura, usar `municipalities` (nome, UF e contorno do IBGE) em vez de digitar os dados.

## Plano 7 — Notificações

- FCM: todo 400 `INVALID_ARGUMENT` vira token inválido; com descarte de tokens, um erro de conteúdo apagaria todos. Corrigir antes de descartar tokens.
- HTTP/2: sem teste de reaproveitamento da sessão; sessão com GOAWAY não é fechada; token do APNs sem `encodeURIComponent`; `DeviceTokenNotForTopic` tratado como nova tentativa; bundle id fixo no código; `.p8` ausente derruba a subida.
- App: `app.config.ts` usa `process.cwd()` em vez de `__dirname`.
- O mesmo token de push em duas contas: ao registrar, apagar o token dos outros aparelhos (função `SECURITY DEFINER`).
- Avisos por push ao cidadão nas mudanças de status da solicitação (o app já diz "Você recebe um aviso a cada mudança").
- Conclusão automática em 7 dias: solicitação aguardando a confirmação do cidadão é confirmada sozinha (o texto da tela já promete).
- Push de nova atividade e de ajuste pedido para os agentes da equipe.
- Aviso da contestação: as outras solicitações reabertas ganham o evento 'Outro morador informou que o problema continua; a prefeitura vai reavaliar.', mas o detalhe não mostra comentários; levar esse aviso no push (ou expor como aviso do sistema no detalhe).

## Plano 8 — Infraestrutura

- Imagens do MinIO (Chainguard) em `:latest`: fixar por digest; conferir no primeiro CI que o `cgr.dev` é acessível.
- Script `dev` da API só funciona em macOS/Linux.
- Produção: nunca definir `ENABLE_DEV_ROUTES`; definir `NODE_ENV=production`.
- Índice GiST em `tenants.boundary` quando houver muitas prefeituras.
- O dono das tabelas precisa de `BYPASSRLS` em produção (as funções `SECURITY DEFINER` dependem disso).
- Escolher um provedor de SMS ou WhatsApp.
- Verificar o domínio no Resend.
- Um `AUTH_SECRET` forte e único.
- `AUTH_DEV_FIXED_CODE` nunca em produção.
- Limite por IP usa `request.ip` sem `trustProxy` (atrás de proxy todos dividem o mesmo limite).
- Erros 5xx devolvem a mensagem interna: falta resposta `{ code: 'internal_error' }`.
- Limites de envio ficam na memória de cada instância da API.
- `NODE_ENV=production` é a única trava do código fixo e do envio pelo log.
- `/auth/refresh` está no limite por IP de `/auth/*` (o CGNAT das operadoras pode juntar muitos aparelhos num IP).
- Falta limite diário de códigos por número.
- O código é gasto mesmo quando enviado à rota errada (`consumeCode` roda antes de conferir finalidade e usuário). (veio do Plano 3)
- Falha no envio de SMS ou e-mail ainda gasta a janela de 60 s e conta no limite por hora. (veio do Plano 3)
- `409 email_in_use` com o e-mail de uma conta congelada impede o antigo dono de reaproveitar o próprio e-mail. (veio do Plano 3)
- Testes que faltam: código de `phone_login` em `recovery/verify`; 503 `sms_not_configured`; `expires_at` da sessão do painel; RLS de `devices` e `sessions` entre usuários; nas rotas `/dev`, a validação do corpo responde 400 antes do 401. (veio do Plano 3)
- Foto de conclusão ou impedimento enviada ao armazenamento e recusada depois (conflito, vínculo encerrado) fica órfã no MinIO: falta uma limpeza periódica das chaves sem linha em `photos`. (veio do Plano 4)
- Página de login de Wi-Fi público com 200 no envio da foto passa (o servidor recusa depois com 422). (veio do Plano 4)
- Modo agente: o estado `online` de `useAgentWorkOrders` e `useAgentWorkOrder` começa verdadeiro antes do primeiro evento do NetInfo; os hooks do agente não têm teste próprio (a lógica está nos módulos puros testados). (veio do Plano 4)
