# Pendências herdadas dos spikes de risco

Itens menores achados nas revisões dos spikes (`2026-10-22-spikes-de-risco.md`), que não bloqueiam o uso atual mas devem entrar no plano indicado. Cada plano do MVP começa conferindo esta lista.

## Antes de tudo (não são código)

- Testes em aparelho real (Android e iPhone), entrega real de push (FCM e APNs) e foto de câmera real: roteiros em `docs/decisoes/0002-recursos-nativos-offline-e-push.md`. O Plano 7 foi feito sem a entrega real (o envio sai no log enquanto Firebase e Apple não estão configurados); a entrega real de push com Firebase e Apple fica para o fim (ver "Em aberto depois do Plano 7").

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

O Plano 5 tem duas partes: 5a (login, menu, mapa, triagem, juntar e separar, atribuir e recusar; `2026-10-26-painel-5a.md`) e 5b (o resto). Os itens resolvidos no 5a estão marcados; os abertos passaram para o Plano 5b.

- [x] `merged_into_id` sem `CHECK` ligando ao status `merged` (e diferente do próprio id).
- [x] `status_events.request_id` não é amarrado à mesma ocorrência. Decidido no 5a: fica sem amarração, de propósito; o evento é histórico e guarda a ocorrência da época.
- [x] Decidir onde o painel guarda o token de renovação: cookie `ac_panel_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/auth/panel`); o token de acesso fica só na memória.
- [x] O login do painel aceita gestor de prefeitura suspensa ou em implantação: o painel aceita `onboarding` e `active`; a suspensa não entra.
- [x] Um token do painel continua valendo em `/me` depois de perder o vínculo: as rotas do painel conferem o vínculo a cada chamada (com teste no painel).
- [x] A máscara do e-mail usa a caixa original, enquanto o envio usa minúsculas (`maskEmail` usa minúsculas).
- [x] CPF com espaço ou `/` é recusado; `PanelStartBody` é o tipo de saída (o cliente usa `z.input`).
- ~~Categorias na ordem do Pencil~~: decidido em 26/10 manter a ordem alfabética.
- Textos do app do agente criados sem Pencil (confirmados pelo usuário em 26/10): 'Foto do cidadão'; 'Esta atividade não está mais com você' / 'Ela foi concluída, cancelada ou passada para outra equipe.' / 'Voltar para minhas atividades'; 'Não foi possível carregar a atividade' / 'Confira sua internet e tente de novo.'; 'Não foi possível iniciar. Tente de novo.'; 'Não foi possível enviar. Tente de novo.'; 'O gestor revisa as fotos e o relato.'; pílula 'Cidadão' (fundo surface com borda).

Os demais itens deste plano continuam em aberto e passaram para o Plano 5b.

## Plano 5b — Painel (segunda parte)

Feito no 5b (`2026-10-26-painel-5b.md`). O que sobrou foi para os Planos 6 e 7; o push do painel (publicar, devolver, reatribuir, reagendar) está no Plano 7 e a auditoria sem dado pessoal em `details`, no Plano 6.

