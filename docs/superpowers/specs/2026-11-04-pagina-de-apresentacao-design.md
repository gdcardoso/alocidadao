# Página de apresentação — design

**Data:** 04/11/2026 · **Base:** `docs/superpowers/specs/2026-11-04-convite-e-termos-design.md` (seção 7, site estático), guia de marca (`../guia de marca/`) · **Mockup aprovado:** `docs/superpowers/specs/landing/mockup-v2.html` e a captura `mockup-v2.jpg`

O domínio `alocidadao.com.br` ainda mostra uma página mínima com links. Este pacote troca essa raiz por uma página de apresentação que vende o sistema para prefeituras e explica o app ao cidadão. É o último passo antes de subir para a nuvem (Plano 8). O painel fica em `portal.alocidadao.com.br`.

## 1. Intenção

Dois públicos, uma página (decisão do usuário):

1. **Quem decide na prefeitura** (gestor): entende o ganho e entra em contato por **WhatsApp ou e-mail**. O argumento principal, nas palavras do usuário: o cidadão "trabalha" para a prefeitura, informando os problemas, e a prefeitura sabe onde tem problema **sem precisar ter alguém indo atrás**.
2. **O cidadão**: só precisa entender o que é o sistema, como o app funciona e o ganho de ter um contato direto com a prefeitura da sua cidade. Não há ação esperada dele.

A página precisa ser **moderna e chamar atenção**, para dar vontade de usar o sistema. O usuário rejeitou uma primeira versão simples e aprovou a v2 (mockup acima).

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- Página de apresentação em `/` do `apps/site`, seguindo o mockup v2 (seção 3).
- Imagens com capturas do sistema rodando com a demo de Goiânia (seção 4).
- Contato (WhatsApp, e-mail, frase de prazo de resposta) editável no backoffice, sem novo build do site (seção 5).

**Não-objetivos**

- Preço, planos, formulário de contato, blog, depoimentos ou números de resultado (ainda não existem).
- Link para baixar o app nas lojas (o app ainda não está publicado; entra no Plano 8).
- Publicação no domínio (Plano 8).
- Mudar `/termos` e `/privacidade`.

**Antiobjetivos**

- Página genérica de "template de SaaS": tem que ter a cara do Alô Cidadão (cores, onda, logo) e mostrar o produto de verdade.
- Prometer o que o sistema não faz ou inventar números.
- Contato fixo no código, que exija novo deploy para trocar.
- Site que quebra ou fica sem contato quando a API está fora do ar.

## 3. A página (mockup v2)

Estrutura, de cima para baixo (textos do mockup; o builder pode polir sem mudar o sentido):

1. **Barra fixa** com vidro fosco: logo + "Alô Cidadão"; links "Como funciona", "Para o cidadão", "Para prefeituras", "Entrar no painel" (→ `https://portal.alocidadao.com.br/entrar`); botão verde "Fale com a gente" (→ seção de contato).
2. **Topo** (fundo azul-escuro `#062a5c` com manchas de luz azul, verde e amarela animadas devagar): selo "Você faz uma cidade melhor"; título "Conexão que **transforma** sua cidade." (palavra em degradê verde→amarelo); frase "O morador avisa pelo celular. A prefeitura vê no mapa, manda a equipe certa e mostra a foto do serviço feito."; botões "Sou da prefeitura" e "Sou cidadão" (âncoras); números "3 passos / do aviso à foto", "1 mapa / com toda a cidade", "0 / ronda para achar problema" (mantidos: descrevem o produto); à direita, o painel num notebook e o app do agente num celular, com dois cartões de vidro ("Novo relato · Buraco na via · Setor Bueno", "Concluído com foto · Iluminação · Jardim Goiás"). Termina na onda azul/verde/amarela do guia.
3. **Como funciona**: "Do aviso à solução, em três passos." — O cidadão avisa / A prefeitura organiza / A equipe resolve, em cartões numerados com ícones.
4. **Para o cidadão**: "Sua voz chega direto na prefeitura." — Canal direto com a sua cidade / Acompanhe cada passo / Veja a foto do serviço feito; dois celulares inclinados com telas do app do cidadão.
5. **Para prefeituras** (fundo escuro): frase de destaque "O cidadão vira os **olhos da prefeitura** na rua. Você sabe onde está cada problema sem mandar ninguém procurar."; grade de blocos: mapa (grande, com captura), "1 relato, mesmo com 20 avisos", equipes no app do agente, prazo à vista, prova com foto, dados protegidos (acesso por código, sem senha, LGPD).
6. **Contato**: "Quer o Alô Cidadão na sua cidade?" + "Fale com a gente. Mostramos o sistema funcionando com os bairros da sua cidade."; cartões WhatsApp (com a frase de prazo de resposta) e E-mail (com o endereço).
7. **Rodapé**: "© Alô Cidadão · Você faz uma cidade melhor"; Termos de Uso, Política de Privacidade, Entrar no painel.

