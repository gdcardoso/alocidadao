# Telas do Backoffice Alô Cidadão — extração do Pencil

Fonte: `design/alocidadao.pen` (seção "Backoffice Alô Cidadão" `v3mAxp`, apoio "Equipe interna da empresa (platform_admin, suporte)"; lida via MCP do Pencil, sem alterações). As telas são quadros de topo do documento (a seção `v3mAxp` só contém o título e a linha). Temas da seção:

| Tema                       | Id       | Apoio                                                                                  |
| -------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Prefeituras                | `HCrRI`  | "Carteira de clientes, criação e detalhe de cada prefeitura"                           |
| Suporte às prefeituras     | `odQ0t`  | "A equipe entra no painel da prefeitura com as mesmas telas, e tudo fica na auditoria" |
| Comercial e equipe interna | `X3vhcC` | "Cidades que pedem o serviço e quem da empresa acessa o backoffice"                    |

Todas as telas têm 1440x900 (desktop), fundo `$bg`, sem variante responsiva. Ícones: **lucide**. Fontes: corpo `$font` = Source Sans 3; títulos `$font-heading` = Lexend (marcados "Lexend"). Tokens de cor: os mesmos da seção 3 de `2026-10-23-telas-cidadao-pencil.md` (não há variáveis novas); a diferença é o **menu lateral escuro**, que usa `text-primary` como fundo e literais `#1E293B`, `#334155`, `#94A3B8`, `#CBD5E1`.

Capturas (exportadas do Pencil, 2x, 2880x1800): `docs/superpowers/specs/telas-backoffice/` — `P1-prefeituras.png`, `P2-nova-prefeitura.png`, `P3-detalhe-da-prefeitura.png`, `P4-painel-em-modo-suporte.png`, `P5-interesse-por-cidade.png`, `P6-equipe-alo-cidadao.png`.

Telas encontradas: 6 (P1 a P6). Não existe tela de login/entrada da equipe interna, nem diálogos, nem variantes.

| Tela | Frame                                  | Id       | Tamanho  | Tema                               |
| ---- | -------------------------------------- | -------- | -------- | ---------------------------------- |
| P1   | Backoffice · P1 Prefeituras            | `BybT7`  | 1440x900 | Prefeituras                        |
| P2   | Backoffice · P2 Nova prefeitura        | `M7Nsli` | 1440x900 | Prefeituras                        |
| P3   | Backoffice · P3 Detalhe da prefeitura  | `lLsmZ`  | 1440x900 | Prefeituras                        |
| P4   | Backoffice · P4 Painel em modo suporte | `Yxc3r`  | 1440x900 | Suporte às prefeituras             |
| P5   | Backoffice · P5 Interesse por cidade   | `IIGGS`  | 1440x900 | Comercial e equipe interna         |
| P6   | Backoffice · P6 Equipe Alô Cidadão     | `yUa3u`  | 1440x900 | Comercial e equipe interna         |
| (C)  | Componente · Menu backoffice           | `mQMT4`  | 256x900  | — (fora das seções, x 1300 y -300) |

P3 mostra só a aba **Visão geral**; as outras seis abas existem no cabeçalho, sem conteúdo desenhado. P4 é o painel da prefeitura (W1) com faixa de suporte; está descrita na seção 1.3 de `2026-10-26-telas-painel-pencil.md` (ver seção 2.4 abaixo).

Convenção: rótulos de campo são 13/600 `text-secondary`; ajudas/notas 13 `text-secondary`; nós com `enabled=false` seriam marcados "oculto" (nenhum foi encontrado nas telas P1–P6 nem no componente).

---

## 1. Shell compartilhado (P1, P2, P3, P5, P6)

Layout horizontal: **Menu backoffice** (instância do componente `mQMT4`, 256 de largura, altura total) + **Principal** (1184x900, vertical). Ao contrário do painel da prefeitura, aqui o menu **é componente**; cada tela usa uma instância (`pdQLJ`, `M0rgXU`, `EA19U`, `aOUIt`, `pBVYT`) e marca o item ativo sobrescrevendo só o `fill` do item.

