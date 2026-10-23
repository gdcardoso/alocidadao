# Telas do app do cidadão — extração do Pencil

Fonte: `design/alocidadao.pen` (seção "Cidadão", lida via MCP do Pencil, sem alterações). Todas as telas têm 390 de largura (altura 844 nas fixas; as com rolagem crescem conforme o conteúdo), fundo `$bg`, layout vertical, e começam com uma **Status Bar** (62 de altura, "9:41" em Inter 16/600, ícones lucide `signal`, `wifi`, `battery-full`, tamanho 17). A Status Bar é simulação do iOS e não deve ser implementada.

Ícones: biblioteca **lucide**. Fontes: corpo `$font` = Source Sans 3; títulos `$font-heading` = Lexend.

Telas encontradas: 14 (0, 1, 2, 3, 4, 5, 5b, 5c, 6a, 6b, 6c, 6d, 7, 8). Todas existem. Não há tela dedicada de permissão de localização nem de offline do cidadão; ver "Lacunas" no fim.

Convenção: `obrigatório`/`opcional` são textos pequenos (14, `text-secondary`) à direita do rótulo do campo. Nós com `enabled=false` no arquivo estão ocultos (variantes de estado dentro da mesma tela) e estão marcados como "oculto".

---

## 1. Telas

### 0 · Abertura (splash)

- Propósito: tela de abertura da marca.
- Frame 390x844, `layout=none`, fundo branco + imagem `abertura.png` (cover): branco no alto, cidade e faixa verde/amarela embaixo.
- Único elemento: logo `logo.png` (300x130, contain) em x=45, y=250. Sem texto, sem botão.
- Navegação implícita: segue para 1 Entrar (ou 4 se já logado).

### 1 · Entrar (celular)

- Propósito: pedir o celular para login/cadastro por SMS.
- Layout: Conteúdo (padding 40/24/24/24, gap 32), Rodapé (padding 0/24/36/24).
  1. Marca: logo (240x104) + texto de apoio (17, `text-secondary`): "Avise a prefeitura sobre problemas na sua cidade e acompanhe cada etapa do atendimento."
  2. Campo Celular: rótulo "Seu celular" (Lexend 16/500). Campo 56 de altura, raio 16, fundo `surface`, borda `primary` 2 (estado foco): "+55" (17/600) · divisor vertical 1x24 `border-input` · "(11) 98765-4321" (valor de exemplo, cor `text-primary`). Ajuda (14, `text-secondary`): "Enviaremos um código por SMS para confirmar que o número é seu."
  3. Rodapé: botão primário "Continuar" (56, raio 28, `primary`, texto 17/600 `on-primary`).
- Teclado: numérico/telefone (implícito; DDI +55 fixo, máscara `(XX) XXXXX-XXXX`).
- Navegação: Continuar → 2 Código.

### 2 · Código

- Propósito: confirmar o SMS.
- Navegação (topo): botão Voltar circular 44x44 (`surface`, borda `border`, ícone `arrow-left` 20) → 1.
- Conteúdo (padding 24, gap 28):
  1. Título "Digite o código" (Lexend 26/600). Apoio: "Enviado por SMS para (11) 98765-4321." (16, `text-secondary`). Link "Alterar número" (16/600, `primary`) → 1.
  2. Seis caixas de dígito (fill_container, altura 60, raio 14, `surface`, borda `border-input`; Lexend 26/600). Exemplo: "4", "8", "2" preenchidos, 4ª com cursor (barra 2x28 `primary`, borda `primary`), 5ª e 6ª vazias.
  3. Reenviar: ícone `timer` 18 + "Reenviar código em 0:45" (16, `text-secondary`).
- Rodapé: botão "Confirmar", desativado (opacidade 0.45) enquanto o código está incompleto.
- Navegação: Confirmar → 3 Seus dados (conta nova) ou 4 (conta existente).

### 3 · Seus dados ("Quase lá")

