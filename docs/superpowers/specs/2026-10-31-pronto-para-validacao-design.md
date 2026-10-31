# Pronto para validação — design

**Data:** 31/10/2026 · **Base:** `docs/planejamento-mvp.md`, `docs/superpowers/specs/2026-10-26-telas-painel-pencil.md` (W1), `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md` (P3), `docs/superpowers/specs/2026-10-28-backoffice-6b-design.md`, `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`

Os Planos 1 a 7 entregaram todas as telas desenhadas. Este pacote fecha o que falta para a equipe testar em aparelhos reais e, depois, demonstrar o sistema a uma prefeitura. A infraestrutura (Plano 8) vem depois: a nuvem só é contratada quando chegar a hora de validar.

## 1. Intenção

O usuário quer **deixar o sistema pronto para validação**. A primeira validação é da equipe, em aparelhos reais; a segunda é uma demonstração para uma prefeitura.

Ideias que guiam as decisões:

1. **Quem faz a gestão, ao entrar, vê como andam as solicitações**: onde estão, quantas são e se o prazo está sendo cumprido.
2. **Bairro só a partir de uma lista consolidada.** Nunca do texto que o celular ou o cidadão devolve, que pode vir com erro, abreviação ou nomes diferentes entre Apple e Google.
3. **A prefeitura opera e a equipe interna cadastra.** O admin da prefeitura cuida de equipes, agentes, gestores, categorias e setores. Os dados cadastrais da prefeitura ele só lê; quem cria e edita é a equipe Alô Cidadão.
4. **Dado pessoal de cidadão não sai completo da API para a equipe interna.** O mascaramento é feito no servidor.
5. **Este pacote não passa pelo Pencil.** As telas seguem o visual que já existe no código (decisão do usuário em 31/10, que muda a regra 3 do design do 6b só para este pacote). Passar para o Pencil fica para depois, junto com a Task 1b.

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- Mapa do painel (W1) com a situação do prazo e uma faixa de números (seção 3).
- Bairros consolidados e filtro por bairro no painel (seção 4).
- Tela "Dados da prefeitura" no painel, só para leitura (seção 5).
- Abas da P3 no backoffice, incluindo a lista de cidadãos (seção 6).
- Correções escolhidas das pendências (seção 7).

**Não-objetivos (ficam para depois)**

- E-mail de convite a gestor ou agente novo, e as páginas de Termos e Privacidade (decisão do usuário: podem esperar a validação).
- Infraestrutura (Plano 8), provedor de SMS, push real com Firebase e Apple e domínio no Resend. Dependem de contas que ainda vão ser abertas.
- Tela de início separada com gráficos (a opção B dos esboços foi descartada).
- A prefeitura consultar a auditoria dela.
- Passar as telas para o Pencil (Task 1b do 6b, sino do Plano 7 e as telas deste pacote).

**Antiobjetivos**

- O filtro por bairro aparecer numa prefeitura sem bairros cadastrados, ou mostrar nomes que não vêm da lista consolidada.
- Celular, e-mail ou CPF completos de cidadãos chegando ao navegador da equipe interna, mesmo que a tela mascare.
- O admin da prefeitura conseguir mudar contrato, plano, nome ou central pelo painel.

## 3. Mapa com a situação do prazo (W1)

O gestor continua entrando pelo mapa (opção A dos esboços, escolhida pelo usuário).

**Prazo de uma ocorrência** é o `due_at` da atividade ativa dela (`work_orders`). A ocorrência na triagem não tem atividade, logo **não tem prazo** (decisão do usuário).

| Situação  | Quando                                                         | Cor do pino |
| --------- | -------------------------------------------------------------- | ----------- |
| Sem prazo | na triagem, ou com atividade sem `due_at`                      | cinza       |
| No prazo  | dia do prazo depois de depois de amanhã                        | verde       |
| Vencendo  | dia do prazo hoje, amanhã ou depois de amanhã, sem ter passado | amarelo     |
| Atrasada  | `due_at` já passou                                             | vermelho    |