- [x] Restringir a leitura de `staff_audit_events` a admin e gestor da prefeitura e à equipe interna (migração `0022`). A regra "não gravar dados pessoais em `details`" passou para o Plano 6. (veio do Plano 5)
- [x] Cadastro de pessoas (gestor, agente) com função `SECURITY DEFINER` (`panel_find_or_create_agent_user` e `panel_find_or_create_manager_user`). (veio do Plano 5)
- [x] Exigir e-mail e CPF para gestor é regra da API (o banco só exige telefone ou CPF); a W6b exige os dois. Vale também para o admin criado no backoffice, no Plano 6. (veio do Plano 5)
- [x] Troca de e-mail de quem tem acesso ao painel é feita pelo admin (W6b, `panel_change_manager_email`). Quem também tem acesso a outro painel fica para o suporte (Plano 6). (veio do Plano 5)
- [x] Ajuste pedido (W3b, `apps/api/src/panel/work-order-actions.ts`): o painel grava o evento para `rework_requested` no formato `reworkDetailsSchema` (mensagem em `comment`; `{ reasons, discardedPhotoIds }` em `details`) e usa `POST /dev/work-orders/:id/manager` como referência. (veio do Plano 5)
- [x] Revisão (W3): mostrar a distância da conclusão ao local da ocorrência (`details.distanceM` do evento de conclusão). (veio do Plano 5)
- [x] Fotos da contestação aparecem como "Sua foto · abertura" no detalhe e na galeria: o `PhotoView` não diz a origem da foto. Decidido em 26/10: legenda "Sua foto · contestação". (veio do Plano 5)
- [x] "Em atendimento" e "Todas as solicitações" viram listas simples (no 5a, página provisória "Esta tela chega na próxima etapa do painel."). (veio do Plano 5a)
- [x] Edição da base da equipe (`teams.base_address` e `teams.base_location`) na W6; no 5a só o seed preenche. (veio do Plano 5a)
- [x] Setores: cadastro (só o admin) e a lista da W7. (veio do Plano 5a)
- [x] Busca do mapa: o resultado não diz o status, e uma recusada ou concluída aparece junto das abertas no mesmo endereço (ordem por protocolo). Decidir se mostra o status ou põe as abertas primeiro. (veio do Plano 5a, passada no navegador)
- Textos do painel criados sem Pencil no 5b (confirmados pelo usuário em 26/10; decisões e regras do `2026-10-26-painel-5b.md`; os do 5a estão na lista seguinte):
  - Gerais das filas e listas: 'Esta atividade mudou. Atualizamos o painel.'; 'Nenhum atendimento aguardando revisão.'; 'Nenhum impedimento. Tudo em dia.'; 'Nenhuma ocorrência em atendimento.'; 'Nenhuma solicitação com estes filtros.'; 'Mostrando {n} de {total}'; '{início}–{fim} de {total}' com 'Anterior' e 'Próxima'; 'há N min', 'há N h', 'há 1 dia', 'há N dias'.
  - W3: apoio do título ('{n} atendimentos concluídos pelas equipes. O cidadão só recebe depois que você publicar.' e o singular); 'No local (a {d})'; 'Longe do local (a {d})'; 'Sem localização na conclusão'; '{n} cidadãos aguardando' / '1 cidadão aguardando'; 'Concluído em {data}'; 'O agente não enviou fotos.'; 'O agente não escreveu relato.'; 'Publicar' / 'Não publicar' nas fotos; 'Os {n} cidadãos recebem este texto e as fotos marcadas.' / 'O cidadão recebe este texto e as fotos marcadas.'; 'Publicar para os cidadãos'; 'Publicado para os cidadãos.'.
  - W3b: 'Devolver ao agente'; 'O que precisa ajustar?' / 'marque um ou mais'; 'Tirar novas fotos', 'Corrigir o relato', 'Voltar ao local: serviço incompleto'; 'Fotos que não servem' / 'serão descartadas'; 'Mensagem para o agente'; 'A atividade volta para a lista do agente. O cidadão continua vendo "Em atendimento".'; botão 'Devolver'; 'Devolvida ao agente.'.
  - W4: apoio do título ('{n} atividades que a equipe não conseguiu resolver. Decida o próximo passo.' e o singular); 'Registrado em {data}'; 'Cidadãos veem: Em atendimento'; 'Outro motivo'; 'O agente não escreveu detalhes.'; 'Próximo passo'; 'Reatribuir a outra equipe' / 'A nova equipe recebe a atividade com suas instruções'; 'Reagendar com a mesma equipe' / 'Define uma nova data; a equipe atual continua responsável'; 'Recusar solicitação' / 'Você escreve o motivo que os cidadãos vão ler'; 'Nova data'; 'Prazo interno'; 'Instruções para o agente'; '{nome} · base a {d}'; 'Nenhuma outra equipe do setor {setor}. Cadastre uma em Equipes e agentes.'; 'Confirmar próximo passo'; avisos 'Reatribuída a {equipe}.', 'Reagendada para {data}.' e comentários de evento 'Reatribuída a {equipe}', 'Reagendada para {data}'.
  - Listas: '{n} ocorrências em atendimento' / '1 ocorrência em atendimento'; filtros 'Categoria: todas', 'Atividade: todas', 'Status: todos', 'Período: 30 dias'; 'Buscar endereço ou protocolo'; '{total} solicitações' / '1 solicitação' com '· últimos {d} dias' ou '· todo o período'; cabeçalhos das colunas 'Ocorrência', 'Local', 'Equipe', 'Atividade', 'Prazo' e 'Em atendimento há' (Em atendimento) e 'Protocolo', 'Categoria', 'Local', 'Status' e 'Aberta em' (Todas), que não estão no Pencil.
  - W6: 'Equipes e agentes' (título e abas); '{n} equipes · {m} agentes ativos' e singulares; '{setor} · {n} agentes · {m} abertas'; 'Nenhuma equipe cadastrada. Crie a primeira em "Nova equipe".'; 'Setor: {setor} · base: {endereço}' / 'Setor: {setor} · sem base'; 'Nenhum agente nesta equipe.'; 'nunca entrou'; 'Convidado'; 'Desativado'; 'Editar'; 'Adicionar agente'; 'Nova equipe' / 'Editar equipe'; 'Remover ponto'; 'Clique no mapa para marcar a base. Ela é usada para sugerir a equipe mais próxima.'; 'Ele recebe o código de acesso por SMS neste número.'; botões 'Adicionar', 'Mudar' e 'Salvar' (decisão da execução); 'Trocar número', 'Novo celular', 'Mudar de equipe', 'Desativar', 'Reativar'; 'Desativar {nome}?' / 'Ele deixa de ver as atividades no app. Dá para reativar depois.'; avisos 'Equipe criada.', 'Equipe salva.', '{nome} adicionado à equipe.', 'Número trocado.', '{nome} agora está na equipe {equipe}.', '{nome} desativado.', '{nome} reativado.'.
  - Erros de campo e de aviso: 'Já existe uma equipe com este nome.'; 'Este celular já é de um agente da equipe {equipe}.' (ou 'Este celular já é de um agente de outra equipe.' quando o nome da equipe não vem); 'Este agente já está nesta equipe.'; 'Não dá para trocar o número deste agente pelo painel. Ele troca no Perfil do app.'; 'Este número já é de outra conta.'; 'Este CPF já tem outro e-mail cadastrado: {e-mail mascarado}.'; 'Este e-mail já é de outra pessoa.'; 'Esta pessoa já é gestora nesta prefeitura.'; 'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.' (`cpf_unavailable`); 'Esta pessoa também tem acesso a outro painel. Peça a troca ao suporte do Alô Cidadão.' (`email_change_not_allowed`); 'Já existe uma categoria com este nome.'; 'Já existe um setor com este nome.'; 'Esta equipe não está disponível para você.' (`team_not_eligible` ao mudar o agente de equipe). Os erros `photo_not_found`, `same_team` e `due_date_in_past` não têm texto próprio no painel: caem na mensagem geral 'Não foi possível concluir. Tente de novo.'; decidir se merecem texto.
  - W6b: '{n} gestores · {m} admins da prefeitura' e singulares; 'Todos' / '—' nos setores; 'Gestor', 'Admin', 'Desativado'; 'Novo gestor'; 'Setores'; 'Editar' (E-mail e Setores); 'Desativar {nome}?' / 'Ele deixa de entrar no painel. Dá para reativar depois.'; 'Gestor salvo.'; '{nome} cadastrado como gestor.'.
  - W7: 'Categorias' e 'Setores' (abas); 'Nova categoria', 'Editar: {nome}'; 'Nome no app'; 'Ícone' e os nomes dos 9 ícones (Obra, Lâmpada, Lixo, Árvore, Água, Calçada, Placa, Animal, Outro); 'Cor do ícone' com 'Azul · infraestrutura', 'Verde · meio ambiente', 'Amarelo · serviços públicos'; 'Setor responsável'; 'Prazo padrão' (`1 dia`, `N dias`) e 'dias'; 'Raio de agrupamento' (`N m`), 'metros' e 'Relatos desta categoria a até {r} m são sugeridos como a mesma ocorrência.'; 'Mostrar {categoria} no app'; '{categoria} aparece no app.' / '{categoria} não aparece mais no app.'; 'Categoria criada.' / 'Categoria salva.'; 'Novo setor' / 'Renomear'; 'Nome'; 'Setor criado.' / 'Setor salvo.'; colunas 'Categorias', 'Equipes', 'Gestores'. A aba Setores mantém o título e o subtítulo de Categorias.
  - Legenda da foto de contestação no app: 'Sua foto · contestação'.
  - Cabeçalho '⋯' das tabelas de gestores e setores (a tabela de agentes da W6 não tem cabeçalho nessa coluna): conferir qual vale.

