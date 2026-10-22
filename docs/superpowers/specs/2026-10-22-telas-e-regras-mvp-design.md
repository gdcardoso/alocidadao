# Telas e regras do MVP — design

**Data:** 22/10/2026 · **Base:** `docs/planejamento-mvp.md`, `docs/design-system.md`, `docs/decisoes/0001-isolamento-por-prefeitura.md` · **Telas:** `design/alocidadao.pen` (Pencil)

Este documento consolida as decisões de produto tomadas ao desenhar as telas do MVP. Onde ele diverge do planejamento original, **ele prevalece**. A seção 9 lista o que muda no código que já existe.

## 1. Intenção

O Alô Cidadão liga o cidadão à prefeitura num ciclo fechado: o cidadão relata com foto, a prefeitura agrupa relatos do mesmo problema, uma equipe resolve em campo, o gestor revisa o que será comunicado e o cidadão confirma. É um produto SaaS sem cliente ainda; o MVP precisa ser demonstrável e vendável.

Três ideias guiam as decisões:

1. **Rapidez para o cidadão.** Registrar um problema são poucos toques; se der trabalho, ele desiste.
2. **A prefeitura controla o que o cidadão vê.** Nada do agente chega ao cidadão sem revisão do gestor.
3. **Um problema real, vários relatos.** Relatos do mesmo problema são agrupados numa ocorrência; resolver a ocorrência responde a todos.

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos do MVP**

- Cidadão: cadastro pelo celular, registro com foto, acompanhamento por status, confirmação ou contestação.
- Agente: lista de atividades, execução com fotos, relato de impedimento, uso offline.
- Gestor (WEB): mapa, triagem, agrupamento, atribuição, revisão, impedimentos, equipes e categorias.
- Equipe Alô Cidadão (backoffice): criar e acompanhar prefeituras, dar suporte dentro de cada uma, ver o interesse de novas cidades.

**Não-objetivos (depois do MVP):** solicitação de serviços (IPTU etc.), editor visual de workflows, relatórios, SLAs automáticos, mapa público de solicitações, login Gov.br, cobrança, publicação automática sem revisão, envio real de SMS (ver 3.1).

**Antiobjetivos — seria falha mesmo funcionando:**

- Expor ao cidadão texto ou foto do agente sem revisão.
- Mostrar a um cidadão dados de outro (fotos, nomes, histórico), inclusive por número de telefone reaproveitado.
- Fechar a solicitação de alguém por agrupamento errado sem o gestor ter confirmado.
- Cadastro ou registro com passos que não mudam o resultado.

## 3. Conta, acesso e perfis

### 3.1 Entrada pelo celular (sem senha)

- O cidadão digita o celular (+55). No Android, o app pode sugerir o número do chip (Phone Number Hint); no iPhone não há como ler o número.
- Um código de 6 dígitos confirma a posse da linha. **No desenvolvimento não há provedor de SMS:** o backend aceita um código fixo configurável por variável de ambiente, só fora de produção. **Antes de produção, integrar um provedor** (SMS ou WhatsApp); sem isso o telefone não protege nada.
- Não existe senha. Entrar, trocar de aparelho e reinstalar usam o mesmo fluxo celular + código.
- A sessão fica sempre ativa até "Sair". Ao sair, o app apaga os dados offline do aparelho.
- Primeiro acesso: tela "Quase lá" com **nome (obrigatório)**, **e-mail (opcional, de recuperação)** e aceite dos Termos e da Política de Privacidade. **Não há campo de cidade** (ver 4).

### 3.2 Telefone é login, não identidade