- Propósito: completar o cadastro.
- Topo: Voltar (44x44, `arrow-left`) → 2.
- Conteúdo (padding 24, gap 24):
  1. Título "Quase lá!" (Lexend 26/600); apoio "Número confirmado. Só faltam alguns dados." (16, `text-secondary`).
  2. Campo "Nome" + "obrigatório": campo 56, raio 16, borda `border-input`, valor de exemplo "Maria da Silva" (17).
  3. Campo "E-mail" + "opcional": placeholder "seuemail@exemplo.com" (17, `text-placeholder`). Ajuda (14): "Ajuda a recuperar sua conta se você trocar de número."
  4. Termos: caixa de seleção 24x24 marcada (`primary`, raio 6, ícone `check` 16 `on-primary`) + "Li e aceito os Termos de Uso e a Política de Privacidade." (15, `text-primary`).
- Rodapé: botão primário "Criar conta" → 4 Minhas solicitações.
- Rótulos dos campos: Lexend 16/500.

### 4 · Minhas solicitações

- Propósito: lista de solicitações do cidadão (tela inicial após login).
- Cabeçalho (padding 4/20/8/20): "Olá, Maria" (16, `text-secondary`); título "Minhas solicitações" (Lexend 24/600); chip de cidade (raio 20, `surface`, borda `border`, ícone `map-pin` 16 `primary`, texto 14/500): "Você está em São Paulo".
- Conteúdo (padding 8/20/20/20, gap 16):
  - Filtros (chips 40 de altura, raio 20, texto 15/600): "Todas" (selecionado: fundo e borda `text-primary`, texto branco), "Em andamento", "Concluídas" (fundo `surface`, borda `border-input`).
  - Cartões de solicitação (raio 20, padding 16, gap 14, fundo `surface`; borda `border` 1, exceto o que pede ação: borda `warning` 2). Estrutura: Topo = ícone de categoria em quadrado 48 (raio 14) + Tipo (17/600) + Endereço (14, `text-secondary`) + `chevron-right` 20; Rodapé = selo de status + Meta (13, `text-secondary`) "protocolo · data".
    1. "Buraco na via" · "Rua das Flores, 120" · ícone `construction`, fundo `primary` · status "Aguardando sua confirmação" (ícone `circle-alert`, fundo `warning-soft`, texto `warning`) · meta "2026-000123 · Hoje, 08:12" · botão de ação dentro do cartão "Ver atendimento e confirmar" (48, raio 24, `primary`, 16/600) → 6c.
    2. "Iluminação" · "Av. Brasil, 1450" · `lightbulb`, `primary` · "Em atendimento" (ícone `hard-hat`, fundo `primary-soft`, texto `primary`) · "2026-000118 · 18 out" → 6b.
    3. "Lixo e entulho" · "Praça da Matriz" · `trash-2`, fundo `brand-green`, ícone `on-brand-green` · "Aberta" (ícone `inbox`, fundo `border`, texto `text-secondary`) · "2026-000097 · 15 out" → 6a.
    4. "Poda de árvore" · "Rua Ipê, 33" · `trees`, `brand-green` · "Concluída" (ícone `circle-check`, fundo `success-soft`, texto `success`) · "2026-000052 · 02 out".
- Barra inferior (tab bar flutuante): ver componente "Barra de abas". Aba ativa: Solicitações.
- Estados: não há tela de lista vazia, carregando ou erro desenhada.
- Navegação: cartão → detalhe 6a/6b/6c (6d para recusada); "Nova" → 5; "Perfil" → 8.

### 5 · Nova solicitação