### 1.1 Componente · Menu backoffice (`mQMT4`)

- Contêiner: fundo **`text-primary`** (escuro), vertical, padding 20/14, gap 24, 256x900.
- **Marca** (gap 12, padding 0/6): logo 40x40 (quadrado branco `#FFFFFF`, raio 12, símbolo `simbolo.png` 30x30) + textos: "Alô Cidadão" (Lexend 17/600 `#FFFFFF`) e **"Backoffice"** (13 `#94A3B8`).
- **Navegação** (vertical, gap 4). Item: largura total, altura 44, raio 12, padding 0/12, gap 12; ícone 20 `#CBD5E1` + texto 15/500 `border` (cor clara). Item ativo: fundo `#1E293B` (as instâncias só trocam o fundo; ícone e texto mantêm as mesmas cores). Sem contadores nem grupos.
  1. "Prefeituras" — `building-2` (P1, P2, P3)
  2. "Interesse por cidade" — `map-pinned` (P5)
  3. "Equipe Alô Cidadão" — `shield-user` (P6)
  4. "Auditoria" — `scroll-text` (**sem tela**)
- **Espaço** flexível empurra o usuário para baixo.
- **Usuário** (borda superior `#334155` 1, padding 12/6/0/6, gap 10): avatar 36 (círculo `#1E293B`, iniciais "LP" 14/700 `#FFFFFF`) · "Lucas Prado" (14/600 `#FFFFFF`) e papel **"Admin · Alô Cidadão"** (13 `#94A3B8`). Sem ícone de sair neste componente (o painel da prefeitura tem `log-out` no usuário), sem menu de perfil.
- Em P2 e P3 (telas de dentro de "Prefeituras") o item ativo é "Prefeituras".

### 1.2 Barra superior (topo do Principal)

Fundo `surface`, borda inferior `border` 1, padding 16/24, gap 16, centralizada. Variantes:

- **Com ação** (P1, P5, P6; 80 de altura): títulos (Lexend 22/600 `text-primary` + apoio 14 `text-secondary`) à esquerda, botão à direita.
- **Com voltar** (P2; 80): botão circular 36 (raio 18, borda `border` 1, `arrow-left` 18 `text-primary`) + títulos; gap 12; sem botão de ação (as ações ficam no rodapé).
- **Com abas** (P3; 120): vertical, padding 16/24/0/24, gap 12: linha de título (título + selo + botões) e linha de abas (gap 24; aba 44 de altura, texto 15, ativa 15/600 `primary` com sublinhado `primary` 3, inativas 15/500 `text-secondary`).

Botões (altura 40, raio 20, ícone 16 + 14/600): primário `primary` (texto/ícone `on-primary`, padding 0/16), secundário `surface` com borda `border-input` 1, destrutivo contorno `danger` 1 (ícone e texto `danger`, padding 0/14).

---

## 2. Telas

### P1 · Prefeituras (`BybT7`)

