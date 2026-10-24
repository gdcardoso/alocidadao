# Telas do app do agente de campo — extração do Pencil

Fonte: `design/alocidadao.pen` (seção "Agente de campo" `F4kyv`, apoio "App · perfil field_agent (mesmo app)"; lida via MCP do Pencil, sem alterações). Temas: "Atividades" (`E5XS4`, apoio "Lista, detalhe com instruções e ajuste pedido pelo gestor") e "Concluir ou relatar impedimento" (`SRcwn`, apoio "Fotos do serviço, relato e motivo").

Todas as telas têm 390 de largura, fundo `$bg`, layout vertical, altura crescendo com o conteúdo, e começam com a mesma **Status Bar** do app do cidadão (62 de altura, "9:41", ícones `signal`, `wifi`, `battery-full`), que é simulação do iOS e não deve ser implementada.

Ícones: **lucide**. Fontes: corpo `$font` = Source Sans 3; títulos `$font-heading` = Lexend. Tokens de cor: os mesmos da seção 3 de `2026-10-23-telas-cidadao-pencil.md` (o arquivo não tem variáveis novas para o agente).

Capturas (exportadas do Pencil, 2x): `docs/superpowers/specs/telas-agente/` — `A1-minhas-atividades.png`, `A2-detalhe-da-atividade.png`, `A3-concluir-atendimento.png`, `A4-nao-consigo-resolver.png`, `A5-ajuste-pedido.png`.

Telas encontradas: 5.

| Tela | Frame | Id | Altura |
| --- | --- | --- | --- |
| A1 | Agente · A1 Minhas atividades | `IkMPH` | 924 |
| A2 | Agente · A2 Detalhe da atividade | `LYt2q` | 1174 |
| A5 | Agente · A5 Ajuste pedido pelo gestor | `m8Jtg` | 1174 |
| A3 | Agente · A3 Concluir atendimento | `AzS84` | 718 |
| A4 | Agente · A4 Não consigo resolver | `HsFq7` | 982 |

Não há variantes, estados nem painéis do agente além desses cinco quadros: **não existe modo Mapa desenhado**, nem Perfil do agente, troca de modo, lista vazia, diálogos ou estado "Em execução". Ver seção 5.

Convenção: `obrigatório`/`opcional` são textos 14 `text-secondary` à direita do rótulo, como no cidadão. Nós com `enabled=false` estão marcados como "oculto".

---

## 1. Telas

### A1 · Minhas atividades

