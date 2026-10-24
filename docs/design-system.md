# Design system — Alô Cidadão

Serviço público usado por pessoas de todas as idades, muitas vezes na rua, sob sol e com rede fraca. A prioridade é **legibilidade e clareza**, não decoração. Estilo: _Accessible & Ethical_ (alto contraste, texto grande, sem efeitos), recomendado pelo ui-ux-pro-max para serviços de governo.

As telas ficam em `design/alocidadao.pen` (Pencil), usando as mesmas variáveis abaixo. As cores e a logo seguem o guia de marca.

## Marca

Fonte: guia de marca do Alô Cidadão (`../guia de marca/`, fora do git). Os recortes usados no Pencil ficam em `design/marca/`:

- `logo.png`: símbolo + "Alô Cidadão" + "Você faz uma cidade melhor". Usado na abertura (tela 0) e na entrada do app (tela 1).
- `simbolo.png`: balão com as pessoas. Usado no menu do painel web, no backoffice e no ícone do app.
- `onda.png`: o grafismo azul, verde e amarelo sozinho, para fundo branco.
- `abertura.png`: o fundo da abertura do app (tela 0). É branco no alto e, embaixo, mostra a cidade e a faixa verde e amarela, que somem no branco acima dos prédios. A logo colorida fica no centro.
- `painel-login.png`: o lado azul do login do painel (W0a e W0b), com o horizonte da cidade e a faixa verde e amarela do guia surgindo do azul. O texto fica na parte lisa de cima.

Esses recortes saíram de uma imagem e servem só para os protótipos. **Para o app e o site, pedir ao designer os arquivos vetoriais (SVG/PDF) e a versão negativa.**

Regras de uso:

- Em fundo claro, o símbolo vai direto, sem moldura. Em fundo azul ou escuro, vai dentro de um quadrado branco de cantos arredondados, como no ícone do app.
- O nome "Alô Cidadão" só aparece na fonte da logo quando é a própria logo. Em menus, o nome ao lado do símbolo usa a fonte de títulos.
- A logo nunca é recolorida, distorcida nem colocada sobre foto.

## Cores

A paleta vem do guia de marca. Verde e amarelo **não passam no contraste para texto sobre branco**, então entram como cor de ícone, fundo de ícone e grafismo. Os textos usam as versões derivadas. Todos os pares de texto passam no WCAG AA (4,5:1), e as bordas de campos e ícones passam no mínimo de 3:1.

### Cores da marca

| Token                 | Hex       | Nome no guia    | Uso                                                          | Contraste                             |
| --------------------- | --------- | --------------- | ------------------------------------------------------------ | ------------------------------------- |
| `primary`             | `#0057B8` | Azul Confiança  | Ação principal, seleção, links, categorias de infraestrutura | 6,9:1 sobre branco                    |
| `brand-green`         | `#009E60` | Verde Cidadania | Fundo de ícone (ícone branco), grafismos; nunca texto        | branco sobre ele 3,5:1 (ícone)        |
| `brand-yellow`        | `#F2C300` | Amarelo Energia | Fundo de ícone (ícone escuro), grafismos; nunca texto        | `#0F172A` sobre ele 10,7:1            |
| `bg`                  | `#F5F7FA` | Cinza Neutro    | Fundo das telas                                              | —                                     |
| `brand-green-on-blue` | `#3DDC97` | —               | Destaque em título grande sobre o azul (login do painel)     | 3,9:1 sobre `primary` (só texto ≥ 24) |
| `on-brand-green`      | `#FFFFFF` | —               | Ícone sobre `brand-green`                                    | 3,5:1 (ícone)                         |
| `on-brand-yellow`     | `#0F172A` | —               | Ícone sobre `brand-yellow`                                   | 10,7:1                                |

### Cores da interface