- Propósito: carteira de clientes — visão geral das prefeituras, com indicadores agregados e alertas por prefeitura; ponto de entrada para criar e abrir uma prefeitura.
- Menu: "Prefeituras" ativo.
- Barra superior com ação: título "Prefeituras"; apoio "4 prefeituras · 3 ativas, 1 em implantação"; botão primário **"Nova prefeitura"** (`plus`, 150x40) → P2.
- Conteúdo (vertical, padding 24, gap 20):
  1. **Indicadores** (4 cartões 272x115, gap 16; `surface`, borda `border` 1, raio 12, padding 16, gap 6): rótulo 13 `text-secondary`, valor Lexend 26/600 `text-primary`, apoio 13 `text-secondary`.
     - "Prefeituras ativas" · "3" · "+1 em implantação"
     - "Cidadãos" · "12.480" · "fizeram ao menos 1 solicitação"
     - "Solicitações no mês" · "3.215" · "+12% sobre setembro"
     - "Tempo médio até a conclusão" · "4,2 dias" · "média das ativas"
  2. **Tabela** (`surface`, borda `border` 1, raio 12; cabeçalho 44 fundo `bg`, textos 13/700 `text-secondary`, padding 0/16; linhas 60, divisória `border`, exceto a última). Colunas (larguras fixas): "Prefeitura" 230 · "Status" 140 · "Plano" 120 · "Cidadãos" 100 · "Abertas" 90 · "Tempo médio" 110 · "Alertas" 210 · Ações 70 (sem título).
     - Prefeitura: nome 14/600 `text-primary` + UF 12 `text-secondary` (coluna vertical).
     - Status: selo (padding 3/8, raio 8, 12/700): "Ativa" (`success-soft`/`success`) ou "Em implantação" (`primary-soft`/`primary`).
     - Plano, Cidadãos, Abertas, Tempo médio: 14 `text-primary`.
     - Alertas (gap 6): ícone 14 + 13; alerta de atenção = `triangle-alert` `warning` + texto `#78350F`; informativo = `info` `primary` + texto `text-secondary`; sem alerta = "—" 13 `text-secondary`.
     - Ações: botão "Abrir" (52x32, raio 16, borda `primary` 1, 13/600 `primary`) → P3.
  - Linhas de exemplo:

    | Prefeitura              | UF  | Status         | Plano     | Cidadãos | Abertas | Tempo médio | Alerta                                            |
    | ----------------------- | --- | -------------- | --------- | -------- | ------- | ----------- | ------------------------------------------------- |
    | Prefeitura de São Paulo | SP  | Ativa          | Completo  | 8.912    | 148     | 3,9 dias    | `triangle-alert` "5 aguardando revisão há +1 dia" |
    | Prefeitura de Santos    | SP  | Ativa          | Essencial | 2.304    | 41      | 4,8 dias    | "—"                                               |
    | Prefeitura de Jundiaí   | SP  | Ativa          | Essencial | 1.264    | 22      | 5,1 dias    | `triangle-alert` "2 impedimentos parados"         |
    | Prefeitura de Sorocaba  | SP  | Em implantação | Completo  | 0        | 0       | "—"         | `info` "Sem categorias configuradas"              |

  - Sem rodapé, sem paginação, sem busca/filtros.
- Interações: "Nova prefeitura" → P2; "Abrir" (ou a linha, presumido) → P3.
- Dados: lista de tenants (nome, UF, status `implantação`/`ativa`/(suspensa?), plano, nº de cidadãos com ≥1 solicitação, nº de ocorrências abertas+em atendimento, tempo médio até conclusão — janela não indicada na tabela, "média das ativas" nos indicadores), alertas calculados (aguardando revisão há > 1 dia, impedimentos parados, sem categorias); agregados (ativas, em implantação, cidadãos, solicitações no mês e variação sobre o mês anterior, tempo médio).

### P2 · Nova prefeitura (`M7Nsli`)

