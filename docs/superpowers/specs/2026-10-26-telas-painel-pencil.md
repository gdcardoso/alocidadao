# Telas do painel WEB da prefeitura — extração do Pencil

Fonte: `design/alocidadao.pen` (seção "Painel WEB" `b4gCme`, apoio "Gestor e admin da prefeitura (manager, tenant_admin)"; lida via MCP do Pencil, sem alterações). Temas da seção:

| Tema              | Id       | Apoio                                                     |
| ----------------- | -------- | --------------------------------------------------------- |
| Acesso ao painel  | `IFEqe`  | "CPF + código enviado ao e-mail cadastrado"               |
| Mapa e atribuição | `U3J5aV` | "Visão da cidade, agrupamento e atribuição a equipes"     |
| Triagem           | `B77hd`  | "Solicitações novas em lista"                             |
| Revisão           | `XlvM8`  | "Publicar o atendimento ao cidadão ou devolver ao agente" |
| Impedimentos      | `b6qtyb` | "Decidir o próximo passo"                                 |
| Configurações     | `WvT8h`  | "Equipes, agentes e categorias"                           |

Todas as telas têm 1440x900 (desktop), fundo `$bg`, sem variante responsiva. Ícones: **lucide**. Fontes: corpo `$font` = Source Sans 3; títulos `$font-heading` = Lexend (marcados abaixo como "Lexend"). Tokens de cor: os mesmos da seção 3 de `2026-10-23-telas-cidadao-pencil.md` (o arquivo não tem variáveis novas para o painel; `brand-green-on-blue` `#3DDC97` aparece aqui no login).

Capturas (exportadas do Pencil, 2x, 2880x1800): `docs/superpowers/specs/telas-painel/` — `W0a-entrar-cpf.png`, `W0b-codigo-do-email.png`, `W1-mapa-de-ocorrencias.png`, `W2-atribuir-a-uma-equipe.png`, `W5-triagem.png`, `W3-aguardando-revisao.png`, `W3b-devolver-ao-agente.png`, `W4-impedimentos.png`, `W6-equipes-e-agentes.png`, `W6b-gestores.png`, `W7-categorias.png` e, como variante relacionada, `P4-painel-em-modo-suporte.png`.

Telas encontradas: 11 (todas as previstas de W0a a W7) + 1 variante relacionada fora da seção.

| Tela | Frame                                  | Id       | Tamanho  | Tema                        |
| ---- | -------------------------------------- | -------- | -------- | --------------------------- |
| W0a  | Web · W0a Entrar (CPF)                 | `mCltK`  | 1440x900 | Acesso ao painel            |
| W0b  | Web · W0b Código do e-mail             | `bH2XR`  | 1440x900 | Acesso ao painel            |
| W1   | Web · W1 Mapa de ocorrências           | `YSu2i`  | 1440x900 | Mapa e atribuição           |
| W2   | Web · W2 Atribuir a uma equipe         | `xqPeP`  | 1440x900 | Mapa e atribuição           |
| W5   | Web · W5 Triagem                       | `cOU6q`  | 1440x900 | Triagem                     |
| W3   | Web · W3 Aguardando revisão            | `Xdz73`  | 1440x900 | Revisão                     |
| W3b  | Web · W3b Devolver ao agente           | `T2z0a`  | 1440x900 | Revisão                     |
| W4   | Web · W4 Impedimentos                  | `V7UvWR` | 1440x900 | Impedimentos                |
| W6   | Web · W6 Equipes e agentes             | `u3Onut` | 1440x900 | Configurações               |
| W6b  | Web · W6b Gestores                     | `A5FHg`  | 1440x900 | Configurações               |
| W7   | Web · W7 Categorias                    | `h2Iu1`  | 1440x900 | Configurações               |
| (P4) | Backoffice · P4 Painel em modo suporte | `Yxc3r`  | 1440x900 | Backoffice (seção `v3mAxp`) |

W2 é a W1 com um diálogo aberto; W3b é a W3 com um diálogo aberto; W6b é a segunda aba da W6. P4 é o painel da prefeitura (igual à W1) visto pela equipe Alô Cidadão, com uma faixa de suporte no topo — é do backoffice, mas usa o mesmo shell e por isso está registrada aqui (seção 2.3).

Não existem quadros para os itens de menu "Em atendimento" e "Todas as solicitações", nem diálogos de recusar/separar/criar/editar equipe, agente, gestor ou categoria. Ver seção 6.

Convenção: `obrigatório`/`opcional` e outros textos à direita do rótulo de campo são 13 `text-secondary` (o rótulo é 15/600 `text-primary`, linha `space_between`). Nós com `enabled=false` estão marcados como "oculto".

---

## 1. Shell compartilhado (W1–W7)

Layout horizontal: **Menu lateral** (256 de largura, altura total) + **Principal** (`fill_container`, vertical). O menu **não é componente**: cada tela tem uma cópia (`DmrwU`, `T7o1JU`, `HHHD1`, `s7ZNC`, `M8lmN`, `QK6CW`, `upU4O`, `Ek8D6`, `w3NR6`), idênticas exceto pelo item ativo. (O backoffice, ao contrário, tem componente `mQMT4` "Componente · Menu backoffice".)

### 1.1 Menu lateral

- Contêiner: fundo `surface`, borda direita `border` 1, vertical, padding 20/14, gap 24.
- **Marca** (gap 12, padding 0/6, centralizado): logo 40x40 (imagem `alo-cidadao-assets/simbolo.png`, `contain`, sem fundo) + textos: "Alô Cidadão" (Lexend 17/600 `text-primary`) e nome da prefeitura **"Prefeitura de São Paulo"** (13 `text-secondary`) — é o nome do tenant, variável.
- **Navegação** (vertical, gap 4). Item: largura total, altura 44, raio 12, padding 0/12, gap 12; ícone 20 + texto 15 (`fill_container`) + contador opcional.
  - Item inativo: fundo transparente (`#FFFFFF00`), ícone `text-secondary`, texto 15/500 `text-primary`.
  - Item ativo: fundo `primary-soft`, ícone e texto `primary`, texto 15/600.
  - Cabeçalho de grupo: padding 16/12/6/12, texto 12/700 `text-secondary`, espaçamento de letras 1, caixa alta.
  - Contador: padding 2/8, raio 10, texto 13/700 `#FFFFFF` literal.
- Itens, na ordem:
  1. "Mapa" — `map` (W1, W2)
  2. grupo **"FILAS"**
  3. "Triagem" — `inbox` — contador **"12"** fundo `primary` (W5)
  4. "Aguardando revisão" — `clipboard-check` — contador **"5"** fundo `warning` (W3, W3b)
  5. "Impedimentos" — `octagon-alert` — contador **"2"** fundo `danger` (W4)
  6. grupo **"ACOMPANHAR"**
  7. "Em atendimento" — `hard-hat` (sem tela)
  8. "Todas as solicitações" — `list` (sem tela)
  9. grupo **"CONFIGURAR"**
  10. "Equipes e agentes" — `users` (W6, W6b)
  11. "Categorias" — `tags` (W7)