- Propósito: tela inicial do agente; lista das atividades da(s) equipe(s) dele, ordenadas pela distância, com selo "Nova" nas recém-chegadas.
- Layout, de cima para baixo:
  1. **Aviso offline** (faixa de largura total, padding 10/20, gap 8, fundo `warning-soft`, sem raio): ícone `wifi-off` 18 `warning` + "Sem conexão · 2 envios aguardando sinal" (15/600, cor `#78350F`). O número de envios é variável (fila local). Fica entre a Status Bar e o cabeçalho.
  2. **Cabeçalho** (padding 14/20/8/20, `space_between`, centralizado verticalmente):
     - Textos (gap 2): equipe "Equipe Obras · Centro" (15, `text-secondary`); título "Minhas atividades" (Lexend 24/600).
     - **Pílula de modo** à direita (padding 8/12, gap 6, raio 20, fundo `text-primary`): ícone `hard-hat` 16 branco + "Agente" (14/600, `#FFFFFF`). Indica o modo atual; nada no arquivo diz se é tocável (ver lacunas).
  3. **Conteúdo** (padding 8/20/20/20, gap 14):
     - **Seletor Lista/Mapa** (controle segmentado, altura 48, padding 4, raio 24, fundo `border`): dois segmentos `fill_container` (raio 20, gap 8):
       - "Lista" selecionado: fundo `surface`, ícone `list` 18 + texto 15/600, ambos `text-primary`.
       - "Mapa": fundo transparente (`#FFFFFF00`), ícone `map` 18 + texto 15/600, ambos `text-secondary`.
     - **Resumo**: "4 atividades · ordenadas pela distância" (14, `text-secondary`).
     - **Cartões de atividade** (raio 20, padding 16, gap 12, fundo `surface`; borda `border` 1, exceto a "Nova": borda `primary` 2). Estrutura:
       - Topo (gap 12, centralizado): quadrado de categoria 48 (raio 14, cor do grupo, ícone 24 `on-primary`) · Textos (gap 2): linha com Tipo (17/600) + selo opcional "Nova"; Endereço (15, `text-secondary`) · Distância alinhada à direita (vertical, gap 2): ícone `navigation` 18 `primary` + distância (15/600 `primary`).
       - Rodapé (gap 8, centralizado): selo de status (padding 6/10, raio 14, texto 14/600, **sem ícone**) · chip de relatos (padding 6/10, raio 14, fundo `bg`, gap 6: ícone `users` 14 + texto 14 `text-secondary`) · tempo (13, `text-secondary`).
       - Selo "Nova": padding 2/8, raio 10, fundo `primary`, texto "Nova" 12/700 `#FFFFFF`.
     - Cartões de exemplo (na ordem, já pela distância):
       1. "Buraco na via" · "Rua das Flores, 120" · `construction` (`primary`) · "350 m" · status **"Ajuste pedido"** (fundo `warning-soft`, texto `warning`) · "6 relatos" · "Devolvido há 20 min". Borda `border` 1.
       2. "Iluminação" + selo **"Nova"** · "Av. Brasil, 1450" · `lightbulb` (`primary`) · "1,2 km" · **"Atribuída"** (fundo `border`, texto `text-secondary`) · "1 relato" · "Chegou há 10 min". Borda `primary` 2.
       3. "Calçada" · "Rua Ipê, 33" · `footprints` (`primary`) · "2,8 km" · "Atribuída" · "2 relatos" · "Atribuída há 3 dias".
       4. "Buraco na via" · "Rua XV, 88" · `construction` (`primary`) · "4,1 km" · "Atribuída" · "1 relato" · "Atribuída há 2 dias".
     - Pluralização implícita: "1 relato" / "N relatos". Texto do tempo depende do status: "Chegou há …" (nova), "Atribuída há …", "Devolvido há …" (ajuste pedido).
  4. **Barra inferior**: mesma barra flutuante do cidadão (padding externo 0/16/16/16; pílula 68, raio 34, fundo `#FFFFFFF2`, borda `border` 1, padding 8, sombra externa `#0F172A1F` y=4 blur 20), com **duas abas** e o botão central **"Nova" oculto** (o nó `camera`/"Nova" existe com `enabled=false`). Como o layout é `space_between`, as duas abas ficam nas pontas com um vão no meio.
     - "Atividades" (aba ativa; nó ainda nomeado "Solicitações"): 96x52, raio 26, fundo `primary-soft`, ícone `clipboard-list` 22 + rótulo 12/600, `primary`.
     - "Perfil": 96x52, fundo transparente, ícone `user` 22 + rótulo 12/500, `text-secondary`.
- Interações implícitas: cartão → A2 (ou A5 se "Ajuste pedido"); "Mapa" → modo mapa (não desenhado); "Perfil" → perfil do agente (não desenhado); aviso offline é só informativo.
- Dados necessários (por atividade): `activityId`, `occurrenceId`, categoria (nome, ícone, grupo/cor), endereço curto (logradouro + número), coordenadas (para distância e mapa), status da atividade (`assigned`, `in_progress`, `adjustment_requested`, …), `isNew` (não vista pelo agente), contagem de relatos (solicitações agrupadas), timestamp de referência para o texto de tempo (atribuída em / devolvida em). Da tela: nome da equipe (ou equipes) do agente, total de atividades, quantidade de envios na fila offline (local). Distância e ordenação são calculadas no aparelho a partir do GPS (ou pela API com lat/lng do agente).

### A2 · Detalhe da atividade