- Propósito: cadastrar uma prefeitura (município, admin inicial, contrato e catálogo inicial). Nasce "Em implantação" e só aparece ao cidadão quando for ativada.
- Menu: "Prefeituras" ativo.
- Barra superior com voltar: botão `arrow-left` → P1; título "Nova prefeitura"; apoio "A prefeitura começa "Em implantação" e só aparece para os cidadãos quando for ativada."
- Conteúdo (horizontal, padding 24, gap 24): duas colunas de 556. Cartões `surface`, borda `border` 1, raio 12, padding 20, gap 14. Título de cartão: ícone 18 `primary` + texto 16/600 `text-primary` (gap 8). Campo: 40 de altura, raio 8, `surface`, borda `border-input` 1, padding 0/12, valor 14; placeholder em `text-placeholder`.
  - **Coluna 1**
    - **Município** (`map`):
      - "Buscar município (IBGE)" — valor "Sorocaba — SP · 3552205" (campo preenchido).
      - Aviso de sucesso (`success-soft`, raio 10, padding 12, gap 12): prévia 64x48 (`#BBF7D0`, raio 8, `map` 20 `success`) + "Limite do município importado do IBGE" (14/600 `success`) e "Usado para saber em qual prefeitura cai cada solicitação." (13 `success`).
      - Linha (gap 12): "Nome de exibição" (364) — "Prefeitura de Sorocaba" · "Central de atendimento" (140) — "156".
    - **Admin da prefeitura** (`user-cog`):
      - "Nome" — placeholder "Nome completo"
      - Linha: "CPF" — placeholder "000.000.000-00" · "E-mail institucional" — placeholder "nome@prefeitura.gov.br"
      - Ajuda: "Ele entra no painel com o CPF e recebe o código neste e-mail. Depois cadastra gestores, equipes e agentes."
  - **Coluna 2**
    - **Contrato** (`file-pen-line`):
      - Linha: "Plano" — "Completo" · "Agentes e gestores incluídos" — "50"
      - Linha: "Início da vigência" — "01/11/2026" · "Fim da vigência" — "31/10/2027"
      - Nota: "Registro do que foi contratado. Cobrança fica fora do MVP."
    - **Categorias iniciais** (`tags`): caixa 20 raio 5 `primary` com `check` branco + "Copiar o catálogo padrão (9 categorias, prazos e raios sugeridos)" (14); ajuda "O admin da prefeitura pode ajustar depois em Categorias."
- Rodapé (1184x68, `surface`, borda superior, padding 14/24, gap 10, à direita): "Cancelar" (secundário) · "Criar prefeitura" (`primary`).
- Interações: buscar município no IBGE (autocomplete; ao escolher, importa o limite); editar nome de exibição e central; preencher admin; escolher plano e vigência; marcar/desmarcar o catálogo padrão; Criar → prefeitura "Em implantação" (provavelmente abre P3); Cancelar/Voltar → P1. Os selects "Plano" não mostram seta (presumivelmente select).
- Dados: base de municípios IBGE (nome, UF, código de 7 dígitos, geometria do limite), enviados: `ibgeCode`, nome de exibição, telefone da central ("156"), admin (nome, CPF, e-mail), plano, agentes e gestores incluídos, início/fim da vigência, flag de copiar catálogo padrão (9 categorias). Validação de CPF e de unicidade do município.

### P3 · Detalhe da prefeitura (`lLsmZ`)

- Propósito: visão geral de uma prefeitura (saúde operacional, equipe, contrato, últimas ações da equipe interna) e ponto de entrada para suspender ou entrar no painel (P4). Só a aba "Visão geral" está desenhada.
- Menu: "Prefeituras" ativo.
- Barra superior com abas (120):
  - Título "Prefeitura de São Paulo" (Lexend 22/600) + selo "Ativa" (`success-soft`/`success`, 12/700); apoio "SP · IBGE 3550308 · cliente desde 01/11/2026 · plano Completo".
  - Ações à direita: **"Suspender"** (destrutivo contorno `danger`, `pause`) e **"Entrar no painel da prefeitura"** (primário, `log-in`) → P4.
  - Abas: "Visão geral" (ativa) · "Contrato" · "Equipes e agentes" · "Gestores" · "Categorias" · "Cidadãos" · "Auditoria" (sem conteúdo).