- Textos do painel criados sem Pencil (confirmados pelo usuário em 26/10; decisões do `2026-10-26-painel-5a.md`):
  - Login: 'Confira o CPF.'; 'Não encontramos acesso ao painel para este CPF. Fale com o administrador do Alô Cidadão na sua prefeitura.'; 'Aguarde {m:ss} para pedir outro código.'; 'Código incorreto. Confira e tente de novo.'; 'O código expirou. Peça um novo.'; 'Muitas tentativas. Peça um novo código.'; 'Não chegou? Veja o spam ou' + 'reenvie o código'; 'Enviando…'; 'Entrando…'.
  - Gerais: 'Não foi possível conectar. Confira sua internet e tente de novo.'; 'Sua sessão expirou. Entre de novo.'; 'Seu acesso ao painel não está ativo' / 'Fale com o administrador do Alô Cidadão na sua prefeitura.' / 'Sair'; 'Esta ocorrência mudou. Atualizamos o painel.'; 'Não foi possível concluir. Tente de novo.'; 'Nenhuma ocorrência com estes filtros.'; 'Tentar de novo' (botão do erro de carga).
  - Páginas do 5b: 'Esta tela chega na próxima etapa do painel.'.
  - Mapa e busca: 'Nada encontrado para "{texto}".'; subtítulo no singular '1 ocorrência aberta e em atendimento · últimos 30 dias' (e '1 ocorrência aberta', '1 ocorrência em atendimento'); '· todo o período'.
  - Painel do ponto: 'Sem observação'; '{n} relatos parecidos a {d} m' / '1 relato parecido a {d} m'; 'Ver mais 1 relato'; 'Separe os relatos desmarcados antes de atribuir.'; 'Atribuída a {equipe} · {status da atividade}'.
  - Juntar e separar: 'As duas ocorrências têm atividade em andamento. Cancele uma antes de juntar.'; 'Relatos juntados a este ponto.'; 'Separar {n} relatos?' / 'Separar 1 relato?'; 'Eles viram uma nova ocorrência em triagem, no mesmo lugar.'; '{n} relatos separados em uma nova ocorrência.' / '1 relato separado em uma nova ocorrência.'.
  - Recusar: 'Recusar ocorrência'; 'Motivo para os cidadãos'; 'Os {n} cidadãos que relataram recebem este texto.' / 'O cidadão que relatou recebe este texto.'; 'A ocorrência sai das filas e os cidadãos veem "Recusada".'; 'Ocorrência recusada.'.
  - Atribuir: 'Nenhuma equipe do setor {setor}. Cadastre uma em Equipes e agentes.'; '(hoje)', '(1 dia)', '(N dias)'; 'Atribuída a {equipe}.'; meta no singular ('1 agente', '1 atividade aberta').
  - Triagem: 'Nenhuma solicitação nova. Tudo em dia.'; subtítulo no singular '1 solicitação nova aguardando análise · mais antigas primeiro'; '+1 parecida'.

## Plano 6a — Backoffice (primeira parte)

Feito no 6a (`2026-10-26-backoffice-6a.md`): entrada da equipe interna, P1 Prefeituras, P2 Nova prefeitura, P3 Visão geral com ativar, suspender e reativar, e P4 modo suporte com auditoria. O que sobrou está no Plano 6b.

- [x] Ao criar uma prefeitura, usar `municipalities` (nome, UF e contorno do IBGE) em vez de digitar os dados.
- [x] Exigir e-mail e CPF do admin da prefeitura (e do gestor, ver Plano 5b).
- [x] Auditoria (`staff_audit_events`): nunca gravar dado pessoal em `details`; o modo suporte grava só `{ route }`. (veio do Plano 5b)
- [x] `app.platform_role` nunca para token do app (só depois de `requirePlatformStaff` ou `requirePanelMember`).

- [x] Textos do backoffice criados sem Pencil no 6a, confirmados pelo usuário em 2026-10-28 (decisões do `2026-10-26-backoffice-6a.md`; os do Pencil não entram aqui):
  - Validação do formulário da P2: 'Preencha este campo.'; 'Informe o nome (2 a 80 caracteres).'; 'Informe o nome (2 a 120 caracteres).'; 'CPF inválido.'; 'E-mail inválido.'; 'Informe de 1 a 10000.'; 'Não foi possível buscar os municípios.'; 'Confira os dados e tente de novo.'.
  - Placeholders da P2: 'Nome ou código do município'; 'Nome completo'; '000.000.000-00'; 'nome@prefeitura.gov.br'.
  - Erros da P2 vindos da API: 'Município não encontrado. Busque de novo.'; 'Este município já tem prefeitura cadastrada.'; 'Este CPF já tem outro e-mail cadastrado: {maskedEmail}.'; 'Este e-mail já é de outra pessoa.'; 'Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.'; 'Esta pessoa é da equipe Alô Cidadão. Use outro CPF.' (`staff_account_not_allowed`); 'O fim da vigência não pode ser antes do início.'.
  - P3: 'A situação da prefeitura mudou. Atualizamos a tela.'; 'Antes de ativar, cadastre ao menos uma categoria ativa e uma equipe.'; 'Reative a prefeitura para entrar no painel.'; diálogos 'Ativar {nome}?' / 'Ela passa a aparecer para os cidadãos do município, que poderão registrar solicitações.' e 'Suspender {nome}?' / 'Os cidadãos deixam de conseguir registrar solicitações no município, e gestores e agentes perdem o acesso. As solicitações abertas ficam como estão.' (botões 'Cancelar', 'Ativar', 'Suspender'); avisos 'Prefeitura criada. Ela está em implantação.', 'Prefeitura ativada.', 'Prefeitura suspensa.', 'Prefeitura reativada.'.
  - Vazios e erros de carga: 'Nenhuma prefeitura cadastrada.'; 'Nenhuma ação da equipe Alô Cidadão ainda.'; 'Não foi possível carregar as prefeituras.'; 'Não foi possível carregar a prefeitura.'.
  - Apoios e indicadores: '{n} prefeituras · {a} ativas, {i} em implantação' (e singulares, ', {s} suspensas'); '+{i} em implantação'; '+12% sobre setembro' / '-5% sobre setembro' / 'sem comparação com setembro'; '{n} aguardando revisão há +1 dia', '{n} impedimentos parados', 'Sem categorias configuradas'; '{n} abertas há +3 dias' / 'nenhuma aberta há +3 dias'; '{n} há mais de 1 dia' / 'nenhuma há mais de 1 dia'; '{a} ativos · {c} convidados'; '{g} · {m} admins'; '{n} ativas'; '{u} de {incluídos} incluídos'; 'desde {início}'; 'cliente desde {data}'; '{nome} · {quando}' nas últimas ações.
  - Menu e páginas provisórias: 'Esta tela chega na próxima etapa do backoffice.' (Interesse por cidade, Equipe Alô Cidadão e Auditoria); botão 'Sair' do menu escuro (faltava no Pencil).
  - Rótulos da auditoria (`STAFF_AUDIT_ACTION_LABELS`, como 'Entrou no painel (suporte)', 'Criou a prefeitura', 'Publicou um atendimento') e 'Fez uma alteração' para ação sem rótulo.