- A conta é feita em **dias do calendário de São Paulo**, como o `due-date.ts` atual e as etiquetas "Vence hoje" e "Vence em 3 dias", e não em horas. Atrasada compara o `due_at` exato com o agora. **Escolha minha.** A regra mora num lugar só (no banco ou na API, quem executa decide), e o pino, a faixa, o filtro e as listas leem dali.
- Janela de 2 dias para "vencendo": **escolha minha**. Fica numa constante do `shared`, para mudar sem caçar números no código.
- Os pinos **mantêm o tamanho e o número de relatos**; só a cor deixa de vir da quantidade de relatos e passa a vir do prazo. Um ponto com várias ocorrências usa a pior situação (atrasada > vencendo > no prazo > sem prazo). **Escolha minha.**
- **Legenda nova**, "Situação do prazo", com as quatro cores e a nota "Número = relatos no ponto". Ela substitui a legenda "Ocorrências por ponto".
- **Faixa de números** no topo do mapa, abaixo da barra de filtros: "Na triagem", "Em atendimento", "Vencem em 2 dias" e "Atrasadas". As contas respeitam categoria, período, bairro e os setores do gestor. **Ignoram os filtros de status e de prazo**, então a faixa sempre mostra o quadro inteiro.
- **Filtro de prazo**, novo, ao lado do filtro de status que já existe (`open_and_in_progress`, `open`, `in_progress`). Valores: "Prazo: todos", "Vencendo", "Atrasadas", "No prazo". O filtro de status antigo continua.
- **Cliques na faixa** (escolha minha):
  - "Na triagem" põe status = `open` e limpa o prazo.
  - "Em atendimento" põe status = `in_progress` e limpa o prazo.
  - "Vencem em 2 dias" e "Atrasadas" põem prazo = vencendo ou atrasadas e status = `in_progress`, porque só quem está em atendimento tem prazo.
  - O número ativo fica destacado. Clicar nele de novo volta para status = `open_and_in_progress` e prazo = todos.
  - Escolher prazo com status = `open` no filtro troca o status para `in_progress`, então não existe combinação vazia por construção.
  - Os filtros ficam na URL, como os de hoje (`?prazo=`).
- No painel do ponto, a etiqueta de tempo ganha o prazo: "Vence em 3 dias", "Vence hoje" ou "Atrasada há 2 dias".

Visual: os mesmos tokens e componentes do painel atual. Esboço de referência em `.superpowers/brainstorm/` (opção A), que não é desenho final.

## 4. Bairros

**Origem:** uma tabela de bairros com nome e contorno por município. A carga inicial vem da **Malha de Bairros do Censo 2022 do IBGE** (cerca de 17,5 mil bairros, só dos municípios que têm bairros definidos em lei). O arquivo vem por UF ou para o Brasil inteiro, em shapefile ou GeoPackage, no site de malhas do IBGE. Assim como `import-municipalities.ts`, há um script rodado à mão com o dono do banco.

**Duas camadas** (escolha minha):

- A malha do IBGE é **dado de referência por município**, como `municipalities`: fica fora do isolamento por prefeitura e é só leitura para `app_user`. Uma prefeitura criada depois num município que está na malha já começa com bairros.
- A carga enviada pela prefeitura é uma **camada própria da prefeitura**, com RLS. Quando ela existe, vale no lugar da malha do IBGE para aquela prefeitura. Apagar a camada própria volta para a malha do IBGE.
- "Bairros da prefeitura" = a camada própria, se houver, senão a malha do IBGE do município dela. A origem que o painel mostra sai daí.

**Carga pela prefeitura:** se a prefeitura não está na malha do IBGE (ou quer a lista dela), ela envia a lista ou o mapa e a **equipe Alô Cidadão** carrega. **Escolha minha:**