| Token              | Hex       | Uso                                                 | Contraste                  |
| ------------------ | --------- | --------------------------------------------------- | -------------------------- |
| `surface`          | `#FFFFFF` | Campos, cartões, rodapé                             | —                          |
| `text-primary`     | `#0F172A` | Texto principal                                     | 16,6:1 sobre `bg`          |
| `text-secondary`   | `#475569` | Texto de apoio, legendas                            | 7,1:1 sobre `bg`           |
| `text-placeholder` | `#64748B` | Exemplo dentro de campos                            | 4,8:1 sobre branco         |
| `border`           | `#E2E8F0` | Divisórias (decorativas)                            | —                          |
| `border-input`     | `#7C8798` | Contorno de campos e opções tocáveis                | 3,6:1 sobre branco         |
| `primary-strong`   | `#003F87` | Botão pressionado                                   | 10,2:1 sobre branco        |
| `primary-soft`     | `#E6EFFA` | Fundo de opção selecionada                          | `primary` 5,9:1            |
| `on-primary`       | `#FFFFFF` | Texto e ícone sobre `primary`                       | 6,9:1                      |
| `success`          | `#007A4A` | Concluída, confirmações (verde da marca escurecido) | 5,4:1 sobre branco         |
| `success-soft`     | `#E6F5EE` | Fundo de status concluída                           | `success` 4,8:1            |
| `warning`          | `#B45309` | Prazo vencendo, impedimento                         | 5,0:1 sobre branco         |
| `warning-soft`     | `#FEF3C7` | Fundo de aviso                                      | —                          |
| `danger`           | `#B91C1C` | Erros, ações destrutivas                            | 6,5:1 sobre branco         |
| `danger-soft`      | `#FEE2E2` | Fundo de erro                                       | —                          |
| `warning-strong`   | `#78350F` | Texto âmbar sobre `warning-soft` (app do agente)    | 8,1:1 sobre `warning-soft` |

Cor nunca é o único sinal: seleção leva ícone de check, status leva rótulo em texto.

### Cores dos status

| Status                 | Aviso no detalhe (fundo / borda e ícone) | Selo no cartão da lista                |
| ---------------------- | ---------------------------------------- | -------------------------------------- |
| Aberta                 | `#F1F5F9` / `border-input`               | fundo `border`, texto `text-secondary` |
| Em atendimento         | `primary-soft` / `primary`               | `primary-soft`, texto `primary`        |
| Aguardando confirmação | `warning-soft` / `warning`               | `warning-soft`, texto `warning`        |
| Concluída              | `success-soft` / `success`               | `success-soft`, texto `success`        |
| Recusada               | `danger-soft` / `danger`                 | `danger-soft`, texto `danger`          |
| Cancelada              | `#F1F5F9` / `border-input`               | fundo `border`, texto `text-secondary` |

### Valores literais do Pencil

Usados nas telas sem virar token da marca (no app ficam nomeados em `apps/mobile/src/ui/theme.ts`):

| Valor                | Uso                                                          |
| -------------------- | ------------------------------------------------------------ |
| `#F1F5F9`            | Fundo do aviso "Aberta" no detalhe                           |
| `#0F172AB3`          | Pílulas e botões sobre foto (contador de fotos, Remover)     |
| `#0F172AD9`          | Fim do gradiente escuro sobre a foto (começa em `#0F172A00`) |
| `#0F172A8C`          | Escurecimento atrás do painel (5b)                           |
| `#FFFFFFF2`          | Barra de abas e pílula de local sobre a foto                 |
| `#FFFFFF26`          | Botão Fechar da galeria                                      |
| `#CBD5E1`            | Alça do painel e textos da galeria                           |
| `#334155`            | Borda das fotos vizinhas na galeria                          |
| `#94A3B8`, `#64748B` | Fundos da pilha de fotos                                     |
| `#78350F`            | Virou o token `warning-strong` (`warningStrong` no app)      |

### Categorias