- Os contadores são iguais em todas as telas (12/5/2), e batem com os apoios das telas (W5 "12 solicitações novas", W3 "5 atendimentos", W4 "2 atividades").
- **Espaço** flexível (`fill_container`) empurra o usuário para baixo.
- **Usuário** (borda superior `border` 1, padding 12/6/0/6, gap 10, centralizado): avatar 36 (círculo `primary-soft`, iniciais "CA" 14/700 `primary`) · textos: "Carlos Almeida" (14/600) e papel **"Gestor · Obras"** (13 `text-secondary`; formato "Papel · setor(es)") · ícone `log-out` 18 `text-secondary` (sair, sem confirmação desenhada).
- Não há seletor de prefeitura (o gestor pertence a uma só) nem menu do usuário/perfil.

### 1.2 Barra superior (topo do Principal)

Fundo `surface`, borda inferior `border` 1. Três variantes:

- **Com filtros** (W1/W2/W5): vertical, padding 16/24/12/24, gap 12. Linha título (gap 16, centralizada): títulos (título Lexend 22/600 `text-primary` + apoio 14 `text-secondary`) + ação à direita. Linha filtros (gap 8).
- **Simples** (W3/W3b/W4): vertical, padding 16/24, gap 4: título Lexend 22/600 + apoio 14.
- **Com ação** (W6/W6b/W7): horizontal, padding 16/24, gap 16, centralizada: títulos + botão à direita.

**Filtro (dropdown)**: altura 32, padding 0/10/0/12, gap 6, raio 8, borda `border-input` 1 (fundo `surface` em W1/W2; sem fundo em W5), texto "Nome: valor" 14/500 `text-primary` + `chevron-down` 16 `text-secondary`. Em W1/W2 cada filtro tem um ícone à esquerda **oculto** (`funnel`, `tags`, `calendar`).

**Busca**: 300x40, raio 20, fundo `bg`, borda `border-input` 1, padding 0/14, gap 8, `search` 16 `text-secondary` + placeholder 14 `text-placeholder`.

### 1.3 Variante P4 · Painel em modo suporte (`Yxc3r`)

- **Faixa de suporte** (1440x44, fundo `text-primary`): ícone `shield-user` (cor literal `#FBBF24`) + "Você está na Prefeitura de São Paulo como equipe Alô Cidadão · suas ações ficam registradas na auditoria" (branco) + botão branco "Sair da prefeitura" (`log-out` `text-primary`).
- Abaixo, **Painel da prefeitura** (1440x856) = W1 completa (mesmos textos e pinos), com o usuário trocado: avatar "LP", "Lucas Prado", papel "Equipe Alô Cidadão", e o ícone `log-out` do usuário **oculto** (a saída é pela faixa).
- O shell precisa então suportar altura reduzida (900 − 44) e um modo "suporte".

---

## 2. Telas

### W0a · Entrar (CPF)

- Propósito: login do gestor/admin pelo CPF; dispara código por e-mail.
- Layout horizontal:
  1. **Lado institucional** (600 de largura, altura total, padding 56/56/340/56, vertical `space_between`; fundo `#0057B8` + imagem `alo-cidadao-assets/painel-login.png` em `cover` — skyline com faixa verde/amarela na parte de baixo):
     - Marca (gap 14): quadrado 48 branco raio 14 com símbolo 38 (`simbolo.png`) + "Alô Cidadão" (Lexend 24/600 `#FFFFFF`).
     - Mensagem (gap 16): sobretítulo "PAINEL DA PREFEITURA" (14/600, espaçamento 2, `#DCE7F3`); título em duas linhas Lexend 44/600, lh 1.15: "Cada solicitação," (`#FFFFFF`) / "uma cidade melhor." (`brand-green-on-blue`); texto 18, lh 1.5, `#DCE7F3`: "Acompanhe as solicitações dos cidadãos, organize as equipes e responda com transparência."
     - Rodapé: "Acesso restrito a servidores cadastrados pela prefeitura." (14 `#DCE7F3`).
  2. **Formulário** (restante, conteúdo centralizado nos dois eixos): cartão de 420 de largura (sem fundo/borda), vertical, gap 28:
     - Títulos (gap 8): "Entrar" (Lexend 28/600) + "Use o CPF cadastrado pela sua prefeitura." (16 `text-secondary`).
     - Campo CPF (gap 8): rótulo "CPF" (15/600); campo 48 de altura, raio 10, fundo `surface`, borda **`primary` 2** (estado com foco), padding 0/14, valor "123.456.789-09" (16 `text-primary`, já com máscara); ajuda "Vamos enviar um código para o e-mail cadastrado." (13 `text-secondary`, lh 1.4).
     - Botão "Enviar código" (largura total, 48, raio 24, `primary`, texto 16/600 `on-primary`).
     - Ajuda: "Não recebeu acesso? Fale com o administrador do Alô Cidadão na sua prefeitura." (14 `text-secondary`, lh 1.4).
- Interações: digitar CPF (máscara) → "Enviar código" → W0b. Sem estado de erro desenhado.
- Dados: CPF (validação de dígitos), existência de usuário ativo com papel `manager`/`tenant_admin`; resposta deve devolver o e-mail mascarado e o tempo de reenvio. Login não pede escolha de prefeitura (o CPF identifica o tenant).

### W0b · Código do e-mail

- Propósito: confirmar o código de 6 dígitos enviado ao e-mail.
- Lado institucional idêntico ao da W0a.
- Cartão (420, gap 28):
  - Voltar (gap 6): `arrow-left` 16 `primary` + "Trocar CPF" (14/600 `primary`) → W0a.
  - Títulos (gap 8): "Confira seu e-mail" (Lexend 28/600) + "Enviamos um código de 6 dígitos para c••••••@prefeitura.sp.gov.br. Ele vale por 10 minutos." (16 `text-secondary`, lh 1.45). E-mail mascarado (primeira letra + bolinhas + domínio).
  - Código: 6 caixas `fill_container` (gap 8), altura 56, raio 10, fundo `surface`, borda `border-input` 1; dígito Lexend 24/600 `text-primary`. Exemplo: "7", "3", "1" preenchidos, a 4ª caixa vazia com borda **`primary` 2** (foco), 5ª e 6ª vazias.
  - Botão "Entrar" (largura total, 48, raio 24, `primary`, 16/600).
  - "Não chegou? Veja o spam ou reenvie em 0:45." (14 `text-secondary`) — contagem regressiva; o link de reenviar ao fim do tempo não está desenhado.
- Interações: digitar dígitos (avanço automático implícito), "Entrar" → W1 (presumido: tela inicial do painel), "Trocar CPF" → W0a.
- Dados: e-mail mascarado, validade (10 min), cooldown de reenvio (45 s no exemplo), verificação do código; sessão do painel.

### W1 · Mapa de ocorrências

- Propósito: visão da cidade com ocorrências agrupadas por ponto; ao clicar num ponto abre o painel do ponto com relatos, sugestão de agrupamento e ações (atribuir, separar, recusar).
- Menu: "Mapa" ativo.
- **Barra superior com filtros**:
  - Título "Mapa de ocorrências"; apoio "148 ocorrências abertas e em atendimento · últimos 30 dias".
  - Busca à direita: placeholder "Buscar endereço ou protocolo".
  - Filtros: "Status: abertas, em atendimento" · "Categoria: todas" · "Período: 30 dias" · link "Limpar filtros" (14/600 `primary`, padding 0/8, altura 32). Ícones dos filtros ocultos.