- Propósito: registrar solicitação com foto, local e tipo.
- Cabeçalho (padding 0/16/8/16): Fechar (44x44, ícone `x`) à esquerda; título centralizado "Nova solicitação" (Lexend 18/600); espaçador 44x44. Fechar com dados preenchidos pede confirmação (design-system.md).
- Conteúdo (padding 8/20/24/20, gap 24):
  1. Foto (350x230, raio 24, imagem cover) com sobreposições: gradiente escuro embaixo (350x120, de `#0F172A00` a `#0F172AD9`); pílula "Fotos" (fundo `#0F172AB3`, raio 22) com contador "1 de 3" (15/600 branco) + botão adicionar 32x32 branco com `plus` 18 `primary`; botão Remover 44x44 (`#0F172AB3`, ícone `trash-2` 18 branco); pílula Local (326x48, `#FFFFFFF2`, raio 24): `map-pin` 20 `primary` + endereço "Rua das Flores, 120 — Centro" (15/600) + botão "Ajustar" (40, `primary-soft`, texto `primary` 15/600).
  2. "Tipo de solicitação" (Lexend 18/600) + "obrigatório". Grade 3 colunas de opções (altura 100, raio 20, fundo `surface`, borda `border-input` 1; ícone em círculo 44 + nome 15/500). Ordem: Buraco na via (`construction`, `primary`), Iluminação (`lightbulb`, `primary`), Lixo e entulho (`trash-2`, `brand-green`) / Poda de árvore (`trees`, `brand-green`), Esgoto (`droplets`, `brand-green`), Calçada (`footprints`, `primary`) / Sinalização (`signpost`, `primary`), Animal (`paw-print`, `brand-yellow`, ícone `on-brand-yellow`), Outro (`circle-ellipsis`, `brand-yellow`).
     - Selecionada (Buraco na via): fundo `primary-soft`, borda `primary` 2, nome em `primary` 15/600, selo verde 22x22 (`success`, borda `surface` 2, `check` 14 branco) no canto do ícone; ícone continua visível.
  3. Linha "Adicionar observação" (56, raio 20, borda `border-input`): `message-square-plus` 22 `primary` + texto 16/600 + "opcional". Abre campo de texto (não desenhado).
- Rodapé (fundo `surface`, borda superior `border`, padding 14/20/28/20): botão "Enviar solicitação" (ícone `send` 20, 56, raio 28, `primary`) + aviso offline: ícone `wifi-off` 16 + "Sem internet? Enviamos assim que conectar." (14, `text-secondary`).
- Estados: carregando/desativado do botão durante envio e fila offline são regras do design-system.md; não há quadro específico.
- Navegação: Enviar → 4 (ou, se houver relato próximo, painel 5b); local fora de cidade aderente → 5c; Fechar → volta (4).

### 5b · Já relataram aqui (painel sobre a 5)

- Propósito: evitar duplicidade; sugerir apoiar relato existente.
- Base: a tela 5 inteira, coberta por escurecimento `#0F172A8C` (390x967). Painel inferior (bottom sheet): fundo `surface`, cantos superiores 28, padding 12/20/32/20, gap 20, ancorado embaixo (y=507).
- Conteúdo do painel:
  1. Alça (barra 40x5, `#CBD5E1`, raio 3).
  2. Título "Já relataram isso aqui perto" (Lexend 22/600); apoio "Se for o mesmo problema, apoie o relato existente. Você acompanha o atendimento e recebe os avisos do mesmo jeito." (16, `text-secondary`).
  3. Cartão da ocorrência (fundo `bg`, raio 20, borda `border-input` 1, padding 16): ícone `construction` em quadrado 48 `primary`; "Buraco na via" (17/600); "A 12 m de você · Rua das Flores" (14, `text-secondary`); chips: "6 pessoas relataram" (ícone `users`, fundo `surface`, 14/600) e "Em atendimento" (ícone `hard-hat`, `primary-soft`).
  4. Botões: primário "É o mesmo, apoiar relato" (ícone `hand-heart`, 56, raio 28); secundário "Não, é outro problema" (fundo `surface`, borda `border-input` 1.5, texto `text-primary` 17/600).
- Navegação: "É o mesmo" → apoia o relato e vai ao detalhe dele / 4; "Não, é outro problema" → fecha o painel e segue o envio da 5. Fechar o painel por arrastar/toque no fundo é implícito (alça).

### 5c · Prefeitura não aderiu

- Propósito: cidade do GPS sem prefeitura cadastrada.
- Cabeçalho: só Fechar (44x44, `x`) → volta.
- Conteúdo (padding 24, gap 24):
  1. Círculo 72 (`border`) com ícone `map-pin-off` 34 `text-secondary`.
  2. Título "Campinas ainda não usa o Alô Cidadão" (Lexend 24/600). Texto: "Pela sua localização, você está em Campinas — SP. A prefeitura daqui ainda não aderiu ao sistema, então não é possível registrar solicitações por aqui." (16, `text-secondary`). Cidade é variável.
  3. Cartão de contato (`surface`, raio 20, borda `border`): ícone `phone` 20 `primary` + "Fale direto com a prefeitura" (16/600); texto "Procure a central de atendimento da Prefeitura de Campinas. Em muitas cidades, o número é 156." (15); botão contorno "Ligar para 156" (ícone `phone-call` 18, 48, raio 24, borda `primary` 1.5, texto `primary`) → discador.