- Conteúdo (vertical, padding 24, gap 20):
  1. **Indicadores** (4 cartões 272x115, mesmo estilo da P1):
     - "Cidadãos" · "8.912" · "fizeram ao menos 1 solicitação"
     - "Abertas e em atendimento" · "148" · "32 abertas há +3 dias"
     - "Aguardando revisão" · "5" · "2 há mais de 1 dia" — cartão com borda **`warning` 1** e apoio em `#78350F`
     - "Tempo médio até a conclusão" · "3,9 dias" · "últimos 30 dias"
  2. **Blocos** (3 cartões 368, gap 16, `surface`, borda `border` 1, raio 12, padding 20, gap 12; título de cartão como na P2). Linhas de resumo: altura 36, borda superior `border` 1, padding 8/0, rótulo 14/600 `text-primary` · valor 14 `text-secondary` · ação 14/600 `primary`.
     - **Pessoas da prefeitura** (`users`): "Equipes" "5" · "Agentes" "14 ativos · 1 convidado" · "Gestores" "4 · 1 admin" · "Categorias" "9 ativas"; cada uma com ação "Gerenciar".
     - **Contrato** (`file-pen-line`): "Plano" "Completo" · "Vigência" "01/11/2026 a 31/10/2027" · "Usuários do painel" "18 de 50 incluídos" · "Central" "156" (sem ação).
     - **Últimas ações da equipe Alô Cidadão** (`scroll-text`; cartão 270 de altura): itens com ação 14/600 `text-primary` + meta 13 `text-secondary`: "Entrou no painel (suporte)" · "Lucas Prado · hoje, 10:02"; "Reatribuiu 2026-000140 a Pavimentação" · "Lucas Prado · hoje, 10:09"; "Cadastrou o gestor Paulo Nunes" · "Marina Dias · ontem, 16:30".
- Interações: trocar de aba (só a primeira desenhada); "Gerenciar" leva à aba correspondente (presumido); "Suspender" (diálogo de confirmação não desenhado); "Entrar no painel da prefeitura" → P4 e registra auditoria.
- Dados: tenant (nome, UF, código IBGE, status, data de início do contrato, plano), contagens (cidadãos, ocorrências abertas/em atendimento, abertas há mais de 3 dias, em revisão e há mais de 1 dia, tempo médio 30 dias), equipes/agentes (ativos, convidados)/gestores/admins/categorias ativas, vigência, usuários do painel vs. incluídos (18 = gestores + agentes? 14+1+4 = 19, não bate; regra de contagem não definida), central; últimos N eventos de auditoria do tenant (ação, autor, data relativa).

### P4 · Painel em modo suporte (`Yxc3r`)

Descrita na seção 1.3 de `2026-10-26-telas-painel-pencil.md` (faixa de suporte 1440x44 `text-primary` + painel da prefeitura 1440x856 = W1 com usuário "Lucas Prado"/"Equipe Alô Cidadão" e `log-out` do usuário oculto). Acrescentos desta extração:

- Frame com layout vertical: `Faixa de suporte` (`xw1rU`) + `Painel da prefeitura` (`xvF8V`, contendo `Menu lateral` `y50wK` e `Principal` `jtbLV`). O menu aqui é o do painel da prefeitura (cópia, não o `mQMT4`).
- Faixa: ícone `shield-user` `#FBBF24`; texto 14 `#FFFFFF` "Você está na Prefeitura de São Paulo como equipe Alô Cidadão · suas ações ficam registradas na auditoria"; botão branco "Sair da prefeitura" (13, `log-out` e texto `text-primary`).
- Origem: botão "Entrar no painel da prefeitura" da P3. Destino da saída: P3 (presumido).
- Menu do painel não mostra nada próprio do suporte além do usuário trocado.

### P5 · Interesse por cidade (`IIGGS`)