- **Área** (horizontal): mapa (`fill_container`) + painel do ponto (440).
- **Mapa** (no Pencil: desenho falso, fundo `#E9EEF2`, vias brancas, parque `#D7E8D3` — no produto é um mapa real):
  - **Pinos de agrupamento** (círculos com número de relatos, texto `#FFFFFF` 700, borda branca 3):
    - 24 → 64x64, `danger`, texto 18
    - 11 → 54x54, `warning`, texto 18
    - 8 → 50x50, `warning`, texto 15
    - 6 → 48x48, `warning`, borda branca **4** e sombra externa `#1557B0AA` blur 12 → **pino selecionado** (é o ponto aberto no painel, "6 relatos")
    - 4 → 42, `primary`; 3 → 40, `primary`; 2 → 36, `primary`; 1 → 32, `primary` (texto 15)
    - Tamanho cresce com a contagem; cor por faixa de relatos (não por categoria nem status).
  - **Zoom** (canto sup. esquerdo, x 20 y 20): coluna `surface`, borda `border-input` 1, raio 12, dois botões 40x40 com `plus` e `minus` 18 `text-primary`.
  - **Legenda** (canto inf. esquerdo; `surface`, borda `border` 1, raio 14, padding 14, gap 8): "Ocorrências por ponto" (13/700); itens com bolinha 12: `danger` "Mais de 15 relatos", `warning` "5 a 15 relatos", `primary` "Até 4 relatos" (13); nota "O número indica quantos relatos há no ponto" (12 `text-secondary`).
- **Painel do ponto** (440, `surface`, borda esquerda `border` 1, vertical):
  1. Cabeçalho (padding 20/24/16/24, gap 12, borda inferior):
     - Linha (gap 12): quadrado de categoria 44 raio 12 `primary` com `construction` 22 `on-primary` · textos: "Buraco na via" (Lexend 20/600) e "Rua das Flores, 120 — Centro" (14 `text-secondary`) · Fechar 36x36 círculo, borda `border` 1, `x` 18.
     - Etiquetas (gap 8; cada uma padding 5/10, raio 12, gap 6, ícone 14 + texto 13/600):
       - "Aberta há 2 dias" — `hourglass`, fundo `border`, ícone e texto `text-secondary` (selo de status "Aberta" + tempo).
       - "6 relatos" — `users`, fundo `bg`, `text-primary`.
       - "Raio 15 m" — `radius`, fundo `bg`, `text-primary` (raio de agrupamento da categoria).
  2. Conteúdo (padding 16/24, gap 16):
     - "Relatos neste ponto" (Lexend 16/600).
     - Lista (gap 8). Linha de relato: borda `border` 1, raio 14, padding 12, gap 12: caixa marcada 22x22 raio 6 `primary` com `check` 14 branco · miniatura 52x52 raio 10 (`#CBD5E1` = foto) · textos (gap 2): observação (14/600) e meta (13 `text-secondary`):
       - "Buraco grande perto da faixa de pedestres" · "2026-000123 · 20 out · centro do ponto"
       - "Já tem carro batendo a roda aqui" · "2026-000125 · 20 out · a 6 m"
       - Link "Ver os outros 4 relatos" (14/600 `primary`).
     - Todas as caixas estão marcadas no exemplo; desmarcar habilita "Separar desmarcados".
     - **Sugestão de agrupamento** (fundo `warning-soft`, borda `warning` 1, raio 14, padding 14, gap 10): ícone `merge` 18 `warning` + "1 relato parecido a 22 m" (14/700 `#78350F`); texto "2026-000140 · Buraco na via · "Buraco na esquina com a Rua Ipê"" (14 `#78350F`); ações (gap 8, botões 36 raio 18 padding 0/14, texto 14/600): **"Juntar a este ponto"** (fundo `warning`, texto `#FFFFFF`) e **"É outro problema"** (transparente, borda `warning` 1, texto `#78350F`).
  3. Rodapé (padding 16/24/20/24, gap 10, borda superior):
     - Primário "Atribuir a uma equipe" (largura total, 48, raio 24, `primary`, `user-check` 18 + 16/600 `on-primary`) → W2.
     - Secundárias (gap 10, cada uma `fill_container`, 44, raio 22, padding interno gap 8): "Separar desmarcados" (borda `border-input` 1, `split` 16 + 15/600 `text-primary`) e "Recusar" (borda `danger` 1, `circle-x` 16 + 15/600 `danger`).
- Interações: buscar endereço/protocolo; filtros (dropdowns); limpar; zoom/arrastar; clicar no pino → abre painel; Fechar → fecha painel (mapa ocupa tudo, não desenhado); marcar/desmarcar relatos; "Ver os outros 4 relatos" (expande a lista, presumido); juntar/ignorar sugestão; atribuir (W2); separar; recusar (diálogo não desenhado).
- Dados: ocorrências (id, categoria com ícone/grupo/cor, coordenadas, endereço, bairro, status, abertura, contagem de relatos/solicitações) filtradas por status/categoria/período e pelos setores do gestor; total para o apoio; para o ponto: solicitações (protocolo, observação, primeira foto, data, distância ao centro do ponto), raio da categoria, sugestões de solicitações parecidas (protocolo, categoria, observação, distância). Geocodificação/busca por endereço e por protocolo.

### W2 · Atribuir a uma equipe

- Propósito: diálogo para atribuir a ocorrência a uma equipe, com prazo interno e instruções.
- Fundo: a W1 inteira, igual, coberta por **escurecimento** `#0F172A80` (1440x900).
- **Janela** (560 de largura, centralizada em x 440 y 82, `surface`, raio 20, sombra `#0F172A40` y 12 blur 40):
  1. Cabeçalho (padding 20/24/16/24, borda inferior, gap 12): "Atribuir a uma equipe" (Lexend 20/600) + "Buraco na via · Rua das Flores, 120 · 6 relatos" (14 `text-secondary`); Fechar 36 (`x` 18).
  2. Conteúdo (padding 24, gap 20):
     - **Equipe** + "obrigatório". Lista de rádio (gap 8). Opção: largura total, padding 12/14, gap 12, raio 12; não selecionada `surface`, borda `border-input` 1, rádio 20 (borda `border-input` 2); selecionada `primary-soft`, borda `primary` 2, rádio com borda `primary` 2 e miolo 10 `primary`. Textos: nome 15/600 + meta 13 `text-secondary`.
       - "Obras · Centro" — "3 agentes · 4 atividades abertas · base a 1,1 km" — selecionada, com selo "Sugerida: mais próxima" (padding 3/8, raio 8, `surface`, borda `primary` 1, texto 12/600 `primary`).
       - "Obras · Zona Norte" — "2 agentes · 7 atividades abertas · base a 6,4 km"
       - "Tapa-buraco rápido" — "2 agentes · 1 atividade aberta · base a 3,9 km"
     - **Prazo interno** + "visível só para a prefeitura e a equipe". Campo 240x40, raio 8, borda `border-input` 1, `calendar` 16 + "23 out 2026 (3 dias)" (14). Ajuda: "Sugerido pela categoria Buraco na via." (13 `text-secondary`).
     - **Instruções para o agente** + "opcional". Campo multilinha 96 de altura, raio 8, padding 12, texto 14 lh 1.45: "Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h." Ajuda (gap 6): `eye-off` 14 + "Aparece no topo da atividade do agente. O cidadão não vê." (13).
  3. Rodapé (fundo `bg`, borda superior, padding 16/24, gap 10, alinhado à direita): efeito "A equipe recebe um aviso e o cidadão vê "Em atendimento"." (13 `text-secondary`, `fill_container`) · "Cancelar" (40, raio 20, `surface`, borda `border-input` 1, 14/600) · "Atribuir" (40, raio 20, `primary`, `user-check` 16 + 14/600 `on-primary`).