- Rodapé (padding 0/24/36/24, gap 12): botão primário "Quero o Alô Cidadão aqui" (ícone `megaphone`); explicação "Avisamos a prefeitura que moradores querem o serviço." (14, `text-secondary`); botão texto "Voltar para minhas solicitações" (48, texto `primary` 16/600) → 4.
- Esta é a única tela que trata permissão/localização indiretamente (cidade detectada por localização).

### Estrutura comum das telas de detalhe 6a–6d

- Cabeçalho (gap 12, padding 0/16/8/16): Voltar (44x44, `arrow-left`) → 4; Tipo (Lexend 20/600, "Buraco na via") e "Protocolo 2026-000123" (14, `text-secondary`).
- Conteúdo (padding 8/20/24/20, gap 24), na ordem: **Aviso de status** (cartão raio 20, padding 16, ícone 22 + título 16/600 + texto 15) · **Antes e depois** (duas colunas de Pilha de fotos com legenda 14/600 `text-secondary`: "Sua foto" e "Depois do atendimento") · **Relato da equipe** (cartão) · **Sua solicitação** (título Lexend 17/600 + lista de dados) · **Andamento** (título Lexend 17/600 + linha do tempo).
- Lista "Sua solicitação" (cartão `surface`, raio 20, borda `border`, linhas com padding 16, ícone 20 `primary`, rótulo 14 `text-secondary`, valor 16): `map-pin` "Local" → "Rua das Flores, 120 — Centro"; `message-square` "Sua observação" → "Buraco grande perto da faixa de pedestres"; `calendar` "Aberta em" → "20 out 2026, 08:12".
- Linha do tempo: 4 etapas, trilho de 24 (marcador circular 24 + linha 2 de largura), textos etapa 16/600 + detalhe 14 `text-secondary`; altura 68 (última 48). Marcadores: concluído = fundo/borda `success` + `check` 14 branco, linha `success`; atual = `surface` com borda `primary` e ícone `dot`; futuro = `surface` com borda `border-input`, linha `border-input`; "Sua confirmação" pendente = borda `warning` com ponto 8 `warning`.
- Pilha de fotos toca → 7 Galeria.

### 6a · Detalhe (aberta)

- Aviso (fundo `#F1F5F9`, borda `border-input`): ícone `hourglass` `text-secondary`; "Aberta há 3 dias"; "Aguardando a prefeitura analisar e encaminhar para uma equipe. Você recebe um aviso a cada mudança."
- Antes e depois: só "Sua foto" (coluna "Depois do atendimento" oculta). Relato da equipe: oculto (texto de exemplo guardado: "Equipe Obras · Centro", "Concluído em 21 out, 15:40", "Buraco tapado com asfalto a quente. Área sinalizada até a secagem, liberada no fim da tarde.").
- Andamento: "Aberta" (marcador atual, `dot`) · "20 out, 08:12 · há 3 dias"; "Em atendimento" · "Encaminhamento para uma equipe"; "Conclusão pela equipe" · "Execução do serviço"; "Sua confirmação" · "Depois da conclusão". (Rótulo no nó: "Concluída pela equipe", texto exibido: "Conclusão pela equipe".)
- Rodapé (fundo `surface`, borda superior): botão "Cancelar solicitação" (ícone `circle-x`, contorno `danger` 1.5, texto `danger` 17/600) — única ação; "Sim, foi resolvido" oculto.

### 6b · Detalhe (em atendimento)

- Aviso (fundo `primary-soft`, borda `primary`): ícone `hard-hat`; "Em atendimento há 2 dias"; "A Equipe Obras · Centro está cuidando da sua solicitação. Você recebe um aviso quando o serviço for concluído."
- Antes e depois: só "Sua foto". Relato da equipe oculto.
- Andamento: "Aberta" concluída · "20 out, 08:12"; "Em atendimento" atual (`dot`, borda `primary`) · "Equipe Obras · Centro · desde 20 out, 14:30"; "Conclusão pela equipe" · "Execução do serviço" (futuro); "Sua confirmação" · "Depois da conclusão".
- Rodapé: oculto (sem ação). O rodapé oculto guarda "Sim, foi resolvido" (`thumbs-up`) e "Não foi resolvido" (`thumbs-down`).