- Para decidir na revisão do 6a:
  - A média do tempo até a conclusão conta cada evento `awaiting_confirmation` dos últimos 30 dias; solicitação republicada depois de contestação conta duas vezes.
  - `POST /panel/teams/:id/agents` é auditado com `target_type` `team` (o agente novo não está na URL).
  - Quem é da equipe interna e também gestor de uma prefeitura segue o caminho da equipe no painel, e as ações dele aparecem como suporte.
  - Sair do modo suporte ignora falha da chamada `support/leave` (nunca prender a equipe numa prefeitura); a linha `support.leave` pode faltar na auditoria nesse caso.
  - A busca de município tira acento com `lower()` + `translate()` (sem a extensão `unaccent`), só dos acentos da tabela.

## Plano 6b — Backoffice (segunda parte)

Feito no 6b (`2026-10-28-backoffice-6b.md`): P5 Interesse por cidade, P6 Equipe Alô Cidadão, P7 Auditoria, conta congelada (CPF preso) na P2, na P6 e no painel em modo suporte, troca de e-mail e de celular pelo suporte e a separação equipe × prefeitura.

- [x] Telas que o menu já mostrava como provisórias: Interesse por cidade, Equipe Alô Cidadão e Auditoria. As abas da P3 além de Visão geral continuam em aberto (ver "Em aberto depois do 6b").
- [x] `panel_find_or_create_manager_user` e `panel_find_or_create_agent_user` recusam conta da equipe Alô Cidadão (`staff_account_not_allowed`), e um gatilho em `memberships` segura a regra no banco. (veio do Plano 6a)
- [x] `municipality_leads.updated_by` forçado a `app_current_user()` e `updated_at` atualizado no `UPDATE` (gatilho).
- [x] Correções de conta pelo suporte, com função própria e auditoria (`account.recover`, `account.release_cpf`).
- [x] Revisão final do 6b: a conta recuperada fica sempre sem número; liberar o CPF de conta congelada sem número é recusado (`frozen_account_without_phone`); conta congelada de alguém da equipe só o Admin recupera ou libera; a prefeitura da auditoria da conta congelada tem de ser a do modo suporte aberto (`support_tenant_mismatch`); troca de e-mail de gestor e de celular de agente no modo suporte com ação própria; o aviso da P6 usa o nome da conta.
- [x] Excluir conta apaga `city_interest` e tira `platform_role`; recusa deixar a equipe sem Admin (`last_platform_admin`).
- [x] Sessões revogadas de conta excluída ficam sem `installation_id`.
- [x] Trocar o e-mail de um gestor com acesso a outro painel ou de um admin: em modo suporte o painel aceita. (veio do Plano 5b)
- [x] Cadastrar como gestor quem está numa conta bloqueada que guarda o CPF: recuperar a conta antiga ou criar uma nova. (veio do Plano 5b)
- [x] Trocar o celular de um agente com vínculo em outra prefeitura: em modo suporte o painel aceita. (veio do Plano 5b)
- [x] Achados da passada do 6a: o 404 do detalhe da revisão publicada saiu (Task 11). O aviso 'Prefeitura criada…' continua só no teste de unidade.

### Textos novos do 6b para o usuário confirmar

As telas do 6b foram feitas no código antes do Pencil (o limite de uso do pen.dev bloqueou a Task 1). Os textos abaixo não vêm do Pencil; os do spec e do plano estão marcados com "(plano)".

- **P6 Equipe Alô Cidadão:**
  - Janela: 'Adicionar pessoa' (título; o botão vem do Pencil); 'Editar pessoa'; 'recebe o código' (ajuda do E-mail); 'Papel' (rótulo do select, com 'Admin' e 'Suporte').
  - Avisos: '{nome} entrou na equipe.' (o nome da conta, que pode não ser o digitado); 'Pessoa salva.'; '{nome} agora é {Admin/Suporte}.'; '{nome} saiu da equipe.'.
  - Menu ⋯: 'Editar', 'Trocar papel', 'Remover da equipe'. Na própria linha só 'Editar'.
  - Confirmações: 'Trocar o papel de {nome}?' / '{nome} passa de {Admin/Suporte} para {Suporte/Admin}.' / botão 'Trocar papel'; 'Remover {nome} da equipe?' / 'A pessoa deixa de entrar no backoffice. A conta dela continua existindo.' / botão 'Remover'.
  - Erros: 'Esta pessoa já está na equipe Alô Cidadão.' (`already_staff`); 'Esta pessoa é gestora ou agente de uma prefeitura. Use outro CPF.' (plano); 'A equipe precisa de ao menos um Admin. Passe o papel de Admin a outra pessoa antes.' (`last_platform_admin`); 'Você não pode trocar o próprio papel nem se remover da equipe.' (`self_change_not_allowed`); 'Esta pessoa não está mais na equipe.' (`staff_not_found`); 'Não foi possível carregar a equipe.' com 'Tentar de novo'.
  - Último acesso: 'hoje, HH:MM', 'ontem, HH:MM', 'há N dias' (2 a 30 dias), depois '25 set 2026'; 'nunca entrou'.
