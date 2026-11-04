# Convite por e-mail e Termos/Privacidade — design

**Data:** 04/11/2026 · **Base:** `docs/superpowers/specs/2026-10-31-pronto-para-validacao-design.md`, `docs/superpowers/specs/2026-10-28-backoffice-6b-design.md`, `docs/planejamento-mvp.md` · **Mockups do e-mail:** `../.superpowers/brainstorm/` (fora do repositório; estilo "B" aprovado)

Hoje quem é cadastrado no painel (admin da prefeitura, gestor, equipe Alô Cidadão) ou como agente não fica sabendo: ninguém avisa que a conta existe nem como entrar. E não há texto de Termos de Uso e Política de Privacidade: o app já linka `alocidadao.com.br/termos` e `/privacidade`, mas essas páginas não existem, e as lojas exigem a política publicada antes de aceitar o app.

## 1. Intenção

1. **Quem é cadastrado recebe um convite que explica como entrar**, com a cara da prefeitura.
2. **Não existe senha.** O convite só orienta o acesso por código, que continua como é hoje: gestor/admin/equipe Alô Cidadão entram com CPF e um código no e-mail; o agente entra no app (o mesmo do cidadão) com o celular e um código por SMS, e o app abre sozinho no modo agente.
3. **Termos e Privacidade existem como modelo**, bons o bastante para testes e demonstrações, e serão trocados pelo texto do jurídico antes da produção.
4. **Aceite por clique, com prova.** Quem entra aceita os Termos e declara ciência da Política; o sistema guarda a versão e a data.

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- E-mail de convite para admin da prefeitura (P2), gestor, agente e equipe Alô Cidadão (P6) (seção 3).
- E-mail obrigatório no cadastro do agente (seção 4).
- "Reenviar convite" nas listas (seção 5).
- Textos-modelo de Termos de Uso e Política de Privacidade, com uma fonte só (seção 6).
- Site estático com `/termos` e `/privacidade` (seção 7).
- Aceite no cadastro do cidadão e no primeiro acesso de quem foi convidado (seção 8).

**Não-objetivos (ficam para depois)**

- Página única de apresentação em `alocidadao.com.br`: passo próprio, o último antes da nuvem (decisão do usuário). O site desta entrega deve aceitar essa página depois sem refazer nada.
- Convite por SMS: entra no Plano 8, junto com o envio real de SMS.
- Publicação (domínio, DNS, hospedagem do site, domínio no Resend): Plano 8.
- Pedir aceite de novo quando o texto mudar. O usuário decidiu que uma versão nova vale só para quem chegar depois; o texto do jurídico já estará lá quando a produção começar.

**Antiobjetivos (seria fracasso mesmo funcionando)**

- Qualquer menção a senha, senha provisória ou "crie sua senha".
- Caixa de aceite que vem marcada, ou que dá para pular.
- Tratar a Política de Privacidade como consentimento ("concordo com o tratamento"). A base legal é a execução de política pública pela prefeitura (LGPD art. 7º, III e art. 23); a pessoa declara **ciência**.
- Falha no envio do e-mail impedir o cadastro.
- Texto jurídico diferente entre app, painel e site.

## 3. E-mail de convite

### 3.1 Quem recebe e quando

| Cadastro | Onde | Recebe |
|---|---|---|
| Admin da prefeitura | P2 (nova prefeitura, backoffice) | convite de gestão |
| Gestor | painel, Gestores | convite de gestão |
| Agente | painel, Equipes → adicionar agente | convite do agente |
| Equipe Alô Cidadão | P6 (backoffice) | convite da equipe Alô Cidadão |

**Agente só recebe convite com a prefeitura ativa** (decisão do usuário: o agente só usa o app se a prefeitura e ele estiverem cadastrados; o app só entra no modo agente com a prefeitura ativa). Agente cadastrado durante a implantação fica sem convite; quando a prefeitura é ativada, o sistema envia o convite a todos os agentes ativos dela que têm e-mail e ainda não receberam. Para isso, guardar quando o convite foi enviado (por vínculo). "Reenviar convite" do agente também só aparece com a prefeitura ativa. Gestores e admin recebem na hora, porque trabalham durante a implantação.

