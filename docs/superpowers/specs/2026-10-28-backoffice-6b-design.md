# Backoffice 6b — design

**Data:** 28/10/2026 · **Base:** `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md` (3.6), `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md`, seção "Plano 6b" de `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`, `docs/superpowers/plans/2026-10-26-backoffice-6a.md` · **Telas:** `design/alocidadao.pen`

Segunda parte do backoffice da equipe Alô Cidadão. O 6a entregou entrada da equipe, P1, P2, P3 (Visão geral) e P4 (modo suporte com auditoria). O 6b entrega as telas que o menu ainda mostra como provisórias e as correções que ficaram pendentes.

## 1. Intenção

A equipe interna precisa de três coisas que hoje não tem: ver onde há demanda para vender (P5), controlar quem da empresa entra no backoffice (P6) e consultar tudo o que a equipe fez (Auditoria). Além disso, o painel da prefeitura manda "falar com o suporte" em três casos que hoje ninguém consegue resolver.

Ideias que guiam as decisões:

1. **Equipe interna e prefeituras são mundos separados.** Ninguém é ao mesmo tempo da equipe Alô Cidadão e gestor ou agente de uma prefeitura.
2. **Toda ação da equipe fica registrada**, inclusive as que não são dentro de uma prefeitura.
3. **Tudo o que tem tela nasce no Pencil antes do código**, para o histórico do que foi criado ficar no arquivo de design (decisão do usuário).

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- P5 Interesse por cidade, P6 Equipe Alô Cidadão e a tela de Auditoria funcionando, no lugar das páginas provisórias.
- Suporte resolve, pelo modo suporte, troca de e-mail de gestor, troca de celular de agente e CPF preso em conta congelada.
- Correções de banco e API listadas na seção 7.

**Não-objetivos (ficam para depois do 6b)**

- Abas da P3 além de Visão geral (Contrato, Equipes e agentes, Gestores, Categorias, Cidadãos, Auditoria). A maior parte do que elas mostrariam o suporte já faz entrando no painel. Continuam com a página provisória.
- Anotações, histórico de contato, busca, filtro e paginação na P5.
- A prefeitura consultar o registro de auditoria dela (previsto em 3.6 do design do MVP; fica para quando houver a aba).

**Antiobjetivos — seria falha mesmo funcionando**

- Alguém da equipe interna conseguir virar gestor ou agente, ou o contrário.
- Uma ação da equipe interna sem linha na auditoria.
- O Suporte ver ou mexer na equipe interna ou na auditoria dos colegas.
- A equipe interna ficar sem nenhum Admin.
- Dado pessoal em `staff_audit_events.details` (regra do 6a).

## 3. Pencil antes do código (primeira etapa)

Desenhar em `design/alocidadao.pen`, no mesmo padrão das telas P1–P6, e extrair para `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md` (ou um complemento) com as imagens em `telas-backoffice/`:

- **Auditoria (P7):** tela inteira, com filtros, tabela, paginação e estado vazio.
- **P6:** formulário "Adicionar pessoa", menu "⋯" da linha, confirmação de trocar papel e de remover da equipe.
- **P5:** menu "⋯" com a escolha da situação comercial e o selo "Já é cliente".
- **Modo suporte no painel:** a variação das janelas de gestor e de agente (seção 6), incluindo o aviso de CPF em conta congelada com "Recuperar conta antiga" (código pelo e-mail) e "Criar conta nova"; e o mesmo aviso na P2. Na P6, também "Editar".

O usuário revisa os desenhos antes de a parte de código de cada tela começar. Textos que aparecerem só no código (validações, erros da API) seguem a regra do 6a: listados nas pendências para o usuário confirmar.

## 4. P5 — Interesse por cidade

Ranking dos municípios onde moradores tocaram em "Quero o Alô Cidadão aqui" (`city_interest`), para o comercial.