- Interações: escolher equipe (só as do setor da categoria? a lista não diz); data do prazo (seletor de data não desenhado; o texto mostra data + "(N dias)"); Cancelar/Fechar/Esc → W1; Atribuir → ocorrência "Em atendimento", atividade criada, push para a equipe.
- Dados: equipes elegíveis (nome, nº de agentes ativos, nº de atividades abertas, endereço/coordenadas da base para a distância), sugestão (mais próxima), prazo padrão da categoria (W7), nome da categoria. Enviados: `occurrenceId`, `teamId`, `dueDate`, `instructions` (opcional), relatos marcados.

### W5 · Triagem

- Propósito: fila de solicitações novas (status "Aberta" sem atribuição), em tabela, mais antigas primeiro.
- Menu: "Triagem" ativo.
- Barra superior com filtros:
  - Título "Triagem"; apoio "12 solicitações novas aguardando análise · mais antigas primeiro".
  - Ação à direita: botão "Ver no mapa" (40, raio 20, borda `border-input` 1, `map` 16 + 14/600 `text-primary`) → W1.
  - Filtros (sem fundo): "Categoria: todas" · "Bairro: todos" · "Só com sugestão de agrupamento" (este também com seta, embora pareça um alternador).
- Conteúdo (padding 24, gap 12):
  - **Tabela** (`surface`, borda `border` 1, raio 12). Cabeçalho: altura 44, padding 0/16, fundo `bg`, borda inferior; textos 13/700 `text-secondary`. Colunas (larguras fixas): "Solicitação" 300 · "Local" 230 · "Relatos" 190 · "Aberta há" 110 · "Setor" 130 · Ações 110 (sem título).
  - Linhas: altura 64, padding 0/16, borda inferior `border` 1 (exceto a última).
    - Solicitação: quadrado 36 raio 10 (cor do grupo) com ícone 18 + tipo (14/600) e protocolo (12 `text-secondary`).
    - Local: 14 `text-primary`, formato "Logradouro, nº · Bairro".
    - Relatos: `users` 14 `text-secondary` + número 14/600; opcional selo de sugestão (padding 2/8, raio 8, `warning-soft`, `merge` 12 `warning` + texto 12/600 `#78350F`).
    - Aberta há: 14 `text-primary`; **atrasada** em `danger` 14/700 (critério não definido; aparece em "3 dias").
    - Setor: 14 `text-secondary`.
    - Ações (alinhado à direita): botão "Analisar" (32, raio 16, padding 0/12, borda `primary` 1, texto 13/600 `primary`).
  - Linhas de exemplo (ordem do arquivo):

    | Tipo (ícone, fundo)                                         | Protocolo   | Local                        | Relatos            | Aberta há             | Setor      |
    | ----------------------------------------------------------- | ----------- | ---------------------------- | ------------------ | --------------------- | ---------- |
    | Iluminação (`lightbulb`, `primary`)                         | 2026-000088 | Av. Brasil, 1450 · Jardins   | 1                  | **3 dias** (`danger`) | Iluminação |
    | Buraco na via (`construction`, `primary`)                   | 2026-000123 | Rua das Flores, 120 · Centro | 6 · "+1 parecida"  | 2 dias                | Obras      |
    | Lixo e entulho (`trash-2`, `brand-green`)                   | 2026-000097 | Praça da Matriz · Centro     | 3                  | 2 dias                | Limpeza    |
    | Poda de árvore (`trees`, `brand-green`)                     | 2026-000101 | Rua Ipê, 33 · Vila Nova      | 1 · "+2 parecidas" | 1 dia                 | Parques    |
    | Esgoto (`droplets`, `brand-green`)                          | 2026-000140 | Rua XV, 88 · Centro          | 2                  | 18 h                  | Saneamento |
    | Calçada (`footprints`, `primary`)                           | 2026-000142 | Rua Bahia, 210 · Bela Vista  | 1                  | 5 h                   | Obras      |
    | Semáforo (`traffic-cone`, fundo `bg`, ícone `text-primary`) | 2026-000145 | Av. Paulista x Rua Augusta   | 14                 | 2 h                   | Trânsito   |

    Ícones `brand-green` usam `on-brand-green`; os `primary` usam `on-primary`. Pluralização: "+1 parecida" / "+N parecidas". Tempo: "N h" / "1 dia" / "N dias".

  - Rodapé: "Mostrando 7 de 12 · Ao analisar, abre o mesmo painel do mapa (agrupar, atribuir ou recusar)." (13 `text-secondary`). Não há paginação/rolagem desenhada.
- Interações: filtros; "Analisar" (ou a linha) → abre o painel do ponto (o mesmo da W1; se dentro da Triagem como gaveta ou navegando ao mapa, não definido); "Ver no mapa" → W1.
- Dados: solicitações/ocorrências em status de triagem, ordenadas por abertura; categoria (nome, ícone, grupo), protocolo, endereço curto e bairro, nº de relatos, nº de sugestões de agrupamento, tempo desde abertura e regra de atraso, setor responsável; total. Filtro de bairro pede lista de bairros do tenant.

### W3 · Aguardando revisão

- Propósito: revisar a conclusão do agente antes de publicar ao cidadão: escolher fotos, reescrever o texto e publicar, ou devolver ao agente (W3b).
- Menu: "Aguardando revisão" ativo.
- Barra superior simples: "Aguardando revisão"; apoio "5 atendimentos concluídos pelas equipes. O cidadão só recebe depois que você publicar."
- Área horizontal: **Fila** (360) + **Revisão** (resto).
- **Fila** (`surface`, borda direita, padding 16, gap 8). Cartão: padding 12, gap 6, raio 12, borda `border` 1 (selecionado: `primary-soft`, borda `primary` 2). Topo (`space_between`): tipo (15/600) + espera (`hourglass` 14 + texto 13); meta 13 `text-secondary` "Endereço · Setor · Região".
  - Espera **atrasada** em `warning` (ícone e texto 13/700); normal em `text-secondary` 13/500.
  - Itens: "Poda de árvore" · "há 2 dias" (`warning`) · "Rua Ipê, 33 · Parques · Sul"; "Iluminação" · "há 1 dia" (`warning`) · "Av. Brasil, 1450 · Iluminação · Leste"; **"Buraco na via"** (selecionado) · "há 18 h" · "Rua das Flores, 120 · Obras · Centro"; "Lixo e entulho" · "há 5 h" · "Praça da Matriz · Limpeza · Centro"; "Calçada" · "há 2 h" · "Rua XV, 88 · Obras · Centro".
  - O terceiro texto da meta é a **equipe/região** ("Centro", "Sul", "Leste"), não o bairro.
