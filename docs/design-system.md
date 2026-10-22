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

### Cores da interface

| Token              | Hex       | Uso                                                 | Contraste           |
| ------------------ | --------- | --------------------------------------------------- | ------------------- |
| `surface`          | `#FFFFFF` | Campos, cartões, rodapé                             | —                   |
| `text-primary`     | `#0F172A` | Texto principal                                     | 16,6:1 sobre `bg`   |
| `text-secondary`   | `#475569` | Texto de apoio, legendas                            | 7,1:1 sobre `bg`    |
| `text-placeholder` | `#64748B` | Exemplo dentro de campos                            | 4,8:1 sobre branco  |
| `border`           | `#E2E8F0` | Divisórias (decorativas)                            | —                   |
| `border-input`     | `#7C8798` | Contorno de campos e opções tocáveis                | 3,6:1 sobre branco  |
| `primary-strong`   | `#003F87` | Botão pressionado                                   | 10,2:1 sobre branco |
| `primary-soft`     | `#E6EFFA` | Fundo de opção selecionada                          | `primary` 5,9:1     |
| `on-primary`       | `#FFFFFF` | Texto e ícone sobre `primary`                       | 6,9:1               |
| `success`          | `#007A4A` | Concluída, confirmações (verde da marca escurecido) | 5,4:1 sobre branco  |
| `success-soft`     | `#E6F5EE` | Fundo de status concluída                           | `success` 4,8:1     |
| `warning`          | `#B45309` | Prazo vencendo, impedimento                         | 5,0:1 sobre branco  |
| `warning-soft`     | `#FEF3C7` | Fundo de aviso                                      | —                   |
| `danger`           | `#B91C1C` | Erros, ações destrutivas                            | 6,5:1 sobre branco  |
| `danger-soft`      | `#FEE2E2` | Fundo de erro                                       | —                   |

Cor nunca é o único sinal: seleção leva ícone de check, status leva rótulo em texto.

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

- **Títulos:** Lexend (600). Criada para leitura fácil.
- **Texto:** Source Sans 3 (400, 600).
- Escala: 14 legenda · 16 corpo e campos · 17 botões · 22 título da tela. **Nada de corpo abaixo de 16** (evita zoom no iOS e ajuda quem lê com dificuldade).
- Respeitar o tamanho de fonte do sistema (Dynamic Type / escala do Android) sem cortar texto.

## Espaçamento, forma e toque

- Ritmo de 4/8: 8, 12, 16, 20 (margem lateral), 24–28 (entre seções).
- Cantos 12 (campos, cartões) e 14 (botões).
- Alvos de toque ≥ 48 de altura; opções de categoria com 56.
- Ícones: Lucide, traço uniforme, 20–24.
- Sem sombras e gradientes na interface; separação por contorno e fundo. A exceção são os fundos da marca (cidade e faixa verde e amarela), usados só na abertura do app e no login do painel.

## Padrões de interação

- **Uma ação principal por tela**, no rodapé fixo, ao alcance do polegar.
- Rótulo visível acima de todo campo; placeholder só como exemplo. Campos obrigatórios marcados com "obrigatório", opcionais com "opcional".
- Botão de envio mostra carregando e fica desativado durante o envio; sem rede, a solicitação vai para a fila e a tela diz isso.
- Fechar uma tela com dados preenchidos pede confirmação.
- Animações de 150–300 ms, só para dar continuidade; respeitar "reduzir movimento".
- Leitores de tela: todo ícone tocável tem `accessibilityLabel` (ex.: "Remover foto").