### 6c · Detalhe (aguardando confirmação)

- Aviso (fundo `warning-soft`, borda `warning`): ícone `circle-alert`; "A prefeitura concluiu o atendimento"; "Confira as fotos e diga se o problema foi resolvido. Sem resposta, confirmamos automaticamente em 7 dias."
- Antes e depois: duas colunas visíveis — "Sua foto" e "Depois do atendimento" (a segunda pilha com fundo `#CBD5E1` no override e contador "2").
- Relato da equipe visível: ícone `hard-hat` (círculo `primary-soft`), "Equipe Obras · Centro", "Concluído em 21 out, 15:40", "Buraco tapado com asfalto a quente. Área sinalizada até a secagem, liberada no fim da tarde."
- Andamento: "Aberta" · "20 out, 08:12"; "Em atendimento" · "Equipe Obras · Centro · 20 out, 14:30"; "Concluída pela equipe" · "21 out, 15:40" (todas `success`); "Sua confirmação" (marcador `warning`, etapa em `text-primary`) · "Aguardando você".
- Rodapé: primário "Sim, foi resolvido" (`thumbs-up`) e secundário contorno `border-input` "Não foi resolvido" (`thumbs-down`, texto `text-primary`). "Não foi resolvido" abre fluxo de contestação (não desenhado).

### 6d · Detalhe (recusada)

- Aviso (fundo `danger-soft`, borda `danger`): ícone `circle-x`; "Solicitação recusada"; "Veja abaixo o motivo informado pela prefeitura."
- Antes e depois: só "Sua foto".
- Relato da equipe (ícone `landmark` em círculo `danger-soft`/`danger`): "Motivo da recusa" · "Secretaria de Obras · 20 out, 16:05" · "O local fica numa rodovia estadual (SP-055), que é de responsabilidade do DER. Encaminhamos sua solicitação ao órgão."
- Andamento (2 etapas): "Aberta" (`success`) · "20 out, 08:12"; "Recusada" (marcador `danger` com ícone `x`) · "Secretaria de Obras · 20 out, 16:05". Demais etapas ocultas.
- Rodapé: oculto (sem ação).

### 7 · Galeria de fotos

- Propósito: ver fotos em tela cheia (do cidadão e da equipe).
- Fundo `#000000`, sem tema claro.
- Topo: Fechar (44x44, fundo `#FFFFFF26`, `x` 22 branco); contador "1 de 3" (17/600 branco); espaçador 44.
- Palco: carrossel horizontal; foto atual 334x420 (raio 12) com bordas das fotos anterior/seguinte aparecendo (`#334155`).
- Rodapé (padding 0/20/40/20, gap 16): indicadores de página (atual 24x8 branco, demais 8x8 `#FFFFFF66`); legenda "Sua foto · abertura" (16/600 branco) e "20 out 2026, 08:12 · Rua das Flores, 120" (14, `#CBD5E1`); dica: ícone `move-horizontal` 18 + "Deslize para ver as outras fotos" (14, `#CBD5E1`).
- Navegação: Fechar → detalhe de origem.

### 8 · Perfil

- Cabeçalho (padding 8/20, gap 14): "Perfil" (Lexend 24/600); identificação: avatar 56 (`primary-soft`, iniciais "MS" Lexend 20/600 `primary`), nome "Maria da Silva" (18/600), telefone "(11) 98765-4321" (15, `text-secondary`; nó nomeado "Cidade").
- Conteúdo (padding 16/20/24/20, gap 24). Seções com título 14/600 `text-secondary` e lista em cartão (raio 20, borda `border`, linhas com padding 14/16, ícone 20 `primary`, rótulo 16/600, valor 14 `text-secondary`):
  - "Conta": `user` "Nome" → "Maria da Silva" · ação "Editar"; `smartphone` "Celular" → "(11) 98765-4321" · "Trocar número"; `mail` "E-mail de recuperação" → "Não informado" · "Adicionar" (ações 15/600 `primary`).
  - "Sobre": `file-text` "Termos de Uso" ›; `shield-check` "Política de Privacidade" › (`chevron-right`).
  - "Sessão": `log-out` "Sair da conta" — "Para entrar de novo, use seu celular" ›.
  - Botão perigo: "Excluir minha conta" (ícone `trash-2` 18, 52, raio 26, borda `danger` 1.5, texto `danger` 16/600). Exige confirmação.