- A conta tem um id interno; o telefone é um atributo único e trocável.
- **Trocar número** (Perfil): verifica o novo número por código; o histórico continua.
- **Número reaproveitado:** se alguém entra com um número num aparelho novo (id de instalação do app nunca visto para aquela conta, guardado em `devices`) e a conta está **sem uso há 90 dias ou mais**:
  - conta com e-mail → pede o código enviado ao e-mail;
  - conta sem e-mail → não mostra o histórico; cria uma conta nova com o número. A conta antiga fica congelada (não apagada), recuperável pelo e-mail ou pelo atendimento.
  - conta com e-mail, mas a pessoa não consegue o código → mesmo caminho da conta sem e-mail (conta nova; a antiga congelada). Nunca mostrar o histórico sem a verificação. _(Decisão de design — revisar.)_
- **Excluir conta** (Perfil), exigência da LGPD, com confirmação.

### 3.3 Perfis no mesmo app

- Perfis: `citizen`, `field_agent` (app) e `manager`, `tenant_admin` (WEB), além de `platform_admin`.
- **O agente não se cadastra sozinho.** O gestor/admin o cadastra no painel (nome, celular, equipe); ele aparece como "Convidado" até o primeiro acesso.
- Após o login, o app lê os vínculos: só agente → "Minhas atividades"; só cidadão → "Minhas solicitações"; os dois → troca de modo no Perfil, lembrando o último usado.
- **Login é sempre da pessoa.** Em aparelho da prefeitura, o agente entra com o número pessoal; o código chega no celular dele.
- Desativar o vínculo no painel tira o acesso ao modo agente no próximo uso.

### 3.4 Acesso ao painel WEB

- Gestores e admins entram com **CPF + código de 6 dígitos enviado ao e-mail cadastrado** (mostrado mascarado). Sem senha e sem SMS.
- O sistema valida os dígitos verificadores do CPF. CPF não é segredo; quem prova a identidade é o código no e-mail.
- E-mail transacional via **Resend** (plano gratuito: 100 e-mails/dia, 3.000/mês), com o domínio **alocidadao.com.br** verificado (remetente sugerido: `nao-responda@alocidadao.com.br`). O mesmo domínio dá o identificador do app nas lojas, `br.com.alocidadao.app`. O mesmo serviço envia o código de recuperação do cidadão (3.2).
- **Cadastro de gestores:** o admin da prefeitura cadastra nome, CPF, e-mail e setores na aba "Gestores" (W6b). A **prefeitura e o admin da prefeitura** são criados no backoffice (3.6).
- A equipe Alô Cidadão entra pelo mesmo login (CPF + código no e-mail).
- Futuro: entrar com Gov.br (usa o CPF).

### 3.6 Backoffice Alô Cidadão

Área interna da empresa, no mesmo painel WEB, com menu próprio (Prefeituras, Interesse por cidade, Equipe Alô Cidadão, Auditoria).

- **Papéis internos:** **Admin** (tudo: criar/suspender prefeituras, contratos, equipe interna) e **Suporte** (entra em qualquer prefeitura e faz toda a gestão dela; não mexe em contratos nem na equipe interna).
- **P1 Prefeituras:** carteira com status (em implantação, ativa, suspensa), plano, cidadãos, abertas, tempo médio e alertas (revisão parada, impedimentos parados, configuração incompleta).
- **P2 Nova prefeitura:** município pelo código IBGE, **limite importado automaticamente da API de malhas do IBGE**, nome de exibição, telefone da central, contrato (plano, vigência, usuários do painel incluídos — só registro, sem cobrança), admin da prefeitura (nome, CPF, e-mail) e cópia do catálogo padrão de categorias. Nasce "em implantação"; só aparece para cidadãos quando ativada.
- **P3 Detalhe da prefeitura:** abas Visão geral, Contrato, Equipes e agentes, Gestores, Categorias, Cidadãos, Auditoria; ativar/suspender; **"Entrar no painel da prefeitura"**.
- **P4 Modo suporte:** a equipe interna usa **as mesmas telas do painel da prefeitura** (W1–W7), com uma faixa fixa "Você está na Prefeitura X como equipe Alô Cidadão" e "Sair da prefeitura". Pode ver dados pessoais e agir como o admin da prefeitura.
- **Auditoria:** toda ação da equipe Alô Cidadão dentro de uma prefeitura (entrar, ver, alterar) é registrada (quem, quando, prefeitura, ação, alvo). Não bloqueia nada; a prefeitura pode consultar o registro. O contrato com as prefeituras deve prever esse acesso do operador para suporte.
- **"Cidadãos de uma prefeitura"** = pessoas com ao menos uma solicitação nela.
- **P5 Interesse por cidade:** ranking dos pedidos "Quero o Alô Cidadão aqui" por município, com situação comercial editável e exportação CSV. Guarda só o município, não o local exato.
- **P6 Equipe Alô Cidadão:** pessoas internas (nome, CPF, e-mail, papel).