- Propósito: ranking de municípios sem prefeitura ativa onde moradores tocaram em "Quero o Alô Cidadão aqui" (demanda para o comercial).
- Menu: "Interesse por cidade" ativo.
- Barra superior com ação: título "Interesse por cidade"; apoio "Moradores que tocaram em "Quero o Alô Cidadão aqui""; botão secundário **"Exportar CSV"** (`download`, 134x40).
- Conteúdo (vertical, padding 24, gap 12): **tabela** (padrão da P1; linhas 56). Colunas: "#" 50 · "Município" 260 · "Pedidos" 120 · "Últimos 30 dias" 150 · "Primeiro pedido" 160 · "Situação comercial" 220 · Ações 100 (sem título).
  - "#" 14 `text-secondary`; município 14/600 `text-primary`; pedidos **Lexend 16/600** `text-primary`; últimos 30 dias 14/600 `success` ("+N"); primeiro pedido 14 `text-secondary` (dd/mm/aaaa); situação = selo (padding 3/8, raio 8, 12/700): "Em negociação" e "Proposta enviada" (`primary-soft`/`primary`), "Sem contato" (`bg`/`text-secondary`); ações `ellipsis` 20 `text-secondary`.

    | #   | Município           | Pedidos | 30 dias | Primeiro pedido | Situação         |
    | --- | ------------------- | ------- | ------- | --------------- | ---------------- |
    | 1   | Campinas — SP       | 812     | +214    | 12/08/2026      | Em negociação    |
    | 2   | Ribeirão Preto — SP | 436     | +98     | 03/09/2026      | Sem contato      |
    | 3   | Guarulhos — SP      | 301     | +40     | 21/08/2026      | Proposta enviada |
    | 4   | Bauru — SP          | 122     | +31     | 02/10/2026      | Sem contato      |
    | 5   | Piracicaba — SP     | 87      | +12     | 15/09/2026      | Sem contato      |

  - Nota (13 `text-secondary`): "Cada pessoa conta uma vez por município. Não guardamos o local exato, só o município."
- Interações: exportar CSV; menu "⋯" por linha (presumido: mudar situação comercial, anotar, abrir contato — não desenhado); ordenação não indicada (parece por "Pedidos" decrescente).
- Dados: por município: contagem de pessoas distintas (1 por município), pedidos nos últimos 30 dias, data do primeiro pedido, situação comercial (enum: sem contato, em negociação, proposta enviada, ...). Só município (sem localização exata). Possivelmente só municípios sem prefeitura ativa (não indicado).

### P6 · Equipe Alô Cidadão (`yUa3u`)

- Propósito: gerenciar quem da empresa acessa o backoffice, com os papéis Admin e Suporte.
- Menu: "Equipe Alô Cidadão" ativo.
- Barra superior com ação: título "Equipe Alô Cidadão"; apoio "Quem da empresa acessa o backoffice"; botão primário **"Adicionar pessoa"** (`user-plus`, 159x40).
- Conteúdo (vertical, padding 24, gap 12):
  1. **Tabela** (padrão da P1; linhas 56). Colunas: "Nome" 240 · "CPF" 150 · "E-mail (recebe o código)" 260 · "Papel" 140 · "Último acesso" 160 · Ações 80 (sem título).
     - Nome 14/600; CPF mascarado 14 `text-secondary`; e-mail 14 `text-primary`; papel = selo (12/700): "Admin" (fundo `text-primary`, texto `#FFFFFF`), "Suporte" (fundo `bg`, `text-primary`); último acesso 14 `text-secondary`; ações `ellipsis`.

     | Nome          | CPF            | E-mail                   | Papel   | Último acesso |
     | ------------- | -------------- | ------------------------ | ------- | ------------- |
     | Lucas Prado   | 123._**.**_-09 | lucas@alocidadao.com.br  | Admin   | hoje, 09:40   |
     | Marina Dias   | 456._**.**_-21 | marina@alocidadao.com.br | Suporte | ontem, 16:30  |
     | Rafael Torres | 789._**.**_-55 | rafael@alocidadao.com.br | Suporte | há 3 dias     |

  2. **Papéis** (2 cartões 560x99, gap 16, `surface`, borda `border` 1, raio 12, padding 16, gap 6; título 15/600 + texto 14 `text-secondary`):
     - "Admin": "Tudo: criar e suspender prefeituras, contratos, equipe interna, e entrar em qualquer prefeitura."
     - "Suporte": "Entra em qualquer prefeitura e faz a gestão dela (equipes, gestores, agentes, solicitações). Não mexe em contratos nem na equipe interna."