- **Revisão** (vertical):
  1. Cabeçalho (padding 20/24/16/24, gap 6, borda inferior): "Buraco na via · Rua das Flores, 120" (Lexend 18/600). Meta (gap 16; cada item ícone 14 + texto 13): `hard-hat` "João Pereira · Obras · Centro" · `clock-3` "Concluído em 21 out, 15:40" · `map-pin-check` `success` "No local (a 8 m)" (13/600 `success`) · `users` "6 cidadãos aguardando".
  2. Conteúdo (horizontal, padding 24, gap 24), duas colunas `fill_container`:
     - **Coluna Fotos** (gap 16):
       - "Fotos do serviço" + "marque as que o cidadão vai ver".
       - Três miniaturas (gap 12, cada `fill_container`): imagem altura 120 raio 12 (`#CBD5E1` com `image` 22); selecionada com borda `primary` 2; abaixo caixa 20 raio 5 + texto 14/500: Foto 1 e 2 marcadas (`primary`, `check` branco) "Publicar"; Foto 3 desmarcada (caixa `surface` borda `border-input` 1.5) "Não publicar", imagem com opacidade 0.6 e borda `border` 1.
       - Nota (`warning-soft`, raio 10, padding 12, gap 8): `triangle-alert` 16 `warning` + "Antes de publicar, confira se nenhuma foto mostra rostos ou placas de carro." (13 `#78350F`).
       - "Fotos de abertura (cidadãos)" + "para comparar"; 4 miniaturas 64x64 raio 10 (`#94A3B8`).
     - **Coluna Textos** (gap 16):
       - "Relato do agente" + "interno · não é enviado"; caixa somente leitura (fundo `bg`, borda `border` 1, raio 10, padding 14), texto 14 `text-secondary` lh 1.45: "tapei o buraco c asfalto frio, ficou bom. tinha uns moleque da escola atrapalhando kkk".
       - "Texto para o cidadão" + "obrigatório"; campo multilinha 120, raio 10, padding 14, borda `primary` 2 (foco), texto 14 lh 1.45: "Buraco tapado com asfalto a frio. A área foi sinalizada até a secagem e liberada no fim da tarde."
       - Ajuda: `users` 14 + "Os 6 cidadãos recebem este texto e as fotos marcadas." (13).
  3. Rodapé (`surface`, borda superior, padding 14/24, gap 10, à direita): "Devolver ao agente" (40, raio 20, borda `border-input` 1, `undo-2` 16 + 14/600) → W3b; "Publicar para os cidadãos" (40, raio 20, `primary`, `send` 16 + 14/600 `on-primary`).
- Interações: selecionar item da fila; marcar/desmarcar fotos (clicando na caixa ou na imagem); editar texto; publicar (ocorrência "Concluída", solicitações notificadas com texto e fotos marcadas, sai da fila); devolver (W3b). Ampliar foto (galeria) não desenhado.
- Dados: atividades em "Aguardando revisão" ordenadas pela espera; por item: categoria, endereço, setor, equipe/região, agente (nome), data de conclusão, distância ao local, nº de solicitações ativas, fotos do agente (1–3), fotos de abertura dos cidadãos, relato do agente; texto inicial do campo "Texto para o cidadão" (vazio? sugestão? — o exemplo já vem reescrito). Enviados: fotos publicadas (ids), texto público.

### W3b · Devolver ao agente

- Propósito: diálogo para devolver a conclusão ao agente (gera o "Ajuste pedido" da A5).
- Fundo: a W3 inteira (mesmos textos), escurecimento `#0F172A80`.
- Janela (560, x 440 y 129, `surface`, raio 20, mesma sombra da W2):
  1. Cabeçalho: "Devolver ao agente" (Lexend 20/600) + "João Pereira · Buraco na via · Rua das Flores, 120" (14 `text-secondary`); Fechar 36.
  2. Conteúdo (padding 24, gap 20):
     - **"O que precisa ajustar?"** + "marque um ou mais". Opções de múltipla escolha (padding 12/14, gap 12, raio 12): caixa 20 raio 5 + ícone 18 `text-primary` + texto 15. Marcada: fundo `primary-soft`, borda `primary` 2, caixa `primary` com `check`, texto 15/600. Desmarcada: `surface`, borda `border-input` 1, texto 15/normal.
       - "Tirar novas fotos" (`camera`) — marcada
       - "Corrigir o relato" (`pencil-line`)
       - "Voltar ao local: serviço incompleto" (`map-pin`)
     - **"Fotos que não servem"** + "serão descartadas". Miniaturas 96x80 raio 10 (gap 10): Foto 1 normal (borda `border` 1); Fotos 2 e 3 marcadas para descarte (borda `danger` 2, botão 28 círculo `danger` com `x` 16 branco no canto superior direito, x 62 y 6).
     - **"Mensagem para o agente"** + "obrigatório". Campo 80 de altura, raio 8, padding 12, borda `primary` 2: "As fotos 2 e 3 ficaram escuras e não mostram o buraco tapado. Tire uma de perto e uma de longe, com a rua aparecendo."
  3. Rodapé (fundo `bg`): "A atividade volta para a lista do agente. O cidadão continua vendo "Em atendimento"." · "Cancelar" · "Devolver" (`primary`, `undo-2` 16).
- Interações: marcar motivos; clicar na miniatura alterna descarte (presumido); Devolver → atividade "Ajuste pedido", push ao agente, sai da fila de revisão.
- Dados: agente, categoria, endereço; fotos da conclusão. Enviados: motivos (enum: `new_photos`, `fix_report`, `incomplete_service`), fotos descartadas (ids), mensagem.

### W4 · Impedimentos

- Propósito: decidir o próximo passo das atividades que o agente não conseguiu resolver (A4).
- Menu: "Impedimentos" ativo.
- Barra superior simples: "Impedimentos"; apoio "2 atividades que a equipe não conseguiu resolver. Decida o próximo passo."
- **Fila** (360, mesmo estilo da W3). Cartão: topo tipo (15/600) + espera (13 `text-secondary`, sem ícone); endereço (13 `text-secondary`); selo de motivo (padding 3/8, raio 8, `warning-soft`, `octagon-alert` 13 `warning` + texto 13/600 `#78350F`).
  - **"Buraco na via"** (selecionado) · "há 3 h" · "Rua das Flores, 120" · "Falta material ou equipamento"
  - "Iluminação" · "há 1 dia" · "Av. Brasil, 1450" · "Não é da prefeitura"
- **Revisão**:
  1. Cabeçalho (igual ao da W3): "Buraco na via · Rua das Flores, 120"; meta: `hard-hat` "João Pereira · Obras · Centro" · `clock-3` "Registrado em 22 out, 09:10" · `map-pin-check` `success` "No local (a 8 m)" · `users` "Cidadãos veem: Em atendimento". (Os nós guardam os nomes da W3 — "Concluído em…", "6 cidadãos aguardando" — mas o texto é o citado.)
  2. Conteúdo (horizontal, padding 24, gap 24), duas colunas:
     - **Relato do agente** + "interno" (gap 14). Cartão (`warning-soft`, borda `warning` 1, raio 12, padding 16, gap 12): motivo `package-x` 18 `warning` + "Falta material ou equipamento" (15/700 `#78350F`); detalhes (14 `text-primary`, lh 1.45): "Buraco maior que o previsto, uns 2 metros. Precisa de rolo compactador e mais asfalto, não dá com a equipe de tapa-buraco."; foto 180x120 raio 10 (`#CBD5E1`, `image` 22 + "foto do agente" 12).
       - Aqui o motivo "Falta material ou equipamento" tem ícone **`package-x`** (que faltava na A4).
     - **Próximo passo** + "obrigatório" (gap 12). Opções de rádio em cartão (padding 14, gap 12, raio 12; selecionada `primary-soft` borda `primary` 2; demais `surface` borda `border-input` 1). Linha: rádio 20 + ícone 18 + título 15/600 e apoio 13 `text-secondary`:
       - **"Reatribuir a outra equipe"** (`users`) — "A nova equipe recebe a atividade com suas instruções" — selecionada; expande: select (40, raio 8, `surface`, borda `border-input` 1) "Pavimentação · Centro (tem rolo compactador)" + `chevron-down`; campo de instruções (64, raio 8, padding 12) "Buraco de ~2 m na faixa de pedestres. Levar rolo compactador."
       - "Reagendar com a mesma equipe" (`calendar-clock`) — "Define uma nova data; a equipe atual continua responsável"
       - "Recusar solicitação" (`circle-x` `danger`, título em `danger`) — "Você escreve o motivo que os cidadãos vão ler"
  3. Rodapé: só "Confirmar próximo passo" (40, raio 20, `primary`, `check` 16 + 14/600).