- **Colunas (Pencil):** posição, município — UF, pedidos (pessoas distintas; a chave de `city_interest` já garante uma por município), últimos 30 dias ("+N"), primeiro pedido, situação comercial, "⋯".
- **Ordem:** pedidos, do maior para o menor.
- **Município que já é cliente fica na lista** com o selo "Já é cliente" ao lado do nome (decisão do usuário). Conta como cliente quando existe prefeitura cadastrada para o código IBGE, em qualquer status, inclusive em implantação (minha decisão). A situação comercial continua editável.
- **Situações comerciais** (decisão do usuário), na ordem: Sem contato, Contatado, Proposta enviada, Em negociação, Fechado, Perdido. Valores guardados em inglês (`new`, `contacted`, `proposal_sent`, `negotiating`, `won`, `lost`); o enum atual (`new`, `contacted`, `negotiating`, `won`, `lost`) ganha `proposal_sent`. Município sem linha em `municipality_leads` aparece como "Sem contato".
- **"⋯":** só mudar a situação comercial. Grava em `municipality_leads` (cria a linha se não existir) e registra na auditoria sem prefeitura.
- **Exportar CSV:** baixa a lista como está na tela, com a situação em português e a coluna "Já é cliente".
- **Quem usa:** Admin e Suporte, os dois podem mudar a situação (minha decisão; o design do MVP não restringe a P5).

## 5. P6 — Equipe Alô Cidadão e P7 — Auditoria

### P6

- **Só o Admin interno** vê o item no menu e acessa as rotas. Para o Suporte o item some e a API responde 403.
- **Tabela (Pencil):** nome, CPF mascarado, e-mail (recebe o código), papel (Admin, Suporte), último acesso, "⋯". Os cartões de explicação dos papéis ficam como no Pencil.
- **Adicionar pessoa:** nome, CPF, e-mail e papel. Se já existe conta com o CPF, ela recebe o papel (as mesmas checagens de CPF e e-mail do cadastro de admin de prefeitura no 6a valem aqui). A pessoa entra como hoje: CPF e código por e-mail.
- **Recusa quem é gestor ou agente** de qualquer prefeitura (decisão do usuário). O espelho também vale: `panel_find_or_create_manager_user` e o cadastro de agente recusam conta com `platform_role`, como `platform_find_or_create_tenant_admin` já faz (`staff_account_not_allowed`). Ser cidadão no app não conflita (minha decisão).
- **"⋯":** editar (nome e e-mail), trocar papel (Admin ⇄ Suporte) e remover da equipe. Remover tira `platform_role`; a conta continua e as linhas de auditoria com o nome dela ficam.
- **Travas:** ninguém remove a si mesmo nem troca o próprio papel; sempre resta ao menos um Admin. Checado no banco, não só na tela.
- **Auditoria:** adicionar, trocar papel e remover viram linhas sem prefeitura.

### P7 — Auditoria

- **Só o Admin interno** (decisão do usuário).
- **Lista** de `staff_audit_events`, da mais recente para a mais antiga, com paginação. Colunas: quando, pessoa, prefeitura (vazio para ação do backoffice), ação (rótulos de `STAFF_AUDIT_ACTION_LABELS`, já aprovados; ações novas ganham rótulo) e alvo.
- **Filtros:** prefeitura, pessoa da equipe e período.
- **Ações sem prefeitura:** `staff_audit_events.tenant_id` passa a aceitar nulo, para ações do backoffice (equipe interna, situação comercial, criação de prefeitura se fizer sentido). As políticas e funções que leem a tabela pela prefeitura continuam ignorando as linhas sem prefeitura.

## 6. Correções de conta pelo suporte (dentro do painel)

O suporte resolve pelas mesmas janelas do painel, em modo suporte (decisão do usuário). Fora do modo suporte nada muda para gestores.