- Interações: Adicionar pessoa (formulário não desenhado); "⋯" (editar, trocar papel, desativar, reenviar acesso — não desenhado).
- Dados: usuários internos (nome, CPF mascarado, e-mail, papel `platform_admin`/suporte, último acesso, situação — não exibida). Login igual ao do painel (CPF + código por e-mail). O papel "Admin" aqui é `platform_admin` (o apoio da seção diz "platform_admin, suporte").

---

## 3. Componentes e tokens novos (backoffice)

Nada novo em variáveis. Literais novos do backoffice: `#1E293B` (item ativo do menu e avatar), `#334155` (borda superior do usuário), `#94A3B8` (texto secundário sobre o escuro), `#CBD5E1` (ícones do menu), `#BBF7D0` (prévia do limite do município), `#FBBF24` (faixa de suporte, P4), `#78350F` (texto sobre `warning-soft`/alerta).

Tipografia: igual ao painel (Lexend 22/600 no título, 16/600 em título de cartão, 26/600 em indicador, 16/600 Lexend no nº de pedidos; corpo 14; metadados 13; selos 12/700; cabeçalho de tabela 13/700).

Componentes:

- **Componente · Menu backoffice** (`mQMT4`, reutilizável, escuro) + item de menu ativo (fundo `#1E293B`).
- **Cartão de indicador** (272x115: rótulo, valor Lexend 26, apoio), com variante de alerta (borda `warning`, apoio `#78350F`).
- **Tabela** igual à do painel (cabeçalho 44 fundo `bg`; linhas 56/60; larguras fixas; coluna de ações com botão "Abrir" ou `ellipsis`).
- **Selos**: Status da prefeitura ("Ativa" `success-soft`/`success`; "Em implantação" `primary-soft`/`primary`); situação comercial ("Em negociação"/"Proposta enviada" `primary-soft`, "Sem contato" `bg`); papel interno ("Admin" escuro, "Suporte" `bg`).
- **Alerta em linha de tabela** (ícone 14 `warning`/`primary` + texto 13).
- **Cartão de formulário** (título com ícone `primary` 18 + campos 40 raio 8; linhas de 2 campos), **cartão de resumo** (linhas com rótulo, valor e ação "Gerenciar"), **item de auditoria** (ação + autor/data).
- **Aviso de sucesso** com prévia de mapa (limite IBGE).
- **Caixa de seleção** 20 raio 5 (catálogo padrão).
- **Barra superior com abas e selo** (P3) e **barra com voltar** (P2).
- **Botões**: primário, secundário, destrutivo contorno (`Suspender`), "Abrir" 32 contorno `primary`.

---

## 4. Estados mostrados

| Estado                      | Onde   | Como aparece                                          |
| --------------------------- | ------ | ----------------------------------------------------- |
| Prefeitura Ativa            | P1, P3 | selo `success-soft`/`success`                         |
| Prefeitura Em implantação   | P1, P2 | selo `primary-soft`/`primary`; texto na P2            |
| Prefeitura Suspensa         | —      | não desenhado (só o botão "Suspender")                |
| Interesse: Sem contato      | P5     | selo `bg`/`text-secondary`                            |
| Interesse: Em negociação    | P5     | selo `primary-soft`/`primary`                         |
| Interesse: Proposta enviada | P5     | selo `primary-soft`/`primary`                         |
| Papel Admin / Suporte       | P6     | selos escuro / `bg`                                   |
| Modo suporte                | P4     | faixa escura no topo                                  |
| Campo preenchido/vazio (P2) | P2     | valor `text-primary` / placeholder `text-placeholder` |

---

## 5. Diferenças em relação a `design-system.md` e ao painel da prefeitura