- Interações: selecionar item; escolher opção (cada uma expande seus campos — só a 1ª desenhada); confirmar.
- Dados: atividades "Impedida" (categoria, endereço, tempo desde o registro, motivo enum, detalhes, foto opcional, agente, equipe, distância no registro); equipes elegíveis (com descrição, ex. "(tem rolo compactador)" — campo de descrição/capacidade da equipe? não existe na W6). Enviados: decisão (`reassign` + `teamId` + instruções / `reschedule` + data / `reject` + motivo público).

### W6 · Equipes e agentes

- Propósito: gerenciar equipes e seus agentes (login por celular).
- Menu: "Equipes e agentes" ativo. Título da página difere do menu: **"Equipes e pessoas"**.
- Barra superior com ação: "Equipes e pessoas"; apoio "5 equipes · 14 agentes ativos"; botão "Nova equipe" (40, raio 20, borda `border-input` 1, `plus` 16 + 14/600).
- **Abas** (fundo `surface`, borda inferior, padding 0/24, gap 24; aba 44 de altura): "Equipes e agentes" ativa (texto 15/600 `primary`, sublinhado `primary` 3) · "Gestores" (15/500 `text-secondary`) → W6b.
- Área horizontal:
  - **Lista de equipes** (340, `surface`, borda direita, padding 16, gap 8). Cartão (padding 12, gap 4, raio 12; selecionado `primary-soft`/borda `primary` 2): nome 15/600 + meta 13 `text-secondary` "Setor · N agentes · N abertas":
    - "Obras · Centro" — "Obras · 3 agentes · 4 abertas" (selecionada)
    - "Obras · Zona Norte" — "Obras · 2 agentes · 7 abertas"
    - "Pavimentação · Centro" — "Obras · 3 agentes · 2 abertas"
    - "Iluminação · Leste" — "Iluminação · 4 agentes · 5 abertas"
    - "Limpeza · Centro" — "Limpeza Urbana · 2 agentes · 3 abertas"
  - **Equipe selecionada** (padding 24, gap 16):
    - Cabeçalho (gap 12): "Obras · Centro" (Lexend 20/600) + "Setor de Obras · base: Rua do Paço, 50" (14 `text-secondary`); botões 36 raio 18: "Editar" (borda `border-input`, `pencil` 14) e "Adicionar agente" (`primary`, `user-plus` 14, texto `on-primary`).
    - **Tabela** (mesmo estilo da W5). Colunas: "Agente" 250 · "Celular (login)" 180 · "Situação" 130 · "Último acesso" 150 · "Em aberto" 100 · Ações 90. Linhas 60:
      - avatar 32 (`primary-soft`, iniciais 12/700 `primary`) + nome 14/600 · celular 14 · selo · último acesso 14 `text-secondary` · em aberto 14 · `ellipsis` 20 `text-secondary`.
      - "João Pereira" · "(11) 98877-1020" · **Ativo** · "hoje, 09:12" · "2"
      - "Ana Souza" · "(11) 97766-3344" · **Ativo** · "hoje, 07:58" · "2"
      - "Marcos Lima" · "(11) 96655-8899" · **Convidado** · "nunca entrou" · "0"
      - Selo "Ativo": padding 3/8, raio 8, `success-soft`, `circle-check` 12 + 12/600 `success`. Selo "Convidado": fundo `border`, `mail` 12 + 12/600 `text-secondary`.
    - Nota: `info` 16 + "O agente entra no app com o celular cadastrado aqui. Em "⋯": trocar número, mudar de equipe ou desativar." (13).
- Interações: selecionar equipe; Nova equipe / Editar / Adicionar agente (formulários não desenhados); menu "⋯" com "trocar número", "mudar de equipe", "desativar" (não desenhado).
- Dados: equipes (nome, setor, base — endereço e coordenadas, nº de agentes, nº de atividades abertas); agentes por equipe (nome, celular, situação `active`/`invited`/desativado, último acesso, nº de atividades em aberto). Totais (equipes, agentes ativos).

### W6b · Gestores

- Propósito: aba de gestores/admins do painel (login por CPF + e-mail).
- Mesmo shell e barra da W6; apoio "4 gestores · 1 admin da prefeitura"; botão "Novo gestor" (nó ainda nomeado "Nova equipe"; borda `border-input`, `plus`).
- Abas: "Gestores" ativa (15/600 `primary`, sublinhado). **Defeito no arquivo**: a aba "Equipes e agentes" também mantém o sublinhado `primary` 3, com texto inativo.
- Conteúdo (padding 24, gap 12), tabela de largura total. Colunas: "Nome" 230 · "CPF" 150 · "E-mail (recebe o código)" 270 · "Setores" 200 · "Papel" 130 · Ações 60. Linhas 60:
  - "Carlos Almeida" (CA) · "123._**.**_-09" · "c.almeida@prefeitura.sp.gov.br" · "Obras" · **Gestor**
  - "Fernanda Reis" (FR) · "456._**.**_-21" · "f.reis@prefeitura.sp.gov.br" · "Iluminação, Trânsito" · **Gestor**
  - "Paulo Nunes" (PN) · "789._**.**_-55" · "p.nunes@prefeitura.sp.gov.br" · "Limpeza, Parques" · **Gestor**
  - "Rita Campos" (RC) · "321._**.**_-40" · "r.campos@prefeitura.sp.gov.br" · "Todos" · **Admin**
  - CPF mascarado em `text-secondary` (3 primeiros + 2 últimos dígitos). Selo "Gestor": padding 3/8, raio 8, fundo `bg`, 12/700 `text-primary`; "Admin": fundo `text-primary`, texto `#FFFFFF` 12/700. Ações `ellipsis`.
- Nota: `info` 16 + "O gestor entra no painel com o CPF e recebe o código neste e-mail. Ele vê só as ocorrências dos setores marcados." (13).
- Interações: Novo gestor, "⋯" (editar, desativar, reenviar acesso — não desenhados).
- Dados: usuários do painel do tenant (nome, CPF mascarado, e-mail, setores — ou "Todos" para admin, papel `manager`/`tenant_admin`, situação — não exibida). Quem pode ver esta aba (só `tenant_admin`?) não está indicado.

### W7 · Categorias