1. **Trocar e-mail de gestor** que também tem outro painel, é admin ou tem `platform_role` (`email_change_not_allowed`): aceita quando quem edita é da equipe interna.
2. **Trocar celular de agente** com vínculo em outra prefeitura (`phone_change_not_allowed`): aceita quando quem edita é da equipe interna.
3. **CPF em conta congelada** ao cadastrar gestor (`cpf_unavailable`) ou admin na P2 (minha decisão incluir a P2): em modo suporte (ou na P2, para a equipe interna) o aviso vira "Este CPF está numa conta congelada." e oferece dois caminhos (decisão do usuário: nunca dar a alguém acesso à conta de outra pessoa sem verificação):
   - **Recuperar a conta antiga:** um código vai para o e-mail guardado na conta congelada; a pessoa repassa o código ao suporte, que o digita na janela. Código certo → a conta é descongelada (histórico mantido), o e-mail passa a ser o informado no cadastro e o cadastro segue com ela. Só aparece se a conta congelada tem e-mail.
   - **Criar conta nova:** quando a conta congelada não tem e-mail ou a pessoa não consegue o código. Tira o CPF da conta congelada (que continua congelada) e o cadastro segue com uma conta nova. Pede confirmação.
     Os dois caminhos viram linhas de auditoria próprias. Limite de tentativas do código igual ao do login.

A permissão é dada no banco (função própria ou checagem de `app.platform_role` dentro da função existente), nunca só na tela. Cada uma das três vira linha de auditoria com ação própria e sem dado pessoal em `details`. Textos finais saem do Pencil (seção 3).

## 7. Correções sem tela (decisões minhas, apresentadas ao usuário)

- **Excluir conta:** apaga as linhas de `city_interest` da pessoa, tira `platform_role` e deixa de guardar `installation_id` nas sessões revogadas.
- **`municipality_leads`:** `updated_by` forçado a `app_current_user()` e `updated_at` atualizado no `UPDATE`.
- **Tempo médio até a conclusão (P1/P3):** cada ocorrência conta uma vez, pela entrada mais recente em `awaiting_confirmation` nos últimos 30 dias.
- **Auditoria de `POST /panel/teams/:id/agents`:** alvo passa a ser o agente (`target_type` `agent`, id do agente criado ou vinculado).
- **Equipe interna que também é gestor:** o caso deixa de existir (seção 5). Conferir e limpar o banco de desenvolvimento; o código que tratava esse caso pode ser simplificado.
- **Saída do modo suporte que falhou:** a tela continua liberando a pessoa. A API passa a gravar `support.leave` quando a mesma pessoa entra em outra prefeitura (ou entra de novo no backoffice) e o último `support.enter` dela não tem saída. Se encerrar por tempo sem atividade também for simples, fazer; senão, fica registrado como pendência.
- **`GET /panel/reviews/:id` com 404 depois de publicar em modo suporte:** investigar a causa e corrigir.
- **Rótulo "Central de atendimento" desalinhado na P2:** corrigir.
- **Último Admin excluindo a própria conta** (pelo app): a exclusão é recusada, com mensagem pedindo para passar o papel de Admin a outra pessoa antes.
- **Separação equipe × prefeitura conta só vínculos ativos:** quem teve vínculo de gestor ou agente desativado pode entrar na equipe; quem saiu da equipe pode virar gestor ou agente.
- **P5:** o Suporte também muda a situação comercial (não é contrato nem equipe interna).
- **Coluna "alvo" da P7:** mostra o nome atual do alvo (equipe, categoria, protocolo, pessoa), buscado na hora de exibir; nada pessoal é gravado em `details`. Conta excluída aparece como "Conta excluída".
- **P6 "⋯" tem também "Editar"** (nome e e-mail), auditado, para não remover e adicionar de novo.
- **Busca de município sem acento (`lower()` + `translate()`):** fica como está.

## 8. Ordem

1. Pencil (seção 3) e revisão do usuário.
2. Banco e API: correções da seção 7, enum e auditoria sem prefeitura, separação equipe × prefeitura, travas da P6.
3. P6.
4. P5.
5. P7 Auditoria.
6. Correções do suporte no painel (seção 6).
7. Documentação, pendências e passada no navegador (como no 6a).

## 9. Deixado para quem implementa

- Nomes de funções, rotas e ações de auditoria novas, e seus rótulos (rótulos entram na lista de textos para o usuário confirmar).
- Tamanho da página e formato dos filtros de período na P7.
- Formato exato do CSV (separador, codificação), desde que abra certo no Excel em português.
- Como representar "Já é cliente" na API.