- Propósito: tudo o que o agente precisa para executar: instruções do gestor, local e rota, fotos e relatos dos cidadãos; ações de concluir ou relatar impedimento.
- **Cabeçalho** (gap 12, padding 0/16/8/16): Voltar (44x44, raio 22, `surface`, borda `border` 1, `arrow-left` 20) → A1; Textos: Tipo "Buraco na via" (Lexend 20/600) e "Ocorrência 2026-000123 · 6 relatos" (14, `text-secondary`).
- **Conteúdo** (padding 8/20/24/20, gap 22):
  1. **Instruções do gestor** (cartão raio 20, padding 16, gap 8, fundo `primary-soft`, borda `primary` 1): topo (gap 8) ícone `clipboard-pen` 20 `primary` + "Instruções do gestor" (16/600 `primary`); texto (16, `text-primary`, altura de linha 1.45): "Levar asfalto a frio e cones. Buraco fica na faixa de pedestres em frente à escola, priorizar antes das 11h."; autor (14, `text-secondary`): "Carlos (Gestor de Obras) · prazo: 23 out". O prazo interno aparece aqui (é visível ao agente, não ao cidadão).
  2. **Local** (cartão raio 20, padding 16, gap 12, `surface`, borda `border` 1): linha (gap 12) ícone `map-pin` 22 `primary` + "Rua das Flores, 120 — Centro" (16/600) e "A 350 m de você" (14, `text-secondary`); botão contorno "Abrir rota no mapa" (largura total, 48, raio 24, `surface`, borda `primary` 1.5, ícone `navigation` 18 + texto 16/600 `primary`).
  3. **Fotos dos cidadãos**: título (Lexend 17/600) + **Pilha de fotos** (instância de `rO6md`, 170x162) com contador "9" (fotos de todas as solicitações agrupadas). Tocar → Galeria (tela 7 do cidadão).
  4. **O que os cidadãos disseram**: título (Lexend 17/600) + lista em cartão (raio 20, `surface`, borda `border` 1; linhas com padding 16, gap 4, divisória inferior `border` 1, exceto a última):
     - "Buraco grande perto da faixa de pedestres" (16, `text-primary`) · "20 out, 08:12" (14, `text-secondary`)
     - "Já tem carro batendo a roda aqui" · "20 out, 17:40"
     - "Sem observação" (16, **`text-secondary`**: relato sem texto) · "21 out, 07:05"
     - Link "Ver os 6 relatos" (16/600 `primary`) abaixo do cartão → lista completa (não desenhada). Mostra 3 relatos e o link quando há mais.
     - Os relatos não mostram nome do cidadão (anônimos para o agente).
- **Rodapé fixo** (fundo `surface`, borda superior `border` 1, padding 14/20/28/20, gap 10):
  - Primário "Concluir atendimento" (56, raio 28, `primary`, ícone `circle-check` 20 + 17/600 `on-primary`) → A3.
  - Secundário "Não consigo resolver" (56, raio 28, `surface`, borda `border-input` 1.5, ícone `octagon-alert` 20 em `warning`, texto 17/600 `text-primary`) → A4.
- Não há selo de status na tela, nem botão "Iniciar atendimento" (ver lacunas).
- Dados: categoria (nome, ícone, grupo), código da ocorrência, nº de relatos; instruções do gestor (texto, nome e cargo/setor do gestor, prazo interno — opcionais: se não houver instruções o cartão some, regra a decidir); endereço completo (logradouro, número, bairro), coordenadas; distância (calculada); fotos de todas as solicitações (URLs, autor anônimo, data) e contagem; relatos (texto opcional, data de criação) com total; status da atividade (para decidir ações).

### A5 · Ajuste pedido pelo gestor

- Propósito: a mesma A2 quando o gestor devolveu a atividade (status "Ajuste pedido"); destaca o que o gestor pediu.
- Idêntica à A2 (cabeçalho, Local, Fotos dos cidadãos com "9", relatos, link "Ver os 6 relatos"), com duas diferenças:
  1. O cartão do topo vira **pedido de ajuste** (mesmo nó "Instruções do gestor", raio 20, padding 16, gap 8, fundo `warning-soft`, borda `warning` 1): ícone `undo-2` 20 `warning` + título "Gestor pediu novas fotos" (16/600, cor `#78350F`); texto (16, `text-primary`, lh 1.45): "As fotos 2 e 3 ficaram escuras e não mostram o buraco tapado. Tire uma de perto e uma de longe, com a rua aparecendo."; autor (14, `text-secondary`): "Carlos (Gestor de Obras) · devolvido há 20 min".
     - As instruções originais da A2 **não aparecem** na A5 (substituídas pelo pedido).
     - O título varia conforme o motivo marcado no W3b (ex.: "Gestor pediu novas fotos"); os outros títulos não estão desenhados (ver lacunas).
  2. Botão primário do rodapé: "Enviar novas fotos" (ícone `camera` 20) — leva a A3 (reenvio). Secundário igual: "Não consigo resolver" (`octagon-alert` `warning`) → A4.