- A carga é feita no backoffice, na aba Contrato da P3 (seção 6), por um arquivo GeoJSON com um polígono por bairro e o nome numa propriedade.
- Cada carga substitui inteira a camada própria anterior.
- Há também a ação "Voltar para a malha do IBGE", que apaga a camada própria.
- As duas ações ficam na auditoria.
- Uma lista só de nomes, sem mapa, não basta, porque sem contorno não dá para decidir o bairro pelo ponto. Nesse caso a equipe transforma a lista em mapa antes de carregar.

**Bairro da solicitação:** o servidor decide o bairro pelo ponto da ocorrência (em qual contorno ele cai) e grava na ocorrência. Fica igual no iPhone, no Android e no registro offline. **Escolhas minhas:**

- O bairro é guardado na ocorrência, não em cada solicitação, porque o mapa e as listas filtram ocorrências.
- Ponto fora de todos os contornos fica "sem bairro".
- Ao carregar ou trocar os bairros de uma prefeitura (carga própria, volta ao IBGE ou importação nova da malha), as ocorrências afetadas são recalculadas. Uma prefeitura nova não tem ocorrências, então não há o que recalcular.
- Ao juntar ocorrências ou mover o ponto, o bairro é recalculado.

**Filtro:** "Bairro: todos" no mapa (W1) e nas listas "Em atendimento" e "Todas as solicitações". O filtro **só aparece se a prefeitura tem bairros cadastrados**: a tela sempre pergunta à API antes (decisão do usuário). A lista do filtro mostra os bairros da prefeitura em ordem alfabética, mais "Sem bairro".

O texto de endereço que o celular devolve continua sendo mostrado como está. Ele não alimenta o filtro.

## 5. Dados da prefeitura (painel)

Item novo "Dados da prefeitura" no grupo **CONFIGURAR** do menu, para admin e gestor. **Escolha minha:** os dois veem, e o modo suporte também.

Só leitura, em blocos:

- **Prefeitura:** nome de exibição, município e UF, código IBGE, central de atendimento e situação (em implantação, ativa).
- **Contrato:** plano, vigência e usuários do painel ("{n} de {incluídos} incluídos").
- **Bairros:** "{n} bairros cadastrados" com a origem (IBGE ou enviada pela prefeitura), ou "Nenhum bairro cadastrado".

Nota fixa no rodapé: "Para alterar estes dados, fale com o suporte do Alô Cidadão." Nenhuma rota de escrita é aberta para o painel.

A contagem de "usuários do painel" ainda não tem regra (pergunta aberta da P3: "18 = gestores + agentes? não bate"). **Escolha minha:** contam os vínculos ativos de admin, gestor e agente, cada pessoa uma vez. A mesma regra vale na P3.

## 6. Abas da P3 (backoffice)

As seis abas que hoje não existem passam a existir:

| Aba                   | O que faz                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contrato**          | Edita os dados cadastrais e o contrato: nome de exibição, central, plano, vigência e usuários incluídos. Também faz a carga dos bairros (seção 4). Só Admin e Suporte da equipe, com auditoria. |
| **Equipes e agentes** | Lista das equipes e dos agentes, só leitura, com botão "Abrir no painel" que entra no modo suporte nessa tela.                                                                                  |
| **Gestores**          | Lista dos gestores e admins, só leitura, com "Abrir no painel".                                                                                                                                 |
| **Categorias**        | Lista das categorias, só leitura, com "Abrir no painel".                                                                                                                                        |
| **Cidadãos**          | Lista dos cidadãos da cidade (abaixo).                                                                                                                                                          |
| **Auditoria**         | A tela de Auditoria (P7) já filtrada por esta prefeitura.                                                                                                                                       |

O "Gerenciar" dos cartões da Visão geral leva à aba correspondente. **Escolhas minhas:** a edição do contrato altera o contrato vigente (não cria histórico de contratos), e as listas só leitura reaproveitam as consultas do painel.

### Cidadãos