O guia agrupa os ícones em três cores. Cada categoria pertence a um grupo, e o ícone aparece num círculo cheio da cor do grupo:

| Grupo             | Círculo        | Ícone     | Categorias do catálogo padrão                   |
| ----------------- | -------------- | --------- | ----------------------------------------------- |
| Infraestrutura    | `primary`      | branco    | Buraco na via, Iluminação, Calçada, Sinalização |
| Meio ambiente     | `brand-green`  | branco    | Lixo e entulho, Poda de árvore, Esgoto          |
| Serviços públicos | `brand-yellow` | `#0F172A` | Animal, Outro                                   |

O grupo é um campo da categoria. A prefeitura escolhe o grupo ao criar uma categoria nova.

Na categoria selecionada, o ícone continua visível e ganha um selo verde com check no canto.

## Tipografia

- **Títulos:** Lexend (600; 500 nos rótulos de campo). Criada para leitura fácil.
- **Texto:** Source Sans 3 (400, 500 em chips e itens, 600). Peso 700 só no selo "Nova" do cartão de atividade do agente (12/700 no Pencil); o app carrega só até 600, então desenha o selo em 600 até a fonte 700 entrar.
- Escala usada no Pencil, de 12 a 26:
  - Lexend: 26 título das telas de cadastro · 24 título de lista, perfil e 5c · 22 título do painel 5b · 20 título do detalhe · 18 cabeçalho da tela 5 e seções · 17 seções do detalhe · 16/500 rótulos de campo.
  - Source Sans 3: 17 botões e valores de campo · 16 corpo · 15 secundário, chips, termos e avisos · 14 legendas · 13 metadados do cartão · 12 rótulos da barra de abas.
- **Corpo de texto nunca abaixo de 16** (evita zoom no iOS e ajuda quem lê com dificuldade). Abaixo de 16 só textos curtos de apoio: avisos e termos (15), legendas (14), metadados do cartão (13) e rótulos da barra de abas (12).
- Respeitar o tamanho de fonte do sistema (Dynamic Type / escala do Android) sem cortar texto.

## Espaçamento, forma e toque

- Ritmo de 4/8: 8, 12, 16, 20 (margem lateral), 24–28 (entre seções).
- Raios: caixa de seleção 6 · galeria 12 · dígitos do código, selos e quadrado de ícone 14 · campos 16 · cartões, opções e chips 20 · painel 28 · barra de abas 34. Botões em pílula (raio = metade da altura: 56 → 28, 52 → 26, 48 → 24); pílulas sobre foto 22–24. Avatares e marcadores em círculo.
- Alvos de toque ≥ 48 de altura (botões e campos com 56); opções de categoria numa grade de 3 colunas, com 100 de altura e o ícone em cima do nome. Ficam abaixo de 48, como no Pencil: chips de filtro e "Ajustar" (40), Voltar/Fechar (44) e o botão de adicionar foto sobre a foto (32).
- Ícones: Lucide, traço uniforme, 20–24 nas ações; selos de 14–16 e ícone de estado vazio maior.
- Sem sombras e gradientes na interface; separação por contorno e fundo. Exceções permitidas:
  - os fundos da marca (cidade e faixa verde e amarela), só na abertura do app e no login do painel;
  - o gradiente escuro sobre a foto da Nova solicitação (de `#0F172A00` a `#0F172AD9`), para a pílula de local e o contador terem contraste;
  - o escurecimento translúcido (`#0F172A8C`) atrás do painel que sobe de baixo (5b);
  - a sombra externa da barra de abas flutuante (cidadão e agente): `#0F172A1F`, y 4, blur 20. O app ainda não a desenha.

## Barra de abas

Barra flutuante em pílula (68 de altura, raio 34, fundo `#FFFFFFF2`, borda `border`), afastada das bordas da tela. Duas abas (Solicitações e Perfil) com rótulo de 12 e, no meio, o botão "Nova" (câmera) sempre destacado em `primary`. O ícone da aba ativa tem fundo `primary-soft`.