### 3.5 Setores e alcance

- **Setores continuam existindo** (como no planejamento): cada categoria pertence a um setor e cada equipe a um setor. O **gestor** vê e age só nas ocorrências das categorias dos setores que gerencia (`department_managers`); o **admin da prefeitura** vê tudo da prefeitura. A atribuição (W2) lista as equipes do setor da categoria.

## 4. Prefeitura pela localização

- **A prefeitura de uma solicitação é a do local da foto**, decidido pelo limite oficial do município (`tenants.boundary`), não pela cidade de cadastro.
- Ao abrir "Nova solicitação", o app identifica o município: se a prefeitura é cliente ativa, mostra os tipos dela; se não, mostra a **tela 5c** ("ainda não usa o Alô Cidadão"), com orientação de contato (central da prefeitura, genérico "156") e o botão **"Quero o Alô Cidadão aqui"**, que registra interesse por município (dado comercial).
- O **histórico do cidadão é visível em qualquer lugar.**
- O topo de "Minhas solicitações" mostra "Você está em {cidade}".
- Sem permissão de localização, o app pede a permissão antes do registro (tela simples, ainda não desenhada).
- **Ajuste do local (botão "Ajustar" na tela 5):** o cidadão pode mover o ponto no mapa até **200 m** do GPS da foto. O servidor guarda os dois pontos (GPS original e ajustado), decide a prefeitura e as ocorrências parecidas pelo ajustado e recusa ajustes acima do limite. _(Decisão de design — revisar.)_
- **Registro sem rede:** o app guarda a lista de tipos da última prefeitura em que esteve. Sem rede, o cidadão registra com essa lista e a solicitação vai para a fila; **a 5b não aparece offline**. Ao sincronizar, o servidor decide a prefeitura pelo ponto: se não for cliente (ou o tipo não existir nela), a solicitação é recusada e o app mostra a mensagem da 5c naquele item da fila; se houver ocorrência parecida, cria ocorrência nova e a sugestão fica para a triagem do gestor (sem agrupar sozinho). _(Decisão de design — revisar.)_

## 5. Solicitação, ocorrência e agrupamento

### 5.1 Conceitos

- **Solicitação:** o relato de um cidadão (fotos, observação, local, protocolo próprio). É o que ele acompanha.
- **Ocorrência:** o problema real. Agrupa uma ou mais solicitações da mesma categoria. **A equipe trabalha na ocorrência.**
- Toda solicitação pertence a exatamente uma ocorrência (uma ocorrência nova é criada para a primeira).

### 5.2 Raio de agrupamento

- Cada categoria tem um **raio de agrupamento em metros**, configurável pela prefeitura (tela W7). Valores iniciais sugeridos: semáforo 50, animal 50, lixo 30, iluminação 25, poda 20, esgoto 20, buraco 15.
- "Parecida" = mesma categoria, dentro do raio, ocorrência ainda não encerrada.

### 5.3 Quem agrupa