- Propósito: configurar as categorias que o cidadão vê, com setor, prazo padrão e raio de agrupamento.
- Menu: "Categorias" ativo.
- Barra superior com ação: "Categorias"; apoio "O que o cidadão pode escolher ao registrar uma solicitação"; botão **primário** "Nova categoria" (40, raio 20, `primary`, `plus` 16 `on-primary`).
- Área horizontal: lista (padding 24) + painel de edição (400).
- **Tabela**: colunas "Categoria" 210 · "Setor responsável" 140 · "Prazo padrão" 110 · "Raio de agrupamento" 150 · "No app" 80. Linhas 56 (fundo `surface`; selecionada `primary-soft`). Categoria: quadrado 32 raio 8 com ícone 16 + nome 14/600.

  | Categoria (ícone, fundo)                                      | Setor          | Prazo   | Raio | No app        |
  | ------------------------------------------------------------- | -------------- | ------- | ---- | ------------- |
  | Buraco na via (`construction`, `primary`)                     | Obras          | 3 dias  | 15 m | ligado        |
  | Iluminação (`lightbulb`, `primary`)                           | Iluminação     | 5 dias  | 25 m | ligado        |
  | **Semáforo** (`traffic-cone`, `surface`; selecionada)         | Trânsito       | 1 dia   | 50 m | ligado        |
  | Lixo e entulho (`trash-2`, `brand-green`)                     | Limpeza Urbana | 2 dias  | 30 m | ligado        |
  | Poda de árvore (`trees`, `brand-green`)                       | Parques        | 10 dias | 20 m | ligado        |
  | Esgoto (`droplets`, `brand-green`)                            | Saneamento     | 2 dias  | 20 m | ligado        |
  | Animal (`paw-print`, `brand-yellow`, ícone `on-brand-yellow`) | Zoonoses       | 3 dias  | 50 m | **desligado** |
  - **Chave** (toggle): 40x24, raio 12, padding 3, bolinha 18 branca; ligada fundo `primary` (bolinha à direita); desligada fundo `#CBD5E1` (bolinha à esquerda).
  - Inconsistências de nomes de setor com a W5 ("Limpeza" lá, "Limpeza Urbana" aqui). Semáforo usa fundo `bg` na W5 e `surface` aqui (a categoria não tem grupo de cor definido).

- **Painel Editar categoria** (400, `surface`, borda esquerda):
  1. Cabeçalho (padding 20/24/16/24, borda inferior): "Editar: Semáforo" (Lexend 18/600) + Fechar 32 (`x` 16).
  2. Conteúdo (padding 24, gap 18). Campos (gap 6): rótulo 14/600; campo 40, raio 8, borda `border-input` 1, padding 0/12, valor 14:
     - "Nome no app" — "Semáforo"
     - "Ícone" — "traffic-cone (Semáforo)" (seletor de ícone não desenhado)
     - "Setor responsável" — "Trânsito" (sem seta, mas presumivelmente select)
     - "Prazo padrão" — "1" + unidade "dias" (14 `text-secondary`); ajuda "Usado como prazo interno ao atribuir. O cidadão não vê." (13, lh 1.4)
     - "Raio de agrupamento" — "50" + "metros"; ajuda "Relatos desta categoria a até 50 m são sugeridos como a mesma ocorrência. Semáforos atendem o cruzamento inteiro, por isso um raio maior."
  3. Rodapé (padding 16/24, gap 10, à direita): "Cancelar" (borda `border-input`) · "Salvar" (`primary`).
- Interações: clicar na linha → abre painel; chave "No app" liga/desliga direto na tabela; Nova categoria → presumivelmente o mesmo painel vazio ("Nova categoria"), não desenhado.
- Dados: categorias do tenant (nome, ícone lucide, grupo/cor, setor, prazo padrão em dias, raio em metros, ativa no app). Lista de setores (cadastro de setores não desenhado). O campo grupo/cor não aparece no formulário.

---

## 3. Componentes e tokens novos (web)

Nada novo em variáveis: o painel usa os tokens da seção 3 da spec do cidadão. Literais novos: `#E9EEF2` (fundo do mapa falso), `#D7E8D3` (parque), `#DCE7F3` (texto secundário sobre azul no login), `#0F172A80` (escurecimento do diálogo; o cidadão usa `#0F172A8C`), `#0F172A40` (sombra do diálogo), `#1557B0AA` (brilho do pino selecionado), `#CBD5E1` (chave desligada e marcador de foto), `#94A3B8` (fotos de abertura), `#FBBF24` (ícone da faixa de suporte), `#78350F` (texto sobre `warning-soft`, recorrente — candidato a token `on-warning-soft`).

Tipografia web: títulos de página Lexend 22/600; títulos de painel/diálogo Lexend 20/600 (18 no cabeçalho da revisão e da edição de categoria; 16 em "Relatos neste ponto"); login Lexend 28 e 44. Corpo 14 (dominante), 13 metadados/ajudas, 12 selos/protocolos; rótulos 15/600; itens de menu 15. Peso **700** usado bastante (contadores, cabeçalhos de tabela, selos, números dos pinos, grupos do menu).

Raios: 8 (filtros, campos web, selos de tabela), 10 (campos do login, dígitos, contadores do menu, miniaturas), 12 (itens do menu, cartões de fila/opção, tabelas), 14 (legenda, linha de relato, sugestão), 20 (diálogos, busca, botões 40), 24 (botões 48), 16–22 (botões 32/36/44 em pílula).

Componentes:

- **Shell** (menu lateral 256 + barra superior), com contador por item (`primary`/`warning`/`danger`), grupos em caixa alta, caixa do usuário com sair.
- **Item de menu** ativo/inativo (44, raio 12).
- **Filtro dropdown** (32, raio 8) + link "Limpar filtros"; **busca** em pílula (300x40).
- **Botões web**: primário 40 (raio 20, ícone 16 + 14/600); secundário 40 com borda `border-input`; ação de linha 32 contorno `primary` ("Analisar"); 36 em cabeçalho de seção; 48/44 no painel do ponto; destrutivo contorno `danger` ("Recusar"); botões âmbar da sugestão.
- **Tabela**: contêiner raio 12 borda `border`; cabeçalho 44 fundo `bg` texto 13/700 `text-secondary`; linhas 56/60/64 com divisória `border`; colunas de largura fixa; coluna de ações à direita (botão ou `ellipsis`); linha selecionada `primary-soft`.
- **Quadrado de categoria** em 3 tamanhos: 44 (painel), 36 (triagem), 32 (categorias) — cor por grupo (`primary`, `brand-green`, `brand-yellow`, neutro).
- **Selos/etiquetas**:
  - Situação de pessoa: "Ativo" (`success-soft`/`success`, `circle-check`), "Convidado" (`border`/`text-secondary`, `mail`).
  - Papel: "Gestor" (`bg`), "Admin" (`text-primary` + branco).
  - Motivo de impedimento (`warning-soft`, `octagon-alert`, `#78350F`).
  - Sugestão de agrupamento "+N parecida(s)" (`warning-soft`, `merge`).
  - Etiquetas do ponto: status+tempo ("Aberta há 2 dias", `hourglass`, fundo `border`), "N relatos" (`users`), "Raio N m" (`radius`).
  - Tempo de espera: normal `text-secondary`, atrasado `warning` 700 (filas) ou `danger` 700 (triagem).