- Dados extras: devolução atual (motivos marcados, mensagem do gestor, nome/cargo, data), fotos descartadas pelo gestor (quais das 3), conclusão anterior (fotos e relato) para pré-preencher a A3.

### A3 · Concluir atendimento

- Propósito: registrar a conclusão com fotos do serviço, relato e localização.
- **Cabeçalho** (gap 12, padding 0/16/8/16): Fechar (44x44, `x` 20) → volta à A2/A5 (com dados preenchidos deveria pedir confirmação, pelo design-system.md); Textos: "Concluir atendimento" (Lexend 20/600) + "Buraco na via · Rua das Flores, 120" (14, `text-secondary`).
- **Conteúdo** (padding 8/20/24/20, gap 24):
  1. **Fotos do serviço**: rótulo "Fotos do serviço feito" (Lexend 17/600) + "obrigatório · 1 de 3" (14, `text-secondary`, à direita). Miniaturas (linha, gap 10), cada uma 104x104 raio 16:
     - foto tirada (no Pencil, marcador cinza `#CBD5E1` com ícone `image` 24 e "foto 1" 13 `text-secondary` — no app é a miniatura da foto);
     - botão "Tirar foto" (fundo `surface`, borda `primary` 1.5, ícone `camera` 24 + "Tirar foto" 14/600 `primary`) → câmera. Some quando chega a 3 fotos (implícito).
     - Não há botão de remover foto desenhado.
  2. **Localização confirmada** (faixa raio 16, padding 14, gap 10, fundo `success-soft`): ícone `map-pin-check` 20 `success` + "Você está no local da ocorrência (a 8 m)" (15/600 `success`). A distância é variável. Estado "longe" (aviso sem bloquear, spec 8) não desenhado.
  3. **Relato**: rótulo "O que foi feito?" (Lexend 17/600) + "obrigatório". Campo de texto multilinha (altura 110, raio 20, padding 16, `surface`, borda `border-input` 1), placeholder (16, `text-placeholder`): "Ex.: buraco tapado com asfalto a frio, área sinalizada".
  4. **Informação** (gap 10): ícone `info` 18 `text-secondary` + "O gestor revisa as fotos e o relato antes de enviar aos 6 cidadãos que relataram." (15, `text-secondary`, lh 1.4). O número de cidadãos é variável.
- **Rodapé** (`surface`, borda superior, padding 14/20/28/20, gap 10): primário "Concluir atendimento" (ícone `circle-check` 20, texto e ícone `#FFFFFF` literal) → envia/enfileira, atividade vai para "Aguardando revisão", volta à A1; aviso: ícone `wifi-off` 16 + "Funciona sem internet: enviamos quando conectar." (14, `text-secondary`).
- Estados não desenhados: botão desativado sem foto/relato, enviando, sucesso, erro.
- Dados enviados: `activityId`, 1–3 fotos (tiradas na hora, reduzidas ~1600 px/~300 KB), relato (texto obrigatório), lat/lng do aparelho e precisão, distância calculada até a ocorrência, `capturedAt` de cada foto, `clientId`/chave de idempotência (fila offline). Dados lidos: categoria, endereço curto, coordenadas da ocorrência, nº de cidadãos que relataram (solicitações ativas).

### A4 · Não consigo resolver