O convite sai depois que o cadastro é gravado, inclusive quando a pessoa já tinha conta (ex.: um cidadão que vira agente). Falha no envio fica no log e não desfaz o cadastro; o caminho é "Reenviar convite". Trocar o e-mail de alguém não reenvia sozinho.

### 3.2 Visual (aprovado: estilo B)

- Cabeçalho: faixa azul da marca (`#0057b8`) com "Alô Cidadão · {nome mostrado da prefeitura}" (`tenants.display_name`, ex.: "Prefeitura de Goiânia"). No convite da equipe Alô Cidadão, só "Alô Cidadão".
- Corpo branco sobre fundo cinza claro, botão verde (`#009e60`).
- Rodapé discreto: "Se você não esperava este convite, ignore este e-mail."
- Remetente: o mesmo dos códigos (`EMAIL_FROM`), com o nome da prefeitura no nome de exibição: "Alô Cidadão · Prefeitura de Goiânia <nao-responda@…>".
- O e-mail vai em HTML **e** texto puro (versão em texto para leitores que não mostram HTML). Hoje `EmailMessage` só tem `text`; ganha `html` opcional, e o envio pelo Resend passa a mandar os dois. Os e-mails atuais (código, conclusão) continuam só texto.
- HTML de e-mail: tabelas e estilos inline, sem imagens externas obrigatórias (o nome da marca é texto).

### 3.3 Textos (rascunho aprovado; o builder pode polir sem mudar o sentido)

**Convite de gestão** (admin da prefeitura e gestor)
- Assunto: "Você foi convidado para o painel do Alô Cidadão"
- "Olá, {primeiro nome}." / "A {Prefeitura de Goiânia} cadastrou você no Alô Cidadão, o sistema que recebe e acompanha as solicitações dos moradores, com o perfil **{Administrador da prefeitura | Gestor}**."
- Botão "Entrar no painel" → URL do painel (`portal.alocidadao.com.br`, por configuração).
- "Na tela de entrada, digite o seu CPF. Enviaremos um código para este e-mail. Não existe senha: a cada acesso você recebe um código novo."

**Convite do agente**
- Assunto: "Você foi convidado para o app do agente do Alô Cidadão"
- "A {Prefeitura} cadastrou você como agente da equipe **{nome da equipe}** no Alô Cidadão. Pelo app, você recebe as solicitações dos moradores e registra o atendimento."
- Botões "Baixar no Google Play" e "Baixar na App Store". Os links vêm da configuração; sem link configurado, no lugar dos botões vai "Procure **Alô Cidadão** na loja de aplicativos do seu celular."
- "Depois de instalar, abra o app e digite o seu celular {celular mascarado}. Você recebe um código por SMS. Não existe senha. O app já abre na sua lista de atividades."

**Convite da equipe Alô Cidadão** (minha decisão: texto próprio)
- Assunto: "Você foi adicionado à equipe do Alô Cidadão"
- "Você foi adicionado à equipe do Alô Cidadão com o papel **{papel}**." Botão "Entrar no backoffice" → mesma URL do painel. Mesmo parágrafo de CPF + código.

Sem flexão de gênero: o texto usa o nome do perfil ("com o perfil Gestor"), não "você é gestora".

### 3.4 Configuração nova (API)

- `PANEL_URL` (padrão em desenvolvimento: o endereço local do painel; produção: `https://portal.alocidadao.com.br`).
- `AGENT_APP_PLAY_URL`, `AGENT_APP_STORE_URL` (opcionais).
- O envio de e-mail hoje não chega às rotas do painel que criam gestor e agente (`registerPanelRoutes`/`registerAdminRoutes` recebem só `db`/`storage`); passam a receber o `EmailSender`.