1. **O cidadão, no registro (tela 5b).** Depois de escolher o tipo, se houver ocorrência parecida, aparece "Já relataram isso aqui perto" com tipo, distância, número de relatos e status — **sem fotos nem nomes de outros cidadãos**. "É o mesmo, apoiar relato" cria a solicitação dele ligada àquela ocorrência; "Não, é outro problema" cria ocorrência nova.
2. **O gestor, na triagem (W1/W5).** O sistema **sugere**; o gestor junta ("Juntar a este ponto") ou separa ("Separar desmarcados"). **Nunca há agrupamento automático sem confirmação humana**, exceto o apoio explícito do próprio cidadão.

**Regras de junção** _(decisão de design — revisar)_: só se juntam ocorrências da mesma categoria em que **no máximo uma** tem atividade ativa. A ocorrência com atividade é a que fica; as solicitações da outra passam para ela e a outra é encerrada como "juntada" (interno). Se as duas têm atividade ativa, o painel bloqueia e pede para cancelar uma antes. Separar cria uma ocorrência nova, em triagem, com as solicitações desmarcadas.

### 5.4 Efeitos

- Concluir a ocorrência (após revisão, seção 7) leva **todas** as solicitações ligadas a "Aguardando confirmação"; cada cidadão confirma ou contesta.
- **Contestação:** a ocorrência volta à triagem do gestor. As solicitações ligadas que ainda estão em "Aguardando confirmação" voltam a "Aberta", com o aviso "Outro morador informou que o problema continua; a prefeitura vai reavaliar". As que **já foram confirmadas continuam "Concluídas"**.
- **Elegível para agrupamento** = ocorrência em triagem ou em atendimento. Enquanto aguarda confirmação, concluída ou recusada, um relato novo no mesmo lugar vira ocorrência nova; o gestor vê a sugestão de agrupamento na triagem.
- Recusar a ocorrência recusa todas as solicitações ligadas, com o mesmo motivo público.
- O status "Duplicada" deixa de existir.

## 6. Status

### 6.1 Solicitação (o que o cidadão vê)

| Status                 | Quando                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| Aberta                 | Criada; ocorrência aguardando triagem ou reaberta                               |
| Em atendimento         | Ocorrência atribuída a uma equipe (inclui execução, revisão e ajustes internos) |
| Aguardando confirmação | Gestor publicou a conclusão                                                     |
| Concluída              | Cidadão confirmou, ou 7 dias sem resposta                                       |
| Recusada               | Gestor recusou a ocorrência, com motivo público                                 |
| Cancelada              | Cidadão cancelou enquanto Aberta                                                |

- **Impedimento não aparece para o cidadão:** a solicitação continua "Em atendimento" enquanto o gestor decide e depois de reatribuir ou reagendar. Só "recusar" muda o status (para "Recusada"). Isso substitui a regra antiga do planejamento (impedimento → "Aberta").
- Cancelar só é possível em "Aberta". Se a ocorrência tiver outras solicitações, só a do cidadão sai.
- **O cidadão vê o tempo decorrido no status atual** ("Aberta há 3 dias", "Em atendimento há 2 dias"). **O prazo interno não é mostrado ao cidadão.**
- Contestar exige comentário (foto opcional) e devolve a solicitação para "Aberta".

### 6.2 Atividade de campo (interno)

| Status             | Quem leva até ele                                               |
| ------------------ | --------------------------------------------------------------- |
| Atribuída          | Gestor atribui a ocorrência a uma equipe                        |
| Em execução        | Agente toca em "Iniciar atendimento"                            |
| Aguardando revisão | Agente conclui (fotos + relato)                                 |
| Ajuste pedido      | Gestor devolve ao agente (novas fotos, relato, voltar ao local) |
| Impedida           | Agente relata impedimento                                       |
| Concluída          | Gestor publica a conclusão                                      |
| Cancelada          | Gestor reatribui, reagenda para outra equipe ou recusa          |