- **Pino de mapa / cluster**: círculo com contagem, borda branca 3, tamanho 32–64 proporcional, cor por faixa (≤4 `primary`, 5–15 `warning`, >15 `danger`), selecionado com borda 4 e brilho. **Legenda** e **controle de zoom**.
- **Painel lateral de detalhe** (440 no mapa, 400 na edição): cabeçalho com Fechar 36/32, conteúdo rolável, rodapé de ações fixo.
- **Linha de relato selecionável** (caixa 22 + miniatura 52 + texto).
- **Cartão de sugestão** (âmbar, com duas ações).
- **Diálogo modal** (560, raio 20, sombra, escurecimento): cabeçalho título+apoio+Fechar, conteúdo padding 24 gap 20, rodapé fundo `bg` com texto de efeito à esquerda e Cancelar/Confirmar à direita.
- **Opção de rádio em cartão** (com meta e selo "Sugerida"), **opção de rádio expansível** (W4) e **opção de checkbox em cartão** (W3b).
- **Caixa de seleção** 20 raio 5 e **rádio** 20.
- **Miniatura de foto selecionável** (Publicar/Não publicar; descarte com `x` vermelho).
- **Fila mestre-detalhe** (lista 360/340 + detalhe), cartões de fila com selecionado `primary-soft`.
- **Abas** com sublinhado 3 `primary`.
- **Chave liga/desliga** 40x24.
- **Campo com unidade** ("dias", "metros") e **campo de data** com `calendar`.
- **Nota informativa** (`info` 16 + 13) e **nota de alerta** (`warning-soft` + `triangle-alert`).
- **Entrada de código de 6 dígitos** (web: 56 de altura, raio 10).
- **Layout de login dividido** (institucional 600 + formulário).
- **Faixa de modo suporte** (P4).

---

## 4. Status mostrados no painel

| Status / estado                  | Onde            | Como aparece                                                    |
| -------------------------------- | --------------- | --------------------------------------------------------------- |
| Aberta (triagem)                 | W1, W5          | etiqueta "Aberta há N" (fundo `border`); fila Triagem           |
| Em atendimento                   | W2 (texto), W4  | só citado ("o cidadão vê "Em atendimento""); sem selo desenhado |
| Aguardando revisão               | W3              | fila própria, espera em `warning` quando antiga                 |
| Ajuste pedido                    | W3b (resultado) | não aparece no painel depois de devolver                        |
| Impedida                         | W4              | fila própria com selo de motivo                                 |
| Concluída / Recusada / Cancelada | —               | não desenhados no painel                                        |

---

## 5. Diferenças em relação ao app / `design-system.md`

1. Escala web mais densa: corpo 14, botões 40 (raio 20), campos 40 (raio 8) — o design-system descreve o app (56/raio 16). Login usa campo 48 raio 10.
2. Peso 700 frequente (doc prevê 400/500/600).
3. Texto branco literal `#FFFFFF` em contadores, pinos, selos e botões âmbar; `#78350F` sem token.
4. Sombra em diálogos e no pino selecionado (doc: "sem sombras").
5. Cor por faixa de relatos nos pinos usa `danger`/`warning`/`primary` como escala de intensidade, não como estado — conflita com o significado semântico das cores no resto do produto.
6. Atraso marcado com `danger` na W5 e com `warning` na W3 (sem regra única).
7. Menu diz "Equipes e agentes", página diz "Equipes e pessoas".
8. Nomes de setor divergentes entre telas ("Limpeza" × "Limpeza Urbana").
9. Ícone de Semáforo sem cor de grupo (fundo `bg` na W5, `surface` na W7).
10. W6b com duas abas sublinhadas (erro do arquivo).

---

## 6. Lacunas (o que o Pencil não mostra)

Telas e navegação:

- **"Em atendimento"** e **"Todas as solicitações"** (itens do menu) não têm tela. Também não há detalhe de solicitação/ocorrência fora do painel do mapa, nem histórico/auditoria da ocorrência.
- **Recusar** (W1 e W4 opção 3): diálogo com motivo público não desenhado; lista de motivos padrão inexistente.
- **Separar desmarcados** (W1): confirmação e resultado (nova ocorrência?) não desenhados.
- **Juntar a este ponto / É outro problema**: estado depois da ação não desenhado.
- **Reagendar com a mesma equipe** (W4): campos expandidos (data, instruções?) não desenhados.
- **Nova equipe / Editar equipe / Adicionar agente / Novo gestor / Nova categoria**: formulários não desenhados; menus "⋯" (trocar número, mudar de equipe, desativar, reenviar convite, editar gestor) não desenhados. Cadastro de **setores** e de **base da equipe** (endereço, mapa) não existe; equipe não tem campo de "capacidade" embora a W4 mostre "(tem rolo compactador)".
- **Configurações da prefeitura** (`tenant_admin`): dados da prefeitura, limite geográfico, logotipo — nada desenhado; também não está claro o que o `tenant_admin` vê a mais que o gestor (W6b só para admin?).
- **Perfil do gestor/sair**: sem menu de usuário, sem confirmação de saída, sem troca de e-mail.

Estados:

- **Login**: CPF inválido, CPF não cadastrado/desativado, código errado, código expirado, limite de tentativas, link "Reenviar" ativo ao zerar o contador, carregando no botão.
- **Vazios**: mapa sem ocorrências, filas vazias (Triagem, Revisão, Impedimentos — "tudo em dia"), equipe sem agentes, nenhuma categoria; busca sem resultado.
- **Carregando e erro de rede** em todas as telas; falha ao salvar/publicar/atribuir; conflito (outra pessoa já atribuiu/publicou o item).
- **Mapa**: painel do ponto fechado (mapa em largura total), pino individual (1 relato) vs. cluster por zoom, pinos sobrepostos, hover/tooltip, ponto com status "Em atendimento" (cor? ícone?), seleção pela busca.
- **W3**: sem nenhuma foto marcada (Publicar bloqueado?), texto vazio, pré-visualização do que o cidadão recebe, foto ampliada.
- **W5**: paginação/rolagem infinita ("Mostrando 7 de 12" sem controle), ordenação por coluna, critério de atraso, hover de linha; onde abre o "Analisar" (gaveta na própria triagem ou navega ao mapa).
- **Feedback** após ações (toast/confirmação), confirmação ao fechar diálogos com dados preenchidos, validação de obrigatórios (Equipe, Mensagem, Texto para o cidadão).
- **Responsivo**: só 1440x900; sem comportamento para 1280/1024, menu recolhido, ou tablet. Rolagem: tabelas, filas e painéis com mais itens do que cabem não têm regra de rolagem.
- **Seletor de data** e **seletor de ícone** (W2, W4, W7) não desenhados.
- **Permissões por setor**: a nota da W6b diz que o gestor vê só os setores marcados — o efeito nos contadores, filtros e listas de equipe (W2) não está desenhado.
- **Notificações em tempo real** (novos itens na fila, contadores atualizando) não indicadas.
- **Modo suporte** (P4): além da faixa, não há indicação do que muda (ações bloqueadas? auditoria visível?).
- Textos e dados são exemplos (Prefeitura de São Paulo, Carlos Almeida, protocolos, contagens, distâncias).

## 7. Telas do Plano 7 e do pronto para validação (Pencil, 03/11/2026)

Feitas no código antes do Pencil e passadas para ele em 03/11/2026 (Task 1b). O mapa não pode ser importado pelo navegador do Pencil (a importação trava no mapa), então a W1c e a W1d são cópias da W1 editadas no Pencil conforme a tela do código; a W8 foi importada do código rodando. Textos confirmados pelo usuário em 03/11/2026.

| Captura (`docs/superpowers/specs/telas-painel/`) | Tela no Pencil                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `W1c-mapa-prazo-bairro.png`                      | W1c: filtros de Prazo e Bairro, faixa de números do dia (Na triagem, Em atendimento, Vencem em 2 dias, Atrasadas), pinos e legenda pela situação do prazo, sino e Dados da prefeitura no menu |
| `sino-avisos.png`                                | W1d: painel `Avisos` aberto, com não lidos destacados e `Marcar todos como lidos`                                                                                                             |
| `W8-dados-da-prefeitura.png`                     | W8: Dados da prefeitura (só leitura) para o gestor                                                                                                                                            |