## 4. E-mail obrigatório no cadastro do agente

- "Adicionar agente" (`AgentDialog.tsx`) ganha o campo E-mail, obrigatório por enquanto (decisão do usuário). Schema `agentCreateBodySchema` ganha `email`; `panel_find_or_create_agent_user` passa a receber e gravar o e-mail (nova migração).
- A coluna `users.email` continua aceitando vazio no banco (cidadãos não são obrigados); a obrigatoriedade fica no cadastro do agente.
- Conflitos seguem o padrão dos gestores: e-mail já usado por outra conta → `email_in_use`; pessoa que já existe (pelo celular) com outro e-mail → recusar com aviso, mostrando o e-mail mascarado, como o `email_mismatch` da P2. O builder escolhe a mensagem seguindo as existentes.
- A lista de agentes mostra o e-mail (mascarado ou não, seguindo o que a lista de gestores faz).
- **Minha decisão:** menu ⋯ do agente ganha "Trocar e-mail" (agentes antigos sem e-mail precisam de um jeito de receber convite). Não reenvia sozinho.
- **Minha decisão (segurança):** "Trocar e-mail" do agente copia a trava dos gestores (`panel_change_manager_email`, migração 0022): recusa com `email_change_not_allowed` se a pessoa é da equipe interna, tem acesso ao painel em qualquer prefeitura ou é agente em outra prefeitura. O e-mail é o segundo fator de entrada no painel e não pode ser trocado por quem não é dono dele. Se o próprio agente apagar o e-mail pelo perfil do app, o reenvio só some do menu até alguém cadastrar outro.
- Seed de demonstração: o agente já tem e-mail; nada muda além de garantir o campo.

## 5. "Reenviar convite"

- Menu ⋯ de **gestores** (painel), **agentes** (painel) e **equipe Alô Cidadão** (P6): item "Reenviar convite". Não aparece para conta desativada nem para agente sem e-mail.
- O admin da prefeitura não tem menu na lista de gestores do painel. **Minha decisão:** o reenvio dele fica na aba Gestores da P3 (backoffice), que hoje é só leitura, como único item de menu.
- Depois de reenviar: aviso curto "Convite reenviado para {e-mail mascarado}". Limite simples contra repetição (ex.: um reenvio por pessoa a cada minuto), no padrão do limite dos códigos.
- Cada envio e reenvio vai para a auditoria (quem enviou, para quem, quando), no padrão dos eventos que já existem.

## 6. Textos de Termos de Uso e Política de Privacidade

- **Uma fonte só** no projeto (ex.: `packages/shared`), com a versão (`TERMS_VERSION`) junto do texto. App, painel e site leem dessa fonte; o app mostra sem internet. O formato (markdown simples, lista de seções) fica com o builder, desde que os três mostrem o mesmo conteúdo.
- O texto é **modelo**: escrito a partir do que o sistema realmente faz, com os pontos que dependem da empresa ou do jurídico marcados **[A DEFINIR]** (razão social, CNPJ, endereço, encarregado/DPO e contato, prazos de guarda, foro). Um aviso no topo diz que é versão de testes.
- **Política de Privacidade (ciência, não consentimento)** cobre, no mínimo: papéis (a prefeitura é a controladora; a empresa do Alô Cidadão atua como operadora — **[A DEFINIR]** pelo jurídico); que dados são coletados por tipo de pessoa (cidadão: nome, celular, e-mail opcional, fotos, localização e endereço das solicitações; agente: nome, celular, e-mail, fotos e localização do atendimento; gestão e equipe interna: nome, CPF, e-mail; todos: registros de acesso e auditoria); finalidade; base legal (art. 7º, III e art. 23; e obrigação legal para registros de acesso); com quem é compartilhado (prefeitura; fornecedores de infraestrutura, envio de e-mail e SMS, notificações); mascaramento dos dados do cidadão para a equipe interna; guarda e exclusão; segurança; direitos do titular (art. 18) e como pedir; contato do encarregado; mudanças na política.
- **Termos de Uso** cobrem: o que é o serviço e quem presta; quem pode usar; conta e acesso por código; uso adequado (sem solicitações falsas, ofensivas, fotos de pessoas sem necessidade); o que a prefeitura faz com as solicitações e que prazos são estimativas; conteúdo enviado (fotos) e permissão de uso para o atendimento; suspensão de conta; limitação de responsabilidade; mudanças nos termos; lei e foro **[A DEFINIR]**.
- Antes de gravar, o texto é mostrado ao usuário para revisão.
- `TERMS_VERSION` passa para a data da nova versão. Quem já aceitou a versão anterior não precisa aceitar de novo (decisão do usuário).