No modo agente, a mesma barra tem só duas abas, `Atividades` (`clipboard-list`) e `Perfil` (`user`), distribuídas por igual, sem o vão do botão central.

## Componentes do app do agente

Telas em `docs/superpowers/specs/2026-10-24-telas-agente-pencil.md`; no app, em `apps/mobile/src/ui/agent/` e `apps/mobile/src/ui/ModePill.tsx`.

- **Faixa offline** (A1): largura total, fundo `warning-soft`, ícone `wifi-off` 18 em `warning`, texto 15/600 em `warning-strong`. Some quando há rede. Nas telas de envio (A3/A4) o aviso fica no rodapé: "Funciona sem internet: enviamos quando conectar."
- **Pílula de modo** (topo): padding 8/12, gap 6, raio 20, ícone 16, texto 14/600; toque chega a 44 com `hitSlop`. `Agente` (`hard-hat`): fundo `text-primary`, ícone e texto brancos. `Cidadão` (`user`): fundo `surface`, borda `border`, texto `text-primary` (sem desenho no Pencil).
- **Controle segmentado** (Lista/Mapa da A1): trilho `border` de 48, padding 4, raio 24; segmento ativo `surface` com ícone e texto `text-primary`, inativo transparente em `text-secondary`. Segmentos com 40 de altura útil.
- **Cartão de atividade** (A1): raio 20, fundo `surface`, borda `border` 1; a atividade nova tem borda `primary` 2 e o selo "Nova" (`primary`, texto branco 12). Tipo 17/600, endereço 15 em `text-secondary`, distância 15/600 em `primary` com `navigation`. Embaixo: selo de status, chip de relatos (fundo `bg`, `users` 14, texto 14) e o tempo (13).
- **Selo de status do agente**: sem ícone (o rótulo é o sinal além da cor). Atribuída `border`/`text-secondary`; Em execução `primary-soft`/`primary`; Ajuste pedido `warning-soft`/`warning`; Aguardando revisão `success-soft`/`success`; Impedida `danger-soft`/`danger`.
- **Cartão do gestor** (A2/A5): raio 20, padding 16, borda 1. Azul nas instruções (`primary-soft`, borda e título `primary`); âmbar no ajuste pedido (`warning-soft`, borda `warning`, título `warning-strong`). Texto 16 em `text-primary`, autor 14 em `text-secondary`.
- **Opção de motivo** (A4, escolha única): linha de 56, raio 16, fundo `surface`, borda `border-input`. Selecionada: `primary-soft`, borda `primary` 2, texto 600 em `primary` e o ícone trocado por `circle-check` (diferente da categoria, que mantém o ícone e ganha selo).
- **Botão primário em `warning`** ("Enviar ao gestor" da A4): pílula `warning` com texto branco (5,0:1), pressionado em `warning-strong`.
- **Faixa de local** (A3): raio 16, padding 14, gap 10, texto 15/600. No local: `success-soft` com texto `success`. Longe ou sem posição: `warning-soft` com `map-pin-x`/`map-pin-off` e texto `warning-strong`. Lendo a posição: fundo `#F1F5F9`, indicador e texto `text-secondary`. Nunca bloqueia o envio.

## Padrões de interação

- **Uma ação principal por tela**, no rodapé fixo, ao alcance do polegar.
- Rótulo visível acima de todo campo; placeholder só como exemplo. Campos obrigatórios marcados com "obrigatório", opcionais com "opcional".
- Botão de envio mostra carregando e fica desativado durante o envio; sem rede, a solicitação vai para a fila e a tela diz isso.
- Fechar uma tela com dados preenchidos pede confirmação.
- Animações de 150–300 ms, só para dar continuidade; respeitar "reduzir movimento".
- Leitores de tela: todo ícone tocável tem `accessibilityLabel` (ex.: "Remover foto").