- "Ajuste pedido" → agente reenvia → "Aguardando revisão". Cada devolução fica no histórico interno.
- Impedimento → gestor decide: **reatribuir** (nova atividade para outra equipe), **reagendar** (mesma equipe, nova data) ou **recusar** (motivo público).
- No máximo uma atividade ativa por ocorrência.

## 7. Revisão do gestor

- A conclusão do agente **não chega ao cidadão** até o gestor publicar (tela W3).
- O gestor vê o **relato original do agente (interno, preservado para auditoria)** e escreve o **texto público** (pré-preenchido com o relato). Marca quais fotos publicar (lembrete: rostos e placas).
- "Publicar para os cidadãos" → atividade Concluída, solicitações em "Aguardando confirmação", aviso a todos.
- "Devolver ao agente" (W3b): motivos marcáveis, fotos a descartar, mensagem obrigatória. O cidadão continua vendo "Em atendimento".
- A fila mostra há quanto tempo cada item espera; itens com mais de 24 h aparecem destacados.
- Publicação automática por tempo ou por categoria fica para depois do MVP.

## 8. Telas

Todas no Pencil, organizadas por seção e tema. Estilo e tokens em `docs/design-system.md`.

**App — cidadão**

| Tema              | Telas                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Cadastro e acesso | 0 Abertura (logo e grafismo da marca) · 1 Entrar (celular) · 2 Código · 3 Seus dados                        |
| Nova solicitação  | 5 Nova solicitação · 5b Já relataram aqui (painel sobre a 5) · 5c Prefeitura não aderiu                     |
| Acompanhar        | 4 Minhas solicitações · 6a Aberta · 6b Em atendimento · 6c Aguardando confirmação · 6d Recusada · 7 Galeria |
| Perfil            | 8 Perfil                                                                                                    |

**App — agente**

| Tema                    | Telas                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atividades              | A1 Minhas atividades (lista/mapa, ordenada pela distância, selo "Nova") · A2 Detalhe (instruções do gestor, rota, fotos e relatos dos cidadãos) · A5 Ajuste pedido |
| Concluir ou impedimento | A3 Concluir atendimento · A4 Não consigo resolver                                                                                                                  |

**Painel WEB**

| Tema              | Telas                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| Acesso ao painel  | W0a Entrar (CPF) · W0b Código do e-mail                                               |
| Mapa e atribuição | W1 Mapa de ocorrências (pontos agrupados, painel do ponto) · W2 Atribuir a uma equipe |
| Triagem           | W5 Triagem (lista)                                                                    |
| Revisão           | W3 Aguardando revisão · W3b Devolver ao agente                                        |
| Impedimentos      | W4 Impedimentos                                                                       |
| Configurações     | W6 Equipes e agentes · W6b Gestores · W7 Categorias                                   |

**Backoffice Alô Cidadão**

| Tema                       | Telas                                                          |
| -------------------------- | -------------------------------------------------------------- |
| Prefeituras                | P1 Prefeituras · P2 Nova prefeitura · P3 Detalhe da prefeitura |
| Suporte às prefeituras     | P4 Painel em modo suporte                                      |
| Comercial e equipe interna | P5 Interesse por cidade · P6 Equipe Alô Cidadão                |

Comportamentos que as telas não mostram sozinhas:

- **Fotos:** até 3 por solicitação e até 3 por conclusão, tiradas na hora, reduzidas no aparelho (~1600 px, ~300 KB). Várias fotos aparecem como **pilha** (componente "Pilha de fotos"); tocar abre a **galeria** em tela cheia com carrossel. Uma foto só aparece sem pilha.
- **Offline:** o cidadão pode registrar sem rede (vai para a fila); o agente executa, conclui e relata impedimento sem rede. Avisos de "sem conexão" nas telas.
- **Local na conclusão (A3):** o app compara com o local da ocorrência e registra a distância; longe, avisa mas **não bloqueia**.
- **Atribuição (W2):** equipe (a mais próxima sugerida), prazo interno (padrão da categoria), instruções para o agente (opcionais, invisíveis ao cidadão). Avisa a equipe por push.
- **Instruções do gestor** aparecem no topo da atividade do agente (A2).