- Barra inferior: aba ativa Perfil.
- Navegação: Editar/Trocar número/Adicionar → edição (não desenhada; Trocar número provavelmente repete 1→2); Sair → 1.

---

## 2. Componentes compartilhados

Só um componente é `reusable` no fluxo do cidadão; o resto é repetido como frames (candidatos a componentes no código).

- **Pilha de fotos** (`rO6md`, reusable, 170x162, layout none): dois retângulos de fundo (Fundo 2 138x140 `#94A3B8` raio 16 em x=16; Fundo 1 154x140 `#64748B` raio 17 em x=8,y=6) + Foto (170x150, y=12, raio 18, borda branca 2, imagem cover) com selo "Quantidade" (62x32, `#0F172AD9`, raio 16, ícone `images` 16 + número 15/600 branco, padrão "3"). Overrides usados: foto `#CBD5E1` e contador "2" para "Depois do atendimento".
- **Botão primário**: altura 56, raio 28 (pílula), `primary`, texto 17/600 `on-primary`; ícone opcional 20 à esquerda (gap 10). Desativado = opacidade 0.45. Pressionado: `primary-strong` (token, sem quadro).
- **Botão secundário**: 56, raio 28, `surface`, borda `border-input` 1.5, texto `text-primary` 17/600. Variante perigo: borda e texto `danger`. Variante contorno azul (5c): 48, raio 24, borda `primary` 1.5. Botão texto: 48, sem fundo, texto `primary` 16/600. Botão na lista (4): 48, raio 24.
- **Voltar/Fechar**: círculo 44, `surface`, borda `border` 1, ícone `arrow-left`/`x` 20.
- **Campo de texto**: 56, raio 16, `surface`, borda `border-input` 1 (foco: `primary` 2), padding 0/16, valor 17; rótulo Lexend 16/500 acima; "obrigatório"/"opcional" 14 à direita; ajuda 14 `text-secondary` abaixo.
- **Caixas de código**: 6 × (altura 60, raio 14, borda `border-input`; ativa `primary`).
- **Caixa de seleção**: 24x24, raio 6, `primary` com `check`.
- **Chip de filtro**: 40, raio 20; selecionado `text-primary` com texto branco; outros `surface` + `border-input`.
- **Chip de cidade**: raio 20, `surface`, borda `border`, `map-pin` + 14/500.
- **Selo de status** (raio 14, padding 6/10, ícone 16 + 14/600): Aberta (`border` / `text-secondary`, `inbox`); Em atendimento (`primary-soft` / `primary`, `hard-hat`); Aguardando sua confirmação (`warning-soft` / `warning`, `circle-alert`); Concluída (`success-soft` / `success`, `circle-check`); Recusada usa `danger`/`danger-soft` (`circle-x`) só no aviso do detalhe (a lista não mostra recusada).
- **Cartão de solicitação**: ver tela 4 (raio 20, padding 16, quadrado de ícone 48 raio 14).
- **Ícone de categoria**: círculo 44 (opção da tela 5) ou quadrado 48 raio 14 (lista), cor do grupo; ver mapa na tela 5.
- **Opção de categoria**: ver tela 5 (selecionada com selo verde e check).
- **Aviso de status (detalhe)**: ver estrutura comum (cores por status: aberta `#F1F5F9`/`border-input`; atendimento `primary-soft`/`primary`; confirmação `warning-soft`/`warning`; recusada `danger-soft`/`danger`).
- **Linha do tempo**: ver estrutura comum.
- **Cartão "Relato da equipe"**: ícone em círculo 40 + equipe (16/600) + data (14) + relato (16).
- **Barra inferior / abas** (telas 4 e 8): frame 68 de altura em pílula (raio 34, fundo `#FFFFFFF2`, borda `border`, padding 8), flutuante (padding externo 0/16/16/16). Três itens: "Solicitações" (`list`, 96x52, raio 26), "Nova" (`camera`, 52 de altura, `primary`, texto 16/600, sempre destacado, padding 0/18) e "Perfil" (`user`, 96x52). Ativo: fundo `primary-soft`, ícone e texto `primary` 12/600; inativo: `text-secondary` 12/500.
- **Rodapé fixo** (5, 6x): fundo `surface`, borda superior `border`, padding 14/20/28/20. Nas telas de cadastro: sem fundo, padding 0/24/36/24.
- **Painel (bottom sheet)** (5b): ver tela 5b.
- **Aviso offline** (fora do cidadão, tela A1 do agente): faixa `warning-soft`, ícone `wifi-off` `warning`, texto "Sem conexão · 2 envios aguardando sinal" (cor `#78350F`). No app do cidadão só existe o aviso em linha do rodapé da tela 5.