1. Menu lateral **escuro** (`text-primary` + literais slate), sem contadores, sem grupos, sem `log-out` no usuário; o painel da prefeitura tem menu claro, cópia por tela. Aqui é componente com instâncias.
2. Item ativo do menu só muda o fundo (`#1E293B`); ícone e texto não mudam de cor.
3. Mesma escala web do painel: corpo 14, botões 40 (raio 20), campos 40 (raio 8); peso 700 em selos e cabeçalhos; **indicadores** (Lexend 26) são novos (o painel não os usa).
4. Texto branco `#FFFFFF` literal (selo Admin, avatar, faixa de suporte) e `#78350F` sem token.
5. Cor de selo "Em implantação" = `primary-soft`, igual a "Em negociação" e "Proposta enviada" (P5): o mesmo azul significa estados diferentes.
6. O nome do papel difere: menu "Admin · Alô Cidadão"; no painel da prefeitura o admin é "Admin" (tenant_admin) — mesmo rótulo para papéis distintos.
7. P2 não tem campo "UF"/"setores"; setores do tenant não aparecem em nenhum lugar do backoffice.
8. P3: "Usuários do painel 18 de 50 incluídos" não bate com 14 agentes + 1 convidado + 4 gestores (19, ou 18 sem o convidado); P2 diz "Agentes e gestores incluídos" (50).

---

## 6. Lacunas (o que o Pencil não mostra)

Telas e navegação:

- **Login/entrada da equipe interna**: não existe; presume-se o mesmo fluxo W0a/W0b (CPF + código), mas sem distinção visual nem escolha de ambiente.
- **Auditoria** (item do menu e aba da P3): sem tela, sem filtros, sem formato do registro (só o resumo de 3 itens em P3).
- **P3, abas Contrato, Equipes e agentes, Gestores, Categorias, Cidadãos, Auditoria**: não desenhadas (a aba "Contrato" permite editar o contrato? "Cidadãos" lista pessoas? — nada definido). "Gerenciar" não indica destino.
- **Suspender** (P3): diálogo de confirmação, motivo, efeito para cidadãos e agentes (o que o cidadão vê numa prefeitura suspensa) e botão de reativar não desenhados. **Ativar** a prefeitura (sair de "Em implantação"): sem ação nem checklist desenhado (a P1 mostra "Sem categorias configuradas" como pendência).
- **Editar prefeitura** (nome, central, limite, admin): sem tela; **excluir/arquivar**: sem tela.
- **Adicionar pessoa**, editar, trocar papel, desativar, reenviar acesso (P6) e menu "⋯" (P5, P6): não desenhados. **Situação comercial** (P5): como alterar, anotações, histórico de contato, lista de situações possíveis.
- **P5**: filtro por UF/período, busca, ordenação, paginação, quando o município vira prefeitura (converter em P2 pré-preenchida?), e se municípios já atendidos saem da lista.
- **P1**: busca, filtros por status/plano, ordenação, paginação; janela do "Tempo médio"; critério dos alertas.
- **P2**: seletor de plano (lista de planos e agentes incluídos por plano), seletor de data, erros de validação, estado vazio da busca IBGE, município já cadastrado, prévia real do limite, o que "Criar" faz depois (navegação), convite/e-mail enviado ao admin.
- **P4**: além da faixa, nada indica o que o suporte não pode fazer (por regra de papel: "Suporte" não mexe em contrato); como o auditoria registra ações; sessão com tempo limite; qual prefeitura/papel é emulado.
- Perfil do usuário/sair do backoffice: sem `log-out` no menu, sem menu de perfil.

Estados:

- Vazios (nenhuma prefeitura, nenhum interesse, equipe sem outras pessoas), carregando, erro de rede, falha ao salvar, conflito.
- Permissão por papel: o que o "Suporte" vê no menu (P6 e "Contrato" estariam bloqueados?), botões desabilitados para Suporte (Nova prefeitura, Suspender, Adicionar pessoa).
- Responsivo: só 1440x900; sem comportamento para telas menores nem menu recolhido; rolagem de tabelas.
- Textos e dados são exemplos (Sorocaba, São Paulo, Lucas Prado, contagens, datas em 2026).