- Propósito: relatar impedimento; a atividade volta ao gestor (W4).
- **Cabeçalho**: Fechar (44x44, `x` 20); "Não consigo resolver" (Lexend 20/600) + "Buraco na via · Rua das Flores, 120" (14, `text-secondary`).
- **Conteúdo** (padding 8/20/24/20, gap 24):
  1. **Motivo**: rótulo "Qual o motivo?" (Lexend 17/600) + "obrigatório". Lista de opções de escolha única (cada uma: largura total, 56, padding 0/16, gap 12, raio 16; não selecionada = `surface`, borda `border-input` 1, ícone 22 `text-secondary`, texto 16 `text-primary` normal; selecionada = fundo `primary-soft`, borda `primary` 2, ícone **trocado por `circle-check`** 22 `primary`, texto 16/600 `primary`):
     - "Falta material ou equipamento" (selecionada no exemplo; ícone próprio não visível no arquivo)
     - "Local inacessível" (`ban`)
     - "Precisa de outra equipe" (`users`)
     - "Não é da prefeitura" (`landmark`)
     - "Outro motivo" (`circle-ellipsis`)
  2. **Detalhes**: rótulo "Detalhes" + "obrigatório". Campo multilinha (110, raio 20, padding 16, borda `border-input` 1), placeholder: "Ex.: precisamos de rolo compactador, buraco maior que o previsto".
  3. **Foto**: rótulo "Foto" + "opcional". Botão "Tirar foto" (largura total, 56, raio **16**, `surface`, borda `border-input` 1, ícone `camera` 20 `primary` + 16/600 `primary`). Quantidade máxima não indicada (presumir 1).
  4. **Informação**: ícone `info` 18 + "A atividade volta para o gestor decidir o próximo passo. Os cidadãos não veem este motivo." (15, `text-secondary`, lh 1.4).
- **Rodapé**: botão **"Enviar ao gestor"** (56, raio 28, fundo **`warning`**, ícone `send` 20 + texto 17/600 `#FFFFFF`) → atividade "Impedida", volta à A1; aviso `wifi-off` 16 + "Funciona sem internet: enviamos quando conectar." (14).
- Dados enviados: `activityId`, motivo (enum: `missing_material`, `inaccessible`, `needs_other_team`, `not_municipal`, `other`), detalhes (texto obrigatório), foto opcional, lat/lng, `clientId` de idempotência. Os rótulos dos motivos devem vir de um enum fixo (ou configurável por prefeitura — a decidir).

---

## 2. Componentes

Reaproveitados do app do cidadão:

- **Status Bar** (simulação, não implementar).
- **Cabeçalho de detalhe** (Voltar/Fechar 44 + título Lexend 20/600 + apoio 14): igual ao das telas 6x; o apoio troca "Protocolo …" por "Ocorrência … · N relatos" (A2/A5) ou "Categoria · Endereço" (A3/A4).
- **Botão Voltar/Fechar** (círculo 44, `surface`, borda `border`).
- **Pilha de fotos** (`rO6md`, instância com contador "9") e, por tabela, a **Galeria** (tela 7).
- **Cartão de lista** (raio 20, padding 16, quadrado de categoria 48 raio 14): mesma base do cartão de solicitação; muda o conteúdo (ver abaixo).
- **Selo de status**: mesmo formato (raio 14, padding 6/10, 14/600), mas **sem ícone** no agente.
- **Botão primário / secundário / contorno azul (48)** e **Rodapé fixo** (`surface`, borda superior, padding 14/20/28/20).
- **Rótulo de seção com obrigatório/opcional** e **campo** (aqui multilinha, raio 20 e altura 110 — o campo do cidadão de uma linha usa raio 16).
- **Opção selecionável** da A4: estilo das opções de categoria (fundo `primary-soft`, borda `primary` 2) em formato de linha de 56.
- **Aviso offline em linha do rodapé** (ícone `wifi-off` 16 + texto 14), com outro texto.
- **Barra de abas** (mesma pílula, com sombra; ver seção 4).

Novos no agente:

- **Aviso offline em faixa** (A1): largura total, `warning-soft`, `wifi-off` 18 `warning`, texto 15/600 `#78350F`.
- **Pílula de modo** "Agente" (fundo `text-primary`, `hard-hat`, texto branco).
- **Controle segmentado** Lista/Mapa (48, trilho `border`, segmento ativo `surface`).
- **Cartão de atividade**: distância à direita (`navigation` + valor `primary`), selo "Nova", chip de relatos (`users`, fundo `bg`), tempo relativo; destaque da nova com borda `primary` 2.
- **Cartão de instruções/ajuste do gestor** (azul em A2, âmbar em A5).
- **Cartão de local com "Abrir rota no mapa"**.
- **Lista de relatos dos cidadãos** (cartão com linhas divididas + link "Ver os N relatos").
- **Miniaturas de foto 104x104 + botão "Tirar foto"** (A3) e **botão "Tirar foto" em linha** (A4).
- **Faixa de localização confirmada** (`success-soft`, `map-pin-check`).
- **Nota informativa** (`info` 18 + texto 15 `text-secondary`).
- **Botão de impedimento** com ícone `octagon-alert` em `warning` e **botão primário em `warning`** ("Enviar ao gestor").