- **Quem entra:** quem fez ao menos uma solicitação nesta prefeitura. É o mesmo critério do número "Cidadãos" da P1 e da P3. Uma pessoa pode aparecer em mais de uma cidade. Contas excluídas não aparecem.
- **Colunas:** nome, celular mascarado, e-mail mascarado, solicitações nesta cidade (total e abertas), última solicitação, último acesso e situação.
- **Situação:** **Ativo** quando usou o app nos últimos 90 dias (`users.last_active_at`), **Inativo** quando passou de 90 dias, **Bloqueada** quando a conta está congelada. Proposta minha, que o usuário deixou em aberto ("podemos definir"), alinhada com a regra dos 90 dias do login.
- **Mascaramento na API** (decisão do usuário): o dado completo nunca sai do servidor nesta rota.
  - Celular: só DDD e os 4 últimos dígitos, `(15) •••••-1234`.
  - E-mail: o `maskEmail` que já existe.
  - CPF: **não sai nesta rota**, nem mascarado. Não é coluna nem entra na busca. **Escolha minha**, a mais estrita. Se um dia o CPF precisar aparecer, o formato é `•••.456.789-••`, sempre montado na API.
- **Auditoria:** abrir a lista grava uma ação na auditoria ("Consultou os cidadãos"). **Escolha minha.**
- Busca por nome, filtro por situação e paginação de 50 em 50, como na P7. Ordem padrão: última solicitação, mais recente primeiro.
- Sem ações sobre o cidadão nesta aba: recuperar conta, liberar CPF e outras continuam onde já estão.

## 7. Correções das pendências que entram

Entram as que aparecem numa demonstração ou deixam dado errado. O resto continua em `2026-10-22-spikes-pendencias.md`.

- Sino que abre uma atividade que já saiu da fila: mostrar "Esta atividade já saiu da fila" (`apps/web/src/work/WorkQueueLayout.tsx`).
- Recuperar conta congelada com CPF já liberado dá 500: `AND u.cpf IS NOT NULL` em `platform_recover_frozen_account`, que passa a responder `invalid_code`.
- Corte do menu ⋯ em `ManagersPage`, `AgentsTable` e `DepartmentsPage`, e o cabeçalho `⋯` da tabela de gestores.
- Sessão revogada no servidor apaga o token de push do aparelho (`apps/api/src/auth/app-routes.ts`).
- A pegada da fila de avisos reconfere o vínculo `field_agent` nos avisos `work_order_*`.
- O agendador para de logar um erro a cada 5 s quando o banco cai (loga só na mudança de estado).
- Erros 5xx respondem `{ code: 'internal_error' }` sem a mensagem interna. Vem do Plano 8, mas aparece na demonstração.

## 8. Restrições

- Mesmas regras dos planos anteriores: isolamento por prefeitura com RLS, funções `SECURITY DEFINER` para o que cruza prefeituras, testes de banco e de API para cada regra, textos em português claro e uma passada no navegador ao final de cada parte.
- Textos novos criados sem Pencil entram na lista "para o usuário confirmar" das pendências, como nos planos anteriores.
- Migração nova a partir da `0036`.

## 9. O que fica para quem executa

- Divisão em partes do plano. Sugestão: (a) bairros e filtro; (b) mapa com prazo; (c) Dados da prefeitura e abas da P3 com Cidadãos; (d) correções.
- Formato da tabela de bairros e índices, e como importar o arquivo do IBGE (GeoPackage pede uma biblioteca ou um passo de conversão para GeoJSON).
- Formato das rotas novas e onde a situação do prazo é calculada (no banco ou na API), desde que o mapa, a faixa e as listas usem a mesma regra.
- Textos de vazio, erro e confirmação, no estilo dos que já existem.

Fontes da malha de bairros: [Malha de Bairros (Censo Demográfico) – 2022, IBGE](https://metadadosgeo.ibge.gov.br/geonetwork_ibge/srv/api/records/c0a902c4-1e02-43b3-ac7b-1318cc733da5) e [Malhas de setores censitários e divisões intramunicipais, IBGE](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/26565-malhasde-setores-censitarios-divisoes-intramunicipais.html).