- **Conta bloqueada (bloco da P2, da P6 e do painel em modo suporte):** 'Este CPF está numa conta bloqueada.'; 'Recupere a conta antiga com o código enviado ao e-mail dela, ou crie uma conta nova sem o histórico da antiga.'; 'Recuperar conta antiga' / 'Criar conta nova' (plano); 'Enviamos um código para {e-mail mascarado}, o e-mail da conta antiga.'; 'Código'; 'Recuperar conta'; 'Enviar outro código'; 'Código incorreto ou expirado. Confira ou peça um novo.'; 'A conta antiga não tem e-mail para receber o código. Só dá para criar uma conta nova.'; confirmação 'Criar conta nova?' / 'O CPF sai da conta antiga, que continua bloqueada e guarda o histórico dela. A pessoa começa do zero numa conta nova.' / botão 'Criar conta nova'; 'Esta prefeitura não foi encontrada. Volte ao backoffice e tente de novo.' (`tenant_not_found`, modo suporte); 'Conta bloqueada' (`aria-label`, só leitor de tela).
- **P5 Interesse por cidade:** situações 'Sem contato', 'Contatado', 'Proposta enviada', 'Em negociação', 'Fechado', 'Perdido' (plano); selo 'Já é cliente'; aviso '{Município — UF}: {situação}.'; vazio 'Ninguém pediu o Alô Cidadão em uma cidade ainda.'; erro 'Não foi possível carregar o interesse por cidade.' com 'Tentar de novo'; colunas do CSV 'Posição;Município;UF;Pedidos;Últimos 30 dias;Primeiro pedido;Situação comercial;Já é cliente' com 'Sim'/'Não' e o arquivo 'interesse-por-cidade.csv' (plano).
- **P7 Auditoria:** título 'Auditoria' e apoio 'O que a equipe fez no backoffice'; colunas 'Quando', 'Pessoa', 'Prefeitura', 'Ação', 'Alvo'; filtros 'Prefeitura: todas', 'Pessoa: todas', 'De', 'Até'; 'Carregando…'; 'Nenhuma ação com estes filtros.'; 'Não foi possível carregar a auditoria.' com 'Tentar de novo'; paginação 'Anterior', 'Próxima', '1–50 de 120'; alvo 'Conta excluída' e '—' (plano); 'Fez uma alteração' para ação sem rótulo.
- **Rótulos novos da auditoria (plano):** 'Adicionou uma pessoa à equipe'; 'Editou uma pessoa da equipe'; 'Trocou o papel de uma pessoa da equipe'; 'Removeu uma pessoa da equipe'; 'Mudou a situação comercial'; 'Recuperou uma conta congelada'; 'Liberou o CPF de uma conta congelada'. Da revisão final: 'Trocou o e-mail de um gestor' (`manager.email_change`) e 'Trocou o celular de um agente' (`agent.phone_change`), ações próprias da troca no modo suporte.
- **Conta bloqueada, da revisão final:** 'A conta antiga não tem celular, então o CPF não pode sair dela.' (`frozen_account_without_phone`); 'Você não está no modo suporte desta prefeitura. Volte ao backoffice e entre nela de novo.' (`support_tenant_mismatch`); 'Esta conta é de alguém da equipe Alô Cidadão. Só um Admin pode recuperá-la ou liberar o CPF dela.' (`admin_only`, conta congelada de alguém da equipe).
- **Reativar ou mudar de equipe quem virou equipe Alô Cidadão (revisão final, textos reaproveitados):** agente 'Este número é de alguém da equipe Alô Cidadão. Use outro número.'; gestor 'Esta pessoa é da equipe Alô Cidadão. Use outro CPF.'.
- **Painel (cadastros):** gestor da equipe Alô Cidadão: 'Esta pessoa é da equipe Alô Cidadão. Use outro CPF.' (o mesmo da P2); agente: 'Este número é de alguém da equipe Alô Cidadão. Use outro número.' (plano).
- **App:** exclusão recusada do último Admin: 'Você é o último Admin da equipe Alô Cidadão. Passe o papel a outra pessoa antes de excluir a conta.' (plano).

### Escolhas visuais fora do Pencil para o usuário confirmar

- Cores dos selos da P5: 'Contatado' azul (`primary`), 'Fechado' verde (`success`), 'Perdido' cinza (`muted`), 'Já é cliente' verde (`success`). 'Sem contato' (`subtle`), 'Proposta enviada' e 'Em negociação' (`primary`) seguem o Pencil.
- Selo de papel da P6 ('Admin', 'Suporte') com 13/600, do componente `Badge` do painel; o Pencil usa 12/700.
- Bloco de conta bloqueada: caixa cinza com ícone de alerta, dentro do formulário, logo acima dos botões (capturas `P2-conta-congelada.png`, `P4-conta-congelada.png`, `P6-conta-congelada.png`).
- P7: filtros como selects e campos de data na barra do título; data e hora 'dd/mm/aaaa, HH:MM' na coluna 'Quando'.

### Em aberto depois do 6b

- **Task 1b, 31/10/2026:** passar as telas do 6b (P5 com menu, P6 com janela e confirmações, P7, bloco de conta bloqueada) e o sino de avisos do painel (Plano 7, captura `docs/superpowers/specs/telas-painel/sino-avisos.png`) para o Pencil e validar lá. As capturas do código em `docs/superpowers/specs/telas-backoffice/` são substituídas pelas exportações do Pencil.
- Encerrar o modo suporte por tempo sem atividade. Hoje a saída implícita só grava `support.leave` ao entrar de novo no modo suporte ou no painel por login.
- [x] Abas da P3 além de Visão geral (Contrato, Equipes e agentes, Gestores, Categorias, Cidadãos, Auditoria): feitas no pronto para validação (sem Pencil; ver a seção "Pronto para validação").
- O último Admin pode ser congelado pelo número reaproveitado: um Admin com telefone (cidadão que virou equipe), parado há 90 dias, é congelado quando alguém cadastra o número (`auth_freeze_stale_account`, da 0014). `platform_require_other_admin` só conta contas ativas, mas nada impede o congelamento. Pouco provável; caminho sugerido: `auth_freeze_stale_account` pular contas com `platform_role`.
- P7: o filtro 'Pessoa' lista só quem está na equipe hoje (`platform_staff_list`). Quem saiu ou excluiu a conta não dá para filtrar. Caminho sugerido: uma função só do admin com os `staff_user_id` distintos de `staff_audit_events`.
- [x] A tabela de gestores do painel tem cabeçalho `⋯` na coluna do menu (pendência antiga do 5b, vista de novo na passada do 6b): corrigido no pronto para validação (Task 12). A tabela de setores ainda tem o `⋯` no cabeçalho (ver "Em aberto depois do pronto para validação").
- [x] Corte do menu ⋯ (`RowMenu`) não conferido na `ManagersPage`, na `AgentsTable` e na `DepartmentsPage`: conferido no navegador na passada do pronto para validação; o menu da última linha das três telas abre inteiro, sem corte.
- 'Último Admin' na P6 não dá para provocar pela tela (ninguém troca o próprio papel nem se remove); só a exclusão da conta no app chega a `last_platform_admin`.
- [x] Recuperar uma conta congelada cujo CPF já foi liberado (código pedido antes da liberação) dava 500 (`users_phone_or_cpf_check`): corrigido no pronto para validação (Task 11, migração 0039): `AND u.cpf IS NOT NULL` na busca, e a API responde `invalid_code`.
- Menores das revisões, agrupados:
  - Banco: corridas estreitas (trava condicional em `account_delete`; gatilho de `memberships` sem trava contra `platform_staff_add`; `support.leave` implícito e `support.enter` em transações separadas); `p_limit`/`p_offset` sem validação; 23505 ambíguo em `platform_staff_add`; recuperar confia na conferência do desafio pela API.
  - API: testes que faltam (token do app nas rotas novas, 401 e corpo inválido, erros do CSV, `DELETE` 404 só confere o status); mapa de erros da equipe duplicado; segunda leitura do e-mail mascarado sem trava; `tenantId` em maiúsculas dá `support_tenant_mismatch` falso (só pedido feito à mão); `agent.phone_change` gravado mesmo sem mudar o número; teste de último Admin muda todos os admins do banco de teste.
  - Web: P5 sem testes dos erros de situação e do CSV, sem estado de carregando, erro antigo não some no sucesso; P7 pisca o vazio depois do redirecionamento, não confere `de` > `até`, regex de UUID mais solta que `z.uuid()`; ManagerDialog não limpa o bloco de conta bloqueada ao editar o e-mail; detalhe antigo depois da recusa por "mudou"; `formatLastAccess` mostra data futura sem ano.
  - Compartilhado: `csvCell` sem proteção contra fórmula (só nomes de município).