## 9. Mudanças no código existente

O banco (`packages/db`) e as regras (`packages/shared`) foram feitos antes destas decisões. Ainda não há dados reais, então as mudanças entram como novas migrações sem preocupação com dados.

**Modelo**

- Nova tabela `occurrences` (tenant, categoria, local central, status, timestamps), com RLS e FK composta como as demais.
- `requests`: ganha `occurrence_id`; perde `duplicate_of_id`; status sem `duplicate`.
- `work_orders`: passa a apontar para `occurrence_id` (não `request_id`); ganha `manager_instructions`, `agent_note` (relato original), `public_note` (texto publicado), status `awaiting_review` e `rework_requested`; índice "uma ativa por ocorrência".
- Fotos da conclusão com indicação de publicada/descartada; registro das devoluções (motivos + mensagem) no histórico.
- `categories`: ganha `cluster_radius_m` e `icon_group` (`infrastructure`, `environment` ou `public_services`, que define a cor do ícone; ver `docs/design-system.md`).
- `users`: `phone` único (E.164), obrigatório para quem usa o app; `cpf` único, obrigatório para quem usa o painel; `email` opcional para cidadão e obrigatório para gestor/admin; **sem `password_hash`**; `last_active_at` para a regra dos 90 dias; estado de conta congelada. A função de login `auth_find_user_by_email` é substituída por buscas por telefone e por CPF.
- `memberships`: ativo/inativo e "convidado" para agentes que ainda não entraram.
- Nova tabela de **interesse por município** (código IBGE, usuário, data) para o botão "Quero o Alô Cidadão aqui". Não pertence a uma prefeitura cliente.
- Registro de **códigos de verificação** (telefone e e-mail) com expiração e limite de tentativas.
- `tenants`: status (em implantação, ativa, suspensa) no lugar de `active`, telefone da central, nome de exibição.
- Nova tabela de **contrato** por prefeitura (plano, vigência, usuários incluídos).
- Papéis internos no lugar do booleano `is_platform_admin`: **admin** e **suporte** da plataforma.
- Nova tabela de **auditoria** (só inserção) para ações da equipe interna dentro de prefeituras; legível pela prefeitura via RLS.
- Interesse por município ganha **situação comercial**.
- **Isolamento:** a equipe interna continua operando dentro de uma prefeitura pelo contexto (`withContext`), como previsto na decisão 0001; os números entre prefeituras (P1) vêm de funções específicas do banco que devolvem agregados.

**Regras (`packages/shared`)**

- Transições da solicitação conforme 6.1 (sem `mark_duplicate`); transições da atividade conforme 6.2; ação de apoiar/ligar a uma ocorrência.

**Consulta geográfica**

- Município pelo ponto: `ST_Contains(tenants.boundary, ponto)` entre prefeituras ativas.
- Ocorrências parecidas: mesma categoria, ocorrência aberta/em atendimento, `ST_DWithin` com `cluster_radius_m` (em geografia, metros).

## 10. Deixado para quem implementa

- Bibliotecas e componentes do app e do painel, rotas da API, formato de paginação.
- Como o mapa agrupa pontos em cada zoom (clustering) e qual provedor de tiles OpenStreetMap usar, desde que sem custo no MVP.
- Mensagens exatas de erro e de estados vazios, seguindo o design system.
- Tela de permissão de localização negada.
- Valores iniciais exatos de raio e prazo por categoria (os da seção 5.2 são ponto de partida).

## 11. Ainda em aberto

- Catálogo padrão de categorias que toda prefeitura nova recebe.
- Quantas contestações por solicitação antes de exigir decisão do gestor.
- Provedor de SMS/WhatsApp para produção.
- Modelo de cobrança das prefeituras.