---

## 3. Tokens (variáveis do arquivo)

Cores:

| Token                 | Valor     |
| --------------------- | --------- |
| `bg`                  | `#F5F7FA` |
| `surface`             | `#FFFFFF` |
| `text-primary`        | `#0F172A` |
| `text-secondary`      | `#475569` |
| `text-placeholder`    | `#64748B` |
| `border`              | `#E2E8F0` |
| `border-input`        | `#7C8798` |
| `primary`             | `#0057B8` |
| `primary-strong`      | `#003F87` |
| `primary-soft`        | `#E6EFFA` |
| `on-primary`          | `#FFFFFF` |
| `success`             | `#007A4A` |
| `success-soft`        | `#E6F5EE` |
| `warning`             | `#B45309` |
| `warning-soft`        | `#FEF3C7` |
| `danger`              | `#B91C1C` |
| `danger-soft`         | `#FEE2E2` |
| `brand-green`         | `#009E60` |
| `brand-yellow`        | `#F2C300` |
| `on-brand-green`      | `#FFFFFF` |
| `on-brand-yellow`     | `#0F172A` |
| `brand-green-on-blue` | `#3DDC97` |

Strings: `font` = "Source Sans 3"; `font-heading` = "Lexend". Não há variáveis numéricas de espaçamento ou raio, nem temas (sem modo escuro).

Valores literais usados fora de variáveis: `#F1F5F9` (aviso "aberta"), `#CBD5E1` (alça do painel, foto "depois", textos da galeria), `#94A3B8`/`#64748B` (fundos da pilha), `#334155` (bordas da galeria), `#0F172A8C` (escurecimento), `#0F172AB3`/`#0F172AD9` (sobreposições sobre foto), `#FFFFFFF2` (tab bar, pílula Local), `#FFFFFF26` (botão da galeria), `#78350F` (texto aviso offline).

Tipografia usada: Lexend 600 em títulos (26 nas telas de cadastro; 24 em listas/perfil/5c; 22 no painel 5b; 20 no detalhe; 18 no cabeçalho da 5 e seção "Tipo"; 17 em seções do detalhe; 16/500 em rótulos de campo). Source Sans 3: 17 botões/valores de campo, 16 corpo, 15 secundário/chips/termos, 14 legendas, 13 metadados do cartão, 12 rótulos da tab bar. Pesos 400, 500, 600. Status Bar usa Inter (simulação).

Espaçamento: margem lateral 20 (conteúdo das telas de lista/detalhe) ou 24 (cadastro, 5c); gaps 24 entre seções, 16 entre cartões, 8–14 internos; rodapé com 28–36 de padding inferior.

Raios usados: 6 (caixa de seleção), 12 (galeria), 14 (dígitos, selos, quadrado de ícone), 16 (campos), 20 (cartões, opções, chips), 22–28 (pílulas do overlay, painel 28), 28 (botões 56), 24–26 (botões 48–52), 34 (tab bar), círculos (44, 72).

Alvos de toque: botões e campos 56; voltar/fechar 44; chips 40; ação do cartão 48; opções de categoria 100.

---

## 4. Diferenças em relação a `docs/design-system.md`

Cores e tipografia (famílias) batem; o arquivo tem 22 cores com os mesmos hex do doc. Diferenças:

1. **Raios**: doc diz cantos 12 (campos, cartões) e 14 (botões). No Pencil: campos 16, cartões 20, botões em pílula (56 → raio 28; 48 → 24; 52 → 26), dígitos do código 14. Atualizar o doc ou a implementação conforme a decisão (o Pencil é a referência visual mais recente).
2. **Escala tipográfica**: doc: 14 · 16 · 17 · 22. Pencil também usa 12 (tab bar), 13 (meta do cartão), 15 (chips, termos, textos de aviso), 18, 20, 24, 26. Título de tela é 24/26, não 22 (22 só no painel 5b). "Nada de corpo abaixo de 16": há textos de 14, 13 e 12 (legendas, metas, rótulos de tab) e 15 (texto de aviso e termos).
3. **Pesos**: Pencil usa Lexend 500 em rótulos de campo e Source Sans 500 em chips/itens; doc lista só Lexend 600 e Source Sans 400/600.
4. **Variáveis extras** no Pencil que não estão na tabela do doc: `on-brand-green` (`#FFFFFF`) e `on-brand-yellow` (`#0F172A`) (o doc só os menciona em texto na tabela de categorias). As demais variáveis do doc existem, inclusive `brand-green-on-blue`.
5. **Valores literais fora de token** (não previstos no doc): ver lista da seção 3 (em especial `#F1F5F9` no aviso "aberta" e `#78350F` no aviso offline).
6. **Status "Aberta"** usa fundo `border` com texto `text-secondary`; o doc não define cores para status além de `success`/`warning`/`danger`/`primary-soft`.
7. **Gradiente e sombra**: doc diz "sem sombras e gradientes"; o Pencil usa um gradiente escuro sobre a foto na tela 5 (para dar contraste à pílula de local) e escurecimento translúcido (5b). Não há `box-shadow`.
8. **Tab bar**: doc não descreve; Pencil usa barra flutuante em pílula com botão central "Nova" (câmera) sempre destacado. Ícone de aba ativa tem fundo `primary-soft`.
9. **Alvos de toque**: ok (≥ 48) exceto chips de filtro (40), botão "Ajustar" (40), botão adicionar foto (32x32) e Fechar/Voltar (44). Conflita com "≥ 48 de altura".
10. **Opções de categoria**: doc diz altura 56; Pencil usa 100 (grade 3 colunas com ícone em cima). O ícone de selecionada tem selo verde com check, como no doc.
11. **Ícones**: doc diz 20–24; Pencil usa 14–34 (selos 14–16, ícone vazio da 5c 34).
12. **Padrão de campos obrigatórios**: coincide ("obrigatório"/"opcional" à direita do rótulo). Doc diz placeholder só como exemplo: coincide (E-mail em `text-placeholder`); o celular e o nome mostram valor de exemplo preenchido.
13. **Botão de envio com carregando/desativado e fila offline**: o texto do aviso está desenhado (tela 5), mas não há quadro do estado "enviando". "Confirmar" desativado (opacidade 0.45) é a única variante desativada desenhada.
14. **Fechar com dados pede confirmação** e **leitores de tela** (`accessibilityLabel`): sem quadro/anotação no Pencil.
15. **Marca**: logo, símbolo, `abertura.png` e o resto batem. Imagem de fundo e logo referenciam `alo-cidadao-assets/…` (pasta de assets do .pen), não `design/marca/` (conferir se o caminho é o mesmo).

---

## 5. Lacunas

- Sem tela de permissão de localização/câmera/notificações (a 5c cobre só "cidade não atendida").
- Sem lista vazia, carregando, erro de rede ou erro de código (SMS inválido/expirado).
- Sem indicador offline no app do cidadão além do aviso em linha da tela 5 ("Sem internet? Enviamos assim que conectar."). O banner "Sem conexão · 2 envios aguardando sinal" existe só no app do agente (A1).
- Sem tela de edição de nome/celular/e-mail, de contestação ("Não foi resolvido"), de observação nem de confirmação de exclusão/cancelamento.
- Sem estado "recusada" na lista da tela 4.
- Textos e dados são exemplos (Maria da Silva, São Paulo, Campinas, protocolo 2026-000123).