## Plano 7 — Notificações

Feito no Plano 7 (`2026-10-29-notificacoes.md`): avisos gerados no banco por gatilho em `status_events`, fila `notification_outbox` com envio pela API (push e e-mail), sino do painel, confirmação automática em 7 dias, logout que apaga o token do aparelho e toque no push que abre a solicitação ou a atividade no app. Sem Firebase e Apple configurados, o push sai no log (`Push (log, sem provedor)`).

- [x] FCM: todo 400 `INVALID_ARGUMENT` vira token inválido; com descarte de tokens, um erro de conteúdo apagaria todos. Agora só `UNREGISTERED` e token de registro inválido descartam o token; o resto é nova tentativa (e 404 só com `UNREGISTERED` no detalhe).
- [x] HTTP/2: teste de reaproveitamento da sessão e de reconexão; sessão com GOAWAY fechada; token do APNs com `encodeURIComponent`; `DeviceTokenNotForTopic` como token inválido; bundle id em `APNS_BUNDLE_ID`; `.p8` ausente desliga o APNs com aviso em vez de derrubar a subida.
- [x] App: `app.config.ts` usa `__dirname`.
- [x] O mesmo token de push em duas contas: ao registrar, o token sai dos outros aparelhos (`device_claim_push_token`).
- [x] Avisos por push ao cidadão nas mudanças de status da solicitação.
- [x] Conclusão automática em 7 dias (`auto_confirm_requests()`, a cada 10 min, sem push).
- [x] Push de nova atividade e de ajuste pedido para os agentes da equipe.
- [x] Push de atribuição para a equipe. (veio do Plano 5a)
- [x] Push do painel 5b: publicar (cidadão, push e e-mail), devolver ao agente (ajuste pedido), reatribuir (nova atividade para a equipe nova). Reagendar não avisa (decisão do plano). (veio do Plano 5b)
- [x] Aviso da contestação: as outras solicitações reabertas recebem o push `Solicitação {p}: voltou para análise`. O detalhe do app continua sem mostrar o comentário do evento.
- [x] O Laboratório do app mandava `status` para `/dev/push`, que passou a pedir `kind` (achado na passada do Plano 7; corrigido com teste).

### Textos novos do Plano 7 para o usuário confirmar

- **Sino do painel (sem Pencil; captura `docs/superpowers/specs/telas-painel/sino-avisos.png`):** 'Avisos' (título e `aria-label` do botão); 'Marcar todos como lidos'; vazio 'Nenhum aviso por enquanto.'; contador '99+' acima de 99; hora do aviso no formato relativo do painel ('há 1 min', 'há 1 h').
- **Já aprovados com o plano:** os textos do push (título 'Alô Cidadão' e os 11 tipos da tabela das Decisões do `2026-10-29-notificacoes.md`) e o e-mail da conclusão (assunto e corpo). Vistos no log da passada sem mudança.

### Em aberto depois do Plano 7

- **Sino no Pencil, 31/10/2026:** junto com a Task 1b do 6b (ver "Em aberto depois do 6b").
- **Testes em aparelho do toque no push** (roteiro na seção 5 do `0002`): agente com o app no modo cidadão toca num push de atividade (troca de modo e de prefeitura e depois abre a atividade); app fechado aberto pelo toque (partida a frio). Os dois só têm teste de unidade.
- **'Concluída sem fotos' não sai pela API de hoje:** concluir pelo agente exige ao menos uma foto, então o sino só mostra 'sem fotos' para eventos gravados sem foto (o seed de desenvolvimento e a simulação da passada). O texto fica para quando houver conclusão sem foto.
- Menores das revisões, agrupados:
  - Banco: política de `panel_notifications` `FOR ALL` (os grants são a barreira); a barreira da fila sem política não tem teste próprio; nome aleatório da 0031; testes que faltam (contagem de admin + gestor só pelo número, teste de "quem agiu" com transição impossível, gestor que também é da equipe, cidadão excluído); as FKs `NO ACTION` pedem ordem de limpeza nos testes; `finish` não confere quem pegou a linha (janela de envio em dobro aceita); registro simultâneo do mesmo token; linhas `skipped` contam no lote.
  - API: PEM malformado ou arquivo da conta de serviço do FCM ausente sem aviso na subida; avisos da fila perdidos se `buildApp` falhar; stream HTTP/2 fechado sem `end` espera o tempo limite; aparelho com nova tentativa não recebe se outro aparelho da pessoa recebeu (decisão da Task 5); linha `sent` pode guardar `last_error`; `catch` do savepoint do logout sem teste; o mesmo token em duas plataformas fica com a última; rotas do sino sem teste entre prefeituras e lista sem `withPhotos` falso.
  - Web: `aria-haspopup` num botão que abre um painel simples; o número de não lidos não entra no nome acessível do botão ('Avisos'); sem testes da marcação que falha, do Esc e do clique fora; mocks de `PanelLayout`/`SupportMode` sem `panelNotifications`; largura do painel do sino em telas estreitas não conferida.
  - App: id do push sem conferência estrita de UUID; `openNotificationRoute` sem teste; `usePathname` faz a pilha da raiz renderizar de novo; a prefeitura do push não vai para a tela da atividade.
- Menores da revisão final do Plano 7 que ficaram (relatório em `.superpowers/sdd/2026-10-29-notificacoes/final-review.md`; os itens 2, 3 e 4 foram corrigidos na migração 0035, no agendador e no despachante):
  - Grants das funções da fila (`0034`) para `app_user`: defesa em profundidade; fazer um papel `notifier` com pool próprio para o agendador e mover os grants para ele.
  - [x] Falha do banco: o agendador logava um erro a cada 5 s por instância: corrigido no pronto para validação (Task 11); loga só a primeira falha e avisa quando volta. Sem recuo exponencial.
  - Destinatários do sino (`0033`, `FROM users u WHERE EXISTS (memberships ...)`): confirmar o plano com `EXPLAIN` num banco com dados ou reescrever partindo de `memberships` com `DISTINCT u.id`.
  - [x] A pegada da fila (`0034`) só conferia `account_status` e `deleted_at`: corrigido no pronto para validação (Task 11, 0039): `work_order_*` exige agente `field_agent` ativo e presença na equipe da atividade, senão vira `skipped` (`not_in_team`).
  - O e-mail do cidadão não é verificado (`apps/api/src/me/routes.ts`), mas a conclusão passa a ser enviada a ele: decisão de produto (verificar o e-mail ou enviar só aos verificados).
  - [x] Sino que abre atividade já fora da fila caía em outra atividade sem aviso: corrigido no pronto para validação (Task 12); mostra "Esta atividade já saiu da fila." (conferido no navegador).
  - [x] Sessão revogada no servidor, expirada ou encerrada pelo logout offline deixava o token do aparelho no lugar: corrigido no pronto para validação (Task 11, 0039 e 0040): o congelamento e a recuperação de conta apagam o token ao revogar, e a renovação recusada apaga o token do aparelho da sessão morta. Sessão revogada que nunca tenta renovar mantém o token até o próximo logout ou registro.
  - Ordem de implantação: o gatilho da 0033 enche a fila assim que a migração roda; rodar a migração e subir a API juntas, ou anotar no checklist de deploy.