**Visual**: cores do guia de marca (azul `#0057B8`, verde `#009E60`, amarelo `#F2C300`, cinza `#F5F7FA`), Lexend nos títulos e Source Sans 3 no texto (como o painel), logo do projeto (`apps/web/src/assets/simbolo.png`). **Minha decisão:** as fontes ficam hospedadas no próprio site (os pacotes `@fontsource` que o painel já usa), sem chamada ao Google Fonts, porque a página de Privacidade está no mesmo site e o visitante não deve ter o IP enviado a terceiros. As imagens ficam em `/img/` no site gerado (os caminhos `/files/...` do mockup eram só do protótipo). O link "Entrar no painel" usa `/entrar`, rota que já existe no painel. Ícones SVG no estilo Lucide (sem emoji). Responsivo (375 / 768 / 1024 / 1440 sem rolagem horizontal); animações respeitam `prefers-reduced-motion`; contraste mínimo 4,5:1; foco visível; imagens com `alt`, tamanho declarado e `loading="lazy"` abaixo da dobra.

**Minha decisão:** as telas do cidadão na seção 4 são capturas reais do app (não desenhos em HTML como no mockup).

## 4. Capturas do sistema

- Um script no repositório gera as imagens a partir do sistema rodando localmente com o seed de Goiânia (painel no navegador e app do cidadão/agente na versão web do Expo ou no simulador — o builder escolhe o que for estável), e as grava no `apps/site` como arquivos estáticos (WebP ou PNG otimizado). Rodar de novo atualiza as imagens quando as telas mudarem.
- Telas mínimas: mapa do painel com pinos e situação do prazo (Goiânia); app do agente concluindo um atendimento; app do cidadão com a lista de solicitações e com um serviço concluído com foto.
- Fotos de serviço (antes/depois) vêm de banco de imagens gratuito com licença que permite uso comercial (decisão do usuário: ainda não há fotos reais). Guardar a origem e a licença de cada foto num arquivo ao lado delas. Trocar por fotos reais quando houver.
- As imagens geradas são commitadas no repositório (o build do site não depende do sistema rodando).
- O seed de Goiânia (`packages/db/src/seed-dev-data.ts`) já tem prefeitura, bairros, equipes, agente e solicitações em várias situações, mas não tem foto real de serviço concluído. O script monta o que faltar (ex.: uma solicitação concluída com foto) pelas rotas e ações de desenvolvimento que já existem, sem mexer no seed usado pelos testes.
- As capturas não podem mostrar dado pessoal real (o seed é fictício) nem a faixa de "modo suporte".

## 5. Contato editável no backoffice

- **Dados:** WhatsApp (celular brasileiro), e-mail e frase de prazo de resposta (texto curto). Valores iniciais (de teste, decisão do usuário): WhatsApp `(62) 98208-9667`, e-mail `gdcardoso@gmail.com`, frase "Resposta no mesmo dia".
- **Banco:** um registro único de configuração do site, lido publicamente e alterado só pela equipe interna (função `SECURITY DEFINER` ou política, seguindo a decisão 0001). Migração com os valores iniciais.
- **API:** rota pública sem login (`GET /public/site-contact` ou nome equivalente) que devolve só esses três campos; rota da equipe para salvar (Admin, como a P6), com auditoria (`insertStaffAudit`, nova ação, ex.: "Alterou o contato do site"). O site é servido de outro domínio. **Minha decisão:** só a rota pública responde com `Access-Control-Allow-Origin: *` (dado público, só leitura, sem cookie); o CORS das outras rotas continua como está (`CORS_ORIGIN`).
- **Backoffice:** item novo no menu, "Site", só para o Admin (`adminOnly`, como "Equipe Alô Cidadão"), com os três campos, validação (celular válido, e-mail válido, frase com limite de tamanho) e botão Salvar com aviso de sucesso.
- **Site:** ao abrir, busca o contato na rota pública e preenche os cartões; o botão do WhatsApp abre `https://wa.me/55{número}`; o do e-mail abre `mailto:`. **Sem API** (fora do ar, erro ou demora > 3 s): usa os valores gravados no HTML no momento do build, que vêm da mesma rota se estiver disponível no build, ou dos valores iniciais acima.
- O endereço da API usado pelo site vem de configuração no build (ex.: `SITE_API_URL`). **Minha decisão:** sem `SITE_API_URL` ou com a API fora do ar no build, o build não falha: avisa no terminal e grava os valores iniciais. O valor gravado pode ficar desatualizado até o próximo build; isso é aceito, porque ele só aparece quando a API está fora do ar.
- **Antes do lançamento:** os valores iniciais são contatos pessoais de teste (decisão do usuário) e ficam no código e na migração; trocar pelo contato comercial definitivo no backoffice e nos valores iniciais.

## 6. Deixado para o builder

- Nome exato das rotas, da tabela e da ação de auditoria.
- Ferramenta das capturas (Playwright já é usado no ambiente) e formato das imagens.
- Como o site injeta o contato (script pequeno no HTML gerado, sem framework).
- Ajustes finos de espaçamento e animação, desde que fiquem fiéis ao mockup v2.