## 7. Site estático

- Novo app no monorepo (ex.: `apps/site`), estático, com `/termos` e `/privacidade`, no visual da marca (cores e fontes do painel). Sem login, sem API.
- A raiz `/` fica, por enquanto, uma página mínima com o nome do Alô Cidadão e links para as duas páginas e para o painel; a página de apresentação substitui essa raiz no passo próprio.
- Os links que o app já usa (`https://alocidadao.com.br/termos` e `/privacidade`, em `ProfileContent.tsx`) continuam valendo.
- Publicação no domínio fica para o Plano 8; aqui basta rodar localmente e gerar os arquivos.

## 8. Aceite

### 8.1 Como funciona (igual em todo lugar)

- Caixa **desmarcada**: "Li e aceito os [Termos de Uso] e estou ciente da [Política de Privacidade]." Os dois trechos entre colchetes são links.
- Cada link abre o texto dentro do app ou do painel (tela/diálogo, não navegador externo). No fim do texto, botão **"Li e concordo"**: volta e marca a caixa.
- Sem a caixa marcada, o botão de continuar fica desabilitado.
- Grava `users.terms_version` e `users.terms_accepted_at` (colunas que já existem). A API só aceita a versão atual (`z.literal(TERMS_VERSION)`, como já faz no cadastro do cidadão).

### 8.2 Onde

- **Cidadão:** no cadastro (`quase-la.tsx`), onde a caixa já existe. Muda o texto do rótulo, os links passam a abrir o texto no app e entra o "Li e concordo".
- **Agente:** no primeiro acesso pelo app. Depois do código, se a conta ainda não tem `terms_version`, aparece uma tela de aceite antes da lista de atividades. Vale para quem já é agente hoje e nunca aceitou.
- **Gestão e equipe Alô Cidadão (painel e backoffice):** depois do código, se `terms_version` está vazio, tela de aceite antes do painel ou do backoffice.
- **Minha decisão: a API também bloqueia**, para o aceite valer como prova. Conta sem `terms_version` recebe recusa (`terms_required`) em todas as rotas autenticadas, menos `/me`, a rota de aceite, sair, e as que o próprio cadastro do cidadão já usa. Os apps tratam essa recusa abrindo a tela de aceite.
- Regra geral: a tela de aceite aparece para qualquer conta sem `terms_version` ao entrar (inclusive um cidadão antigo sem aceite, se existir). O `/me` precisa informar se falta aceite.
- Painel e app ganham links "Termos de Uso" e "Política de Privacidade" num lugar sempre acessível (o app já tem no perfil; no painel, no menu da conta ou no rodapé — escolha do builder).

## 9. Pencil

Este pacote **não** passa pelo Pencil (decisão do usuário em 04/11/2026). As telas seguem o visual que já existe no código; o e-mail segue o mockup B aprovado.

## 10. Deixado para o builder

- Formato da fonte única do texto jurídico e como cada app o renderiza.
- Estrutura do HTML do e-mail e onde os modelos moram (seguindo `email.ts`/`completionEmail`).
- Nome e formato do limite de reenvio e do evento de auditoria.
- Ferramenta do site estático (seguir o que o monorepo já usa, ex.: Vite).
- Onde ficam os links de Termos/Privacidade no painel.