Não usados no agente: Timeline/Andamento, Relato da equipe, Antes e depois, Aviso de status do detalhe (StatusNotice), chips de filtro, chip de cidade.

---

## 3. Status da atividade mostrados

| Status (6.2) | Onde aparece | Selo |
| --- | --- | --- |
| Atribuída | A1 | fundo `border`, texto `text-secondary` (igual "Aberta" do cidadão) |
| Ajuste pedido | A1, A5 | fundo `warning-soft`, texto `warning` |
| Em execução | — | não desenhado |
| Aguardando revisão | — | não desenhado (some da lista? fica com selo?) |
| Impedida | — | não desenhado |
| Concluída / Cancelada | — | não desenhado (presume-se que saem da lista) |

"Nova" não é status: é um marcador de não vista sobre "Atribuída".

---

## 4. Diferenças em relação ao app do cidadão / `design-system.md`

1. **Barra de abas**: duas abas ("Atividades" com `clipboard-list`, "Perfil"), sem o botão central "Nova" (oculto no arquivo). Com `space_between`, sobra um vão no meio — decidir se as duas abas devem se distribuir/centralizar. O design-system.md descreve só a barra do cidadão.
2. **Sombra**: a barra de abas (agente **e** cidadão) tem sombra externa `#0F172A1F` (y 4, blur 20). O design-system.md diz "sem sombras" e não lista essa exceção; a spec do cidadão também não a registrou.
3. **Cor literal `#78350F`** (âmbar escuro) usada no aviso offline da A1 e no título do ajuste (A5) — não é token; o doc lista só o uso do aviso offline. Sugestão: token `warning-strong` / `on-warning-soft`.
4. **Botão primário em `warning`** ("Enviar ao gestor", texto branco) — variante que não existe no doc (branco sobre `#B45309` = 5,0:1, passa AA).
5. **Texto branco literal** (`#FFFFFF`) em vez de `on-primary` no botão da A3, no selo "Nova" e na pílula de modo; e fundo `text-primary` usado como fundo da pílula "Agente" (cor de texto usada como fundo, sem token próprio).
6. **Peso 700** no selo "Nova" (12/700); o doc só prevê 400/500/600.
7. **Selo de status sem ícone** no agente; no cidadão todo selo leva ícone ("cor nunca é o único sinal" continua atendido pelo rótulo).
8. **Tamanhos fora da escala do doc**: endereço do cartão em 15 (no cidadão é 14); selo "Nova" 12; chip de relatos 14 normal; Lexend 17 como rótulo de campo nas telas A3/A4 (no cidadão rótulos de campo são Lexend 16/500).
9. **Campo multilinha**: raio 20 e altura 110 (doc: campos raio 16). Botão "Tirar foto" da A4 com raio 16 e altura 56 (não é pílula, ao contrário dos demais botões).
10. **Opção selecionada da A4** troca o ícone por `circle-check` (o doc diz que, na categoria, o ícone continua visível e ganha selo); padrão diferente do da tela 5.
11. **Cabeçalho**: no detalhe o agente vê "Ocorrência 2026-000123" (o cidadão vê "Protocolo 2026-000123"); o agente trabalha sobre a ocorrência, não sobre a solicitação.
12. **Prazo interno visível** ("prazo: 23 out") só no agente, como pede a spec 6.1.
13. **Alvos de toque**: Voltar/Fechar 44 (mesma exceção do cidadão); segmentos do Lista/Mapa ficam com 40 de altura útil dentro do trilho de 48; link "Ver os N relatos" é texto solto (sem área de toque definida). Selos e chips não são tocáveis.
14. **Aviso offline**: no agente há faixa persistente no topo (A1) **e** aviso no rodapé das telas de envio (A3/A4), com texto "Funciona sem internet: enviamos quando conectar." (o cidadão usa "Sem internet? Enviamos assim que conectar.").
15. **Seções no detalhe**: gap 22 (A2/A5) em vez de 24.