- **Entrega real de push com Firebase e Apple** (seções 3 e 4 do `0002`): continua no fim, depois dos testes em aparelho real.

## Pronto para validação

Feito no pronto para validação (`2026-10-31-pronto-para-validacao.md`, spec `docs/superpowers/specs/2026-10-31-pronto-para-validacao-design.md`): bairros no banco (malha do IBGE em `ibge_neighborhoods`, camada da prefeitura em `tenant_neighborhoods`, gatilho em `occurrences`), carga e volta da malha pelo backoffice, filtro de bairro no mapa e na lista do painel, mapa com a situação do prazo (quatro cores), faixa de números do dia e filtro de prazo, Dados da prefeitura (leitura, para o gestor e para o modo suporte), as seis abas novas da P3 (Contrato com edição e bairros, Equipes e agentes, Gestores, Categorias, Cidadãos mascarados pela API, Auditoria), correções de banco e API (Task 11) e do painel (Task 12). Capturas da passada em `docs/superpowers/plans/resultado-pronto-para-validacao/`.

- [x] Filtro por bairro no mapa e na lista do painel, sobre a lista consolidada (nenhum caminho grava o bairro a partir do texto do endereço).
- [x] Mapa do painel: pontos por situação do prazo (No prazo, Vence em até 2 dias, Atrasada, Na triagem), faixa de números clicável e filtro de prazo.
- [x] Dados da prefeitura (`/dados`), só leitura, para gestor e modo suporte.
- [x] P3: as seis abas além de Visão geral. Contrato e bairros só do Admin (muda o spec, que dizia "Admin e Suporte"); o Suporte vê o Contrato só para leitura e não vê a aba Auditoria.
- [x] Correções das seções 6b e Plano 7 marcadas nelas com `[x]`: recuperar conta com CPF liberado, pegada da fila, agendador, token de push, atividade fora da fila, cabeçalho `⋯` dos gestores, corte do menu `⋯`, abas da P3.

### Passada no navegador, 31/10/2026

Seed de desenvolvimento (`pnpm db:seed:dev`), `pnpm dev`, login com o código fixo. Bairros: a malha real do IBGE não foi importada (precisa de download e `mapshaper`); a passada usou um GeoJSON de quatro retângulos que cobre a área das ocorrências do seed (Vila Norte-Oeste, Jardim Nordeste, Bairro Sudoeste, Parque Sudeste), carregado pelo "Carregar arquivo de bairros" do backoffice. Por isso a fonte aparece como "enviados pela prefeitura". A importação da malha real do IBGE por UF (`import:neighborhoods`) só tem teste, sem execução real.

| Item                                       | Resultado                                                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapa sem bairros (`01`)                    | OK: sem o filtro "Bairro"; mapa, faixa e legenda carregam.                                                                                                                                                                             |
| Quatro cores e faixa (`02`)                | OK: verde, laranja, vermelho e cinza no zoom da cidade; faixa 'Na triagem 3', 'Em atendimento 7', 'Vencem em 2 dias 5', 'Atrasadas 1'.                                                                                                 |
| Clique no ponto (`03`)                     | OK: painel do ponto com 'Atrasada há 1 dia', relatos e 'Recusar'.                                                                                                                                                                      |
| Filtro de prazo (`04`, `05`)               | OK: 'Vencendo' reduz a 5 ocorrências; clicar 'Atrasadas' na faixa vai a `?status=em-atendimento&prazo=atrasadas` e mostra 1.                                                                                                           |
| Lista sem bairros (`06`)                   | OK: sem o filtro de bairro.                                                                                                                                                                                                            |
| Dados da prefeitura, gestor (`07`, `27`)   | OK: 'Nenhum bairro cadastrado' antes; '4 bairros cadastrados · enviados pela prefeitura' depois.                                                                                                                                       |
| Menu ⋯ da última linha (`08`, `09`, `10`)  | OK: Agentes, Gestores e Setores abrem o menu inteiro, sem corte; Gestores sem `⋯` no cabeçalho.                                                                                                                                        |
| P3 como Admin (`11` a `17`)                | OK: sete abas (Visão geral, Contrato, Equipes e agentes, Gestores, Categorias, Cidadãos, Auditoria). 'Consultou os cidadãos' aparece na auditoria depois de abrir Cidadãos.                                                            |
| Carga e volta da malha (`18` a `21`)       | OK: '4 bairros · enviados pela prefeitura'; confirmação de voltar; depois 'Nenhum bairro carregado.' (o seed não tem malha do IBGE); arquivo sem polígono recusado com o aviso do plano.                                               |
| Cidadãos mascarados (`22`)                 | OK: a resposta de `/backoffice/tenants/:id/citizens` só traz `phoneMasked` e `emailMasked`, sem CPF e sem celular ou e-mail inteiros.                                                                                                  |
| Mapa e lista com bairro (`23` a `26`)      | OK: filtro 'Bairro: todos / quatro bairros / Sem bairro'; `?bairro=Jardim+Nordeste` dá 2 ocorrências no mapa; 'Sem bairro' dá `?bairro=__none__`; a lista filtra (132 solicitações). A lista não ganhou coluna de bairro, só o filtro. |
| P3 como Suporte (`28`, `29`)               | OK: seis abas (sem Auditoria), Contrato só leitura, Cidadãos mascarados.                                                                                                                                                               |
| Dados da prefeitura em modo suporte (`30`) | OK: mesmo conteúdo, com a faixa do modo suporte.                                                                                                                                                                                       |
| Correção da Task 12 (`31`)                 | OK: `/revisao?atividade=<id fora da fila>` mostra 'Esta atividade já saiu da fila.' sem abrir outra.                                                                                                                                   |

Achados da passada:

- **API devolve CPF e e-mail inteiros ao Suporte e Admin** em `GET /backoffice/tenants/:id/managers` (campos `cpf` e `email` sem máscara; a tela mascara o CPF). O pedido era mascarar dado pessoal na API. Não corrigido nesta task; entra no "Em aberto".
- **Selo do prazo no painel do ponto**: 'Atrasada há 1 dia' sai no mesmo tom de aviso (amarelo) de 'Vence em até 2 dias'; atrasada e no prazo não se distinguem pela cor (`03`). Já anotado na Task 6.
- **Painel do ponto some o selo do prazo** quando o filtro de prazo deixa o ponto aberto fora dos resultados (`04`).
- **Mensagem de arquivo inválido com acentos graves** ('nome' e 'name' entre crases) aparece literal na tela (`21`); o texto aprovado do plano traz as crases.
- **Vigência do contrato do seed começa em 01/11/2026**, amanhã, por isso a P3 mostra 'cliente desde 01/11/2026' para uma prefeitura ativa (só dado do seed).
- **Setores**: o cabeçalho da coluna do menu ainda mostra `⋯` (`10`).

### Textos novos para o usuário confirmar

Os textos das Decisões do plano já foram aprovados. Abaixo, só o que quem implementou criou fora delas, mais o que a passada mostrou.

- **Dados da prefeitura (Task 7):** rótulos 'Nome de exibição', 'Município e UF', 'Código IBGE', 'Central de atendimento', 'Situação', 'Plano', 'Vigência', 'Usuários do painel'; 'A partir de dd/mm/aaaa' (contrato sem data final); 'Carregando…'; 'Não foi possível carregar os dados da prefeitura.'; '—' para campo vazio; 'Cidade · UF'.
- **Bairros na P3 (Task 8):** 'Nenhum bairro carregado.'; '{n} bairros · enviados pela prefeitura' ('· IBGE' para a malha do IBGE); nome acessível 'Arquivo de bairros' do campo de arquivo; 'Confira os dados e tente de novo.' (erro genérico da carga).
- **Vistos na passada:** 'Equipes da prefeitura e quantos agentes cada uma tem.', 'Gestores e admins da prefeitura, com os setores de cada um.', 'Categorias que o cidadão vê no app, com setor e prazo.' (aberturas das abas da P3, só leitura); 'Esta atividade já saiu da fila.' (Task 12, já estava nas Decisões).
- **Escolha de comportamento para confirmar:** o Suporte não vê a aba Auditoria da P3 nem o botão de salvar contrato (Contrato, bairros e Auditoria são só do Admin).

### Em aberto depois do pronto para validação

- **Mascarar CPF e e-mail na rota de gestores do backoffice** (`GET /backoffice/tenants/:id/managers`), do lado da API (Task 9; achado da passada).
- **Importar a malha real do IBGE** por UF (`pnpm --filter @alocidadao/db import:neighborhoods`) e conferir o tempo e o resultado com um município real; só a carga por arquivo da prefeitura foi vista no navegador.
- **Selo do prazo atrasada** com tom próprio (vermelho) no painel do ponto, e manter o selo quando o ponto aberto sai dos resultados do filtro.
- **Seed:** vigência do contrato da Prefeitura Demo A começando amanhã.
- **Setores:** tirar o `⋯` do cabeçalho da `DepartmentsPage`.
- **Task 4:** `?bairro=` com valor fora da lista da prefeitura aparece como opção; o plano diz "nomes só da lista consolidada" (ignorar como no caso sem bairros).
- **Task 10:** a leitura da lista de cidadãos só grava auditoria na primeira página, sem busca e sem filtro de situação; uma chamada direta com filtro não audita. Auditar a página 1 sem busca em qualquer situação e dar `staleTime` à consulta para a tela não auditar de novo ao refazer a busca.
- Menores das revisões, agrupados:
  - Banco: `replace_tenant_neighborhoods` aceita nome vazio, geometria que não é polígono e duplicata (23505 cru) e `[]` equivale a limpar (a API valida antes); `refresh` calcula `neighborhood_at` duas vezes por linha; texto de erro do `toMultiPolygon` fala "Município" para bairro; testes que faltam (`upsertIbge` recalculando ocorrências existentes, `refresh` com contagem > 0, `app_user` sem execução de `neighborhood_at`/`effective_neighborhoods` fora de contexto, membro comum chamando `replace`/`clear`); resumo do mapa com subconsulta correlacionada repetida e junção de categorias desnecessária; janela de ~1 s de erro perto das 23:59:59 de São Paulo nos testes do prazo.
  - API: corpo JSON malformado ou vazio no envio de bairros dá o 400 nativo do Fastify (sem `{ code }`) e o 413 acima de 10 MB não tem teste; `neighborhoodFeatureName` cai no `name` quando `nome` é vazio; polígono degenerado (área zero) pode virar vazio após `MakeValid` e dar 500 em vez de 422; PUT do contrato sem teste de atomicidade e `contractBodySchema` repete `displayName` e `centralPhone`; testes que faltam (`source: 'ibge'`, escopo de gestor com bairro, isolamento entre prefeituras de `/panel/neighborhoods`, gestor inativo e token de cidadão em `/panel/tenant-profile`, leituras da equipe que não geram auditoria, 403 de `q` da lista de cidadãos); o nome do cidadão buscado (`q`) aparece nos logs de requisição; LIKE com `_` e `\` sem teste; recuperação do agendador loga '…: normalizado'; JSDoc fora do lugar em `tenants.ts`; ordem de imports em `routes.ts`.
  - Web: `parseMapQuery` não normaliza `?status=abertas&prazo=…` escrito à mão; `__none__` cru na URL; sem testes de `/panel/neighborhoods` com falha e de `?bairro=` desconhecido, e a espera repete em 5xx; `ContractTab` não reinicia o formulário ao trocar de prefeitura; `fileError` não some depois de voltar para a malha; link `?aba=auditoria` pisca a Visão geral; parâmetro `pagina` pode vazar entre abas; `PAGE_SIZE` duplicado no web; aba Equipes e agentes sem a lista de agentes por equipe; token de cidadão em rota de equipe dá 403 (não 401); o selo da faixa não é `StatCard`; escolher 'abertas' no mapa também limpa o prazo.

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
- Cookie do painel: `Secure` só com `NODE_ENV=production`; atrás de proxy, conferir que o cookie sai com `Secure` (e `trustProxy`). (veio do Plano 5a)
- Domínio do painel: servir a API no mesmo prefixo do `VITE_API_URL` (o cookie tem `Path=/auth/panel`) ou reescrever o `Path`, como o proxy do Vite faz em desenvolvimento. (veio do Plano 5a)
- `/auth/panel/refresh` cai no limite de 20/min por IP de `/auth/*` (a rede da prefeitura junta muitos servidores num IP). (veio do Plano 5a)
- Fotos no painel: `S3_PUBLIC_ENDPOINT` de desenvolvimento aponta para o emulador Android (`10.0.2.2`), então as miniaturas não abrem no navegador; em produção, o endereço público do armazenamento vale para os dois. (veio do Plano 5a)