---

## 5. O que o Pencil não mostra

Decisões que quem implementar vai precisar:

- **Modo Mapa da A1**: não desenhado (pinos por categoria? cor por status? cartão ao tocar no pino? centraliza no agente?). Só o seletor existe.
- **Troca de modo agente/cidadão**: a spec 3.3 manda fazer pelo Perfil, mas **não há Perfil do agente** nem controle de troca. A pílula "Agente" na A1 sugere um indicador (talvez tocável). Decidir: pílula abre um seletor? linha no Perfil? o que aparece para quem só é agente (pílula escondida?). Lembrar o último modo usado.
- **Perfil do agente**: conteúdo não definido (nome, celular, equipe(s), prefeitura, sair, troca de modo; excluir conta faz sentido para agente?).
- **Iniciar atendimento / "Em execução"**: a spec 6.2 diz que "Em execução" começa ao tocar em "Iniciar atendimento", mas a A2 vai direto para "Concluir atendimento" e não há esse botão. Decidir se o passo existe (e onde), ou se a atividade passa a "Em execução" ao abrir/ao concluir.
- **Status depois do envio**: como a lista mostra atividades "Aguardando revisão" e "Impedida" (somem? ficam com selo e só leitura?). O detalhe dessas atividades (somente leitura, sem rodapé) não está desenhado.
- **Lista vazia**, carregando e erro de rede na A1; agente sem equipe; agente com várias equipes (o cabeçalho mostra uma só).
- **Conflito**: atividade reatribuída, reagendada para outra equipe, cancelada ou recusada enquanto o agente estava com ela aberta ou com envio na fila offline. Falta a mensagem (ex.: "Esta atividade foi passada para outra equipe") e a regra do que fazer com fotos/relato já feitos.
- **Vínculo desativado** (3.3): mensagem quando o agente perde o acesso ao modo agente.
- **Fila offline**: tela/lista dos "2 envios aguardando sinal", erro definitivo de envio, reenvio manual; estado do cartão com envio pendente. Sem rede, como fica a distância (GPS funciona) e as fotos/relatos já baixados (cache)?
- **A3**: estado "longe do local" (aviso sem bloquear, spec 8) e "sem localização/permissão negada"; remover/refazer foto; botão desativado até ter 1 foto + relato; confirmação ao fechar com dados; sucesso (toast? volta à A1?).
- **A5 → reenvio**: "Enviar novas fotos" abre a A3 pré-preenchida? Mostra quais fotos o gestor descartou? O relato anterior vem preenchido? Títulos do cartão para os outros motivos do W3b (novo relato, voltar ao local) e para vários motivos juntos não estão definidos. Histórico de devoluções (spec 6.2) não aparece para o agente.
- **A4**: ícone próprio de "Falta material ou equipamento" (no exemplo está selecionado e mostra `circle-check`); quantas fotos; confirmação ao fechar; o que o agente vê depois (atividade "Impedida", aguardando decisão do gestor) e quando o gestor reagenda para a mesma equipe (volta como "Atribuída" com nova data? selo "Nova" de novo?).
- **A2 sem instruções**: o cartão some ou mostra "Sem instruções"? Prazo vencido/vencendo (o doc associa `warning` a "prazo vencendo") não tem destaque desenhado.
- **"Ver os N relatos"** e lista completa de relatos/fotos: tela não desenhada (provavelmente uma lista simples e a galeria).
- **"Abrir rota no mapa"**: qual app abrir (Google Maps / Apple Maps / Waze, escolha do sistema).
- **Selo "Nova"**: quando deixa de ser nova (ao abrir o detalhe? ao ver a lista?) — estado precisa ser guardado por agente (servidor) ou só no aparelho.
- **Push**: o texto da notificação de nova atividade/ajuste não está no Pencil.
- Textos e dados são exemplos (Equipe Obras · Centro, Carlos, 2026-000123, distâncias).
