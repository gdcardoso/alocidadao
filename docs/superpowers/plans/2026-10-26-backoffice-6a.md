# Backoffice Alô Cidadão, parte A — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A equipe interna do Alô Cidadão (admin e suporte da plataforma) entra no backoffice, vê a carteira de prefeituras (P1), cria uma prefeitura (P2), acompanha e ativa ou suspende uma prefeitura (P3, Visão geral) e entra no painel de uma prefeitura em modo suporte (P4), com cada alteração registrada na auditoria que a prefeitura lê.

A parte B (Plano 6b) traz Interesse por cidade (P5), Equipe Alô Cidadão (P6), a tela de Auditoria, as outras abas da P3 e as correções de conta pelo suporte.

**Architecture:**

- **Quem é da equipe interna:** a API confere `users.platform_role` no banco a cada chamada e só com token de audiência `panel`. Só então grava `app.platform_role` no contexto (`withContext`). Um token do app nunca recebe papel interno.
- **Rotas `/backoffice/*`:** leituras entre prefeituras por funções `SECURITY DEFINER` que devolvem agregados (decisão 0001); escritas pela própria API com `app.platform_role = 'admin'`.
- **Modo suporte:** as rotas `/panel/*` aceitam a equipe interna em qualquer prefeitura em implantação ou ativa, como se fosse o admin dela. Toda chamada que altera dados, mais a entrada e a saída, grava `staff_audit_events`.
- **Web:** o mesmo `apps/web` ganha o shell do backoffice (menu escuro) em `/backoffice/*`. O painel da prefeitura ganha a faixa do modo suporte.

**Tech Stack:** o mesmo dos Planos 5a e 5b. Nenhuma dependência nova.

**Spec:**

- `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md`, seções 3.4 e 3.6, e "Isolamento" em 9.
- Telas: `docs/superpowers/specs/2026-10-26-telas-backoffice-pencil.md` (capturas em `docs/superpowers/specs/telas-backoffice/`) e a seção 1.3 de `docs/superpowers/specs/2026-10-26-telas-painel-pencil.md` (P4).
- Ver também `docs/decisoes/0001-isolamento-por-prefeitura.md`, `docs/design-system.md`, os planos `2026-10-26-painel-5a.md` e `2026-10-26-painel-5b.md`, e a seção "Plano 6" de `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`.

## Decisões deste plano (o spec e o Pencil deixam em aberto)

Decididas com o usuário em 26/10/2026:

- **O Plano 6 tem duas partes.** Esta (6a) cobre entrada da equipe interna, P1, P2, P3 Visão geral com ativar e suspender, e P4 modo suporte com auditoria.
- **Auditoria do modo suporte:** grava entrar, sair e cada chamada que altera dados. Ver telas não grava nada além da entrada.
- **Valores em inglês, telas em português.** Tudo que é salvo e todo código ficam em inglês, e a tela mostra um rótulo amigável em português (por exemplo `essential` → `Essencial`).

### Entrada e permissões

- **Login:** o mesmo da W0a/W0b (CPF + código no e-mail). Depois do login, quem tem `platformRole` em `GET /me` vai para `/backoffice/prefeituras`; os demais seguem para `/mapa`. Quem é da equipe e também gestor de alguma prefeitura vai para o backoffice e entra na prefeitura pelo modo suporte.
- **`requirePlatformStaff(db, request, reply, roles = ['admin', 'support'])`:**
  - exige token `panel`, senão 403 `not_platform_staff`;
  - lê `users.platform_role` com a conta ativa e não excluída;
  - sem papel, ou com papel fora de `roles`: 403 `not_platform_staff` (ou `admin_only` quando `roles` é só `['admin']`);
  - devolve `{ userId, platformRole }`.
- **O que cada papel faz no backoffice:**
  - **admin:** tudo desta parte.
  - **suporte:** vê P1 e P3 e entra no modo suporte. Não cria prefeitura, não ativa, não suspende nem reativa: esses botões não aparecem, e a API responde 403 `admin_only`.
- **Menu do backoffice** (componente escuro do Pencil, `mQMT4`):
  - os itens são `Prefeituras` (`building-2`), `Interesse por cidade` (`map-pinned`), `Equipe Alô Cidadão` (`shield-user`) e `Auditoria` (`scroll-text`);
  - os três últimos abrem nesta parte uma página provisória com o título do item e o texto `Esta tela chega na próxima etapa do backoffice.`;
  - na caixa do usuário, as iniciais, o nome e o papel `Admin · Alô Cidadão` ou `Suporte · Alô Cidadão`;
  - abaixo, o botão `Sair` (`log-out`, `aria-label` `Sair`), que faltava no Pencil, igual ao do painel.
- Contas sem papel interno que abrem `/backoffice/*` voltam para `/mapa`.

### P1 Prefeituras

- **Apoio:** `{n} prefeituras · {a} ativas, {i} em implantação`. Cada parte vai para o singular com 1 (`1 prefeitura`, `1 ativa`). Com suspensas, acrescenta `, {s} suspensas`. Com zero, a parte some (mas `{n} prefeituras` fica).
- **Indicadores** (4 cartões):
  - `Prefeituras ativas` · número · `+{i} em implantação` (some sem nenhuma).
  - `Cidadãos` · número formatado (`12.480`) · `fizeram ao menos 1 solicitação`. Contam as pessoas distintas com alguma solicitação em prefeitura ativa.
  - `Solicitações no mês` · número · `+12% sobre setembro`, `-5% sobre setembro` ou, sem base, `sem comparação com setembro`. Contam as solicitações criadas no mês corrente, em todas as prefeituras, no horário de Brasília. A variação compara com o mês anterior inteiro, arredondada para inteiro.
  - `Tempo médio até a conclusão` · `4,2 dias` · `média das ativas, últimos 30 dias`. É a média, nas prefeituras ativas, do tempo entre a criação da solicitação e o evento dela para `awaiting_confirmation`, nos eventos dos últimos 30 dias, com uma casa decimal. Sem dado: `—`.
- **Tabela:** colunas do Pencil.
  - **Ordem:** ativas, em implantação e suspensas, cada grupo por nome.
  - **Status:** selo `Ativa` (`success-soft`), `Em implantação` (`primary-soft`) ou `Suspensa` (fundo `border`, texto `text-secondary`).
  - **Plano:** rótulo do plano do contrato mais recente (`PLAN_LABELS`); sem contrato, `—`.
  - **Cidadãos:** número de pessoas distintas com solicitação.
  - **Abertas:** ocorrências em triagem ou em atendimento.
  - **Tempo médio:** a regra do indicador, por prefeitura.
  - **Alertas:** o primeiro que valer, nesta ordem:
    1. `{n} aguardando revisão há +1 dia` (`triangle-alert` `warning`): atividades `awaiting_review` há 24 h ou mais;
    2. `{n} impedimentos parados` (`triangle-alert` `warning`): atividades `impeded` há 24 h ou mais;
    3. `Sem categorias configuradas` (`info` `primary`): nenhuma categoria ativa;
    4. sem alerta: `—`.

    "Há quanto tempo" segue o `statusSince` da atividade do 5b. Com 1, fica no singular (`1 aguardando revisão há +1 dia`, `1 impedimento parado`).

  - **`Abrir`** (ou clicar na linha): abre a P3.
  - **Vazio:** `Nenhuma prefeitura cadastrada.`
- **Botão `Nova prefeitura`:** só para o admin.

### P2 Nova prefeitura (só o admin)

- **Município:**
  - **Busca:** o campo `Buscar município (IBGE)` procura na tabela `municipalities` (pendência do Plano 6), por nome sem acento e sem diferenciar maiúsculas, ou pelo código de 7 dígitos.
  - **Resultados:** até 10, no formato `{nome} — {UF} · {código}`. Os municípios que já têm prefeitura aparecem desabilitados, com `já cadastrado` ao lado.
  - **Ao escolher:**
    - o aviso de sucesso mostra `Limite do município importado do IBGE` e `Usado para saber em qual prefeitura cai cada solicitação.`;
    - a prévia é um retângulo verde com o ícone `map`, sem mapa real;
    - `Nome de exibição` vem preenchido com `Prefeitura de {nome}`;
    - `Central de atendimento` vem preenchido com `156`.
- **Admin da prefeitura:**
  - campos `Nome` (2 a 80), `CPF` (`cpfSchema`, com máscara) e `E-mail institucional` (`z.email()`, gravado em minúsculas). Os três são obrigatórios (pendência "exigir e-mail e CPF");
  - a ajuda é a do Pencil;
  - a conta é achada ou criada pela função do banco `platform_find_or_create_tenant_admin`, com as mesmas regras do gestor no 5b:
    - CPF de conta com outro e-mail: 409 `email_mismatch` com `maskedEmail`;
    - e-mail de outra conta: 409 `email_in_use`;
    - CPF numa conta bloqueada: 409 `cpf_unavailable`;
    - CPF de conta da equipe interna: 409 `staff_account_not_allowed` (`Esta pessoa é da equipe Alô Cidadão. Use outro CPF.`, decidido na revisão final).
- **Contrato:**
  - `Plano`: select com `PLANS = ['essential', 'complete']` (`Essencial`, `Completo`);
  - `Agentes e gestores incluídos`: inteiro de 1 a 10000;
  - `Início da vigência` (obrigatório) e `Fim da vigência` (opcional, mesmo dia ou depois do início): campos `input type="date"`;
  - a nota é a do Pencil.
- **Categorias iniciais:** a caixa `Copiar o catálogo padrão (9 categorias, prazos e raios sugeridos)` vem marcada.
  - **Marcada:** a prefeitura recebe três setores, `Obras`, `Meio ambiente` e `Serviços`, e as 9 categorias de `DEFAULT_CATALOG`, cada uma com nome, ícone, grupo, raio e prazo:
    - `Obras`: Buraco na via, Iluminação, Calçada, Sinalização;
    - `Meio ambiente`: Lixo e entulho, Poda de árvore, Esgoto;
    - `Serviços`: Animal, Outro.

    Os raios são os do spec 5.2 (os do seed); os prazos, 7 dias.

  - **Desmarcada:** a prefeitura nasce sem setores nem categorias.
  - A ajuda é a do Pencil.
- **Criar** (uma transação, com `app.platform_role = 'admin'` e `app.tenant_id` da prefeitura nova):
  - a prefeitura nasce `onboarding`, com `name` = nome do município, `city`, `state`, `ibge_code` e `boundary` copiados de `municipalities`, `display_name` e `central_phone`;
  - o contrato;
  - a conta do admin, com o vínculo `tenant_admin` `active`;
  - o catálogo, se marcado;
  - o evento de auditoria `tenant.create`.
  - **Recusas:** município já cadastrado, 409 `tenant_exists`; município inexistente, 422 `municipality_not_found`.
  - **Depois:** abre a P3 da prefeitura nova, com o aviso `Prefeitura criada. Ela está em implantação.`
- **Botões:** `Cancelar` e a seta de voltar levam à P1, sem confirmação.
- **Textos de erro nos campos:**
  - `Este município já tem prefeitura cadastrada.`
  - `Este CPF já tem outro e-mail cadastrado: {maskedEmail}.`
  - `Este e-mail já é de outra pessoa.`
  - `Este CPF está numa conta bloqueada. Fale com o suporte do Alô Cidadão.`
  - `O fim da vigência não pode ser antes do início.`

### P3 Detalhe da prefeitura, aba Visão geral

- **Título e selo de status:** o nome de exibição e o selo da P1. O apoio é `{UF} · IBGE {código} · cliente desde {dd/mm/aaaa} · plano {Plano}`, com a data de início do contrato mais recente. Sem contrato, os dois últimos trechos saem.
- **Abas:** nesta parte, só `Visão geral`. As outras chegam no 6b.
- **Indicadores:**
  - `Cidadãos` · `fizeram ao menos 1 solicitação`.
  - `Abertas e em atendimento` · `{n} abertas há +3 dias`, com as ocorrências em triagem há 72 h ou mais; zero mostra `nenhuma aberta há +3 dias`.
  - `Aguardando revisão` · `{n} há mais de 1 dia`. Com `n` maior que zero, o cartão ganha borda `warning` e o apoio fica em `#78350F` (`--warning-strong`). Com zero: `nenhuma há mais de 1 dia`.
  - `Tempo médio até a conclusão` · `últimos 30 dias` (a regra da P1, só desta prefeitura).
- **Pessoas da prefeitura:** cada linha tem o botão `Gerenciar`, que entra no modo suporte e abre a página da prefeitura.
  - `Equipes` · `{n}` (abre `/equipes`).
  - `Agentes` · `{a} ativos · {c} convidados`, com `1 ativo` e `1 convidado` no singular; sem convidados, só `{a} ativos` (abre `/equipes`).
  - `Gestores` · `{g}` e, havendo admin, ` · {m} admin` (`2 admins`) (abre `/equipes/gestores`).
  - `Categorias` · `{n} ativas` (`1 ativa`) (abre `/categorias`).
- **Contrato:**
  - `Plano`;
  - `Vigência`: `{início} a {fim}`, ou `desde {início}` sem fim;
  - `Usuários do painel`: `{u} de {incluídos} incluídos`. `u` conta os vínculos `field_agent` ativos ou convidados mais os `manager` e `tenant_admin` ativos, cada pessoa uma vez;
  - `Central`, ou `—` sem central.
- **Últimas ações da equipe Alô Cidadão:**
  - os 5 eventos mais recentes de `staff_audit_events` da prefeitura;
  - cada item é a ação, pelo rótulo de `STAFF_AUDIT_ACTION_LABELS`, e `{nome} · {quando}` (`hoje, 10:02`, `ontem, 16:30` ou `12 out`);
  - sem eventos: `Nenhuma ação da equipe Alô Cidadão ainda.`
- **Ações:**
  - `Entrar no painel da prefeitura` (primário, `log-in`): para admin e suporte, com a prefeitura em implantação ou ativa. Suspensa: o botão fica desabilitado, com a ajuda `Reative a prefeitura para entrar no painel.`
  - **Só o admin:**
    - **`Ativar prefeitura`** (primário, `circle-check`), com a prefeitura em implantação. O diálogo tem o título `Ativar {nome}?` e o texto `Ela passa a aparecer para os cidadãos do município, que poderão registrar solicitações.`, com `Cancelar` e `Ativar`.
      - Exige ao menos uma categoria ativa e um setor com equipe; senão, 422 `tenant_not_ready`, com o aviso `Antes de ativar, cadastre ao menos uma categoria ativa e uma equipe.`
      - Aviso de sucesso: `Prefeitura ativada.`
    - **`Suspender`** (contorno `danger`, `pause`), com a prefeitura ativa. O diálogo tem o título `Suspender {nome}?` e o texto `Os cidadãos deixam de conseguir registrar solicitações no município, e gestores e agentes perdem o acesso. As solicitações abertas ficam como estão.`, com `Cancelar` e `Suspender` (fundo `danger`). Aviso: `Prefeitura suspensa.`
    - **`Reativar`** (primário, `play`), com a prefeitura suspensa, sem confirmação. Aviso: `Prefeitura reativada.`
  - Cada mudança de status grava auditoria (`tenant.activate`, `tenant.suspend`, `tenant.reactivate`). Mudança que não vale para o status atual: 409 `tenant_status_conflict`.

### P4 Modo suporte

- **Entrar:**
  - `POST /backoffice/tenants/:id/support/enter` grava `support.enter` e responde 204;
  - a prefeitura suspensa responde 409 `tenant_suspended`;
  - o web guarda a prefeitura escolhida em `sessionStorage` (`ac_support_tenant`), assim o recarregar mantém o modo suporte, e abre `/mapa` (ou a página pedida pelo `Gerenciar`).
- **Painel:**
  - o `PanelLayout` usa essa prefeitura no lugar de `me.panelTenants[0]`;
  - a faixa do Pencil fica no topo, com altura 44, o texto `Você está na {nome de exibição} como equipe Alô Cidadão · suas ações ficam registradas na auditoria` e o botão `Sair da prefeitura`;
  - na caixa do usuário, o nome e `Equipe Alô Cidadão`, sem o `Sair`.
- **Sair:** `POST /backoffice/tenants/:id/support/leave` grava `support.leave` e responde 204. O web apaga o `sessionStorage` e volta para a P3. Fechar a aba não grava a saída.
- **API do painel com a equipe interna:**
  - `requirePanelMember` aceita a equipe interna (admin e suporte) em qualquer prefeitura em implantação ou ativa, sem vínculo;
  - devolve `role: 'tenant_admin'`, `departmentIds: null` e `platformRole`;
  - prefeitura suspensa, para a equipe interna, responde 403 `not_a_member`, como para o gestor.
- **Contexto do banco:** `PanelIdentity` ganha `platformRole: PlatformRole | null`. Toda chamada a `withContext` no painel passa a usar `panelDbContext(identity)`, que devolve `{ tenantId, userId, platformRole }`.
- **As funções do 5b** (`panel_find_or_create_agent_user`, `panel_change_agent_phone`, `panel_find_or_create_manager_user`, `panel_change_manager_email`) aceitam a equipe interna como quem chama (`app_is_platform_staff()`), inclusive nas regras só do admin.
- **Auditoria:**
  - um gancho `onResponse` no escopo `/panel` grava `staff_audit_events` quando a identidade tem `platformRole`, o método não é `GET` e a resposta é 2xx;
  - a ação vem de `PANEL_AUDIT_ACTIONS`, um mapa rota → ação (por exemplo `POST /panel/occurrences/:id/assign` → `occurrence.assign`);
  - `target_type` e `target_id` vêm do parâmetro `:id`, `:userId` ou `:occurrenceId` da rota;
  - `details` é `{ route: 'POST /panel/occurrences/:id/assign' }`, nunca o corpo, assim nenhum dado pessoal vai para a auditoria (pendência do Plano 6);
  - a gravação é numa transação própria, logo depois da resposta. Falha ao gravar vai para o log de erro e não muda a resposta.
- **Rótulos (`STAFF_AUDIT_ACTION_LABELS`):**

  | Ação                            | Rótulo                              |
  | ------------------------------- | ----------------------------------- |
  | `support.enter`                 | `Entrou no painel (suporte)`        |
  | `support.leave`                 | `Saiu do painel`                    |
  | `tenant.create`                 | `Criou a prefeitura`                |
  | `tenant.activate`               | `Ativou a prefeitura`               |
  | `tenant.suspend`                | `Suspendeu a prefeitura`            |
  | `tenant.reactivate`             | `Reativou a prefeitura`             |
  | `occurrence.assign`             | `Atribuiu uma ocorrência`           |
  | `occurrence.reject`             | `Recusou uma ocorrência`            |
  | `occurrence.merge`              | `Juntou ocorrências`                |
  | `occurrence.dismiss_suggestion` | `Descartou uma sugestão de junção`  |
  | `occurrence.split`              | `Separou relatos`                   |
  | `work_order.publish`            | `Publicou um atendimento`           |
  | `work_order.rework`             | `Devolveu um atendimento ao agente` |
  | `work_order.reassign`           | `Reatribuiu uma atividade`          |
  | `work_order.reschedule`         | `Reagendou uma atividade`           |
  | `team.create`                   | `Criou uma equipe`                  |
  | `team.update`                   | `Editou uma equipe`                 |
  | `agent.create`                  | `Adicionou um agente`               |
  | `agent.update`                  | `Alterou um agente`                 |
  | `manager.create`                | `Cadastrou um gestor`               |
  | `manager.update`                | `Alterou um gestor`                 |
  | `category.create`               | `Criou uma categoria`               |
  | `category.update`               | `Alterou uma categoria`             |
  | `department.create`             | `Criou um setor`                    |
  | `department.update`             | `Alterou um setor`                  |

  Ação sem rótulo aparece como `Fez uma alteração`. O teste confere que toda rota não-GET do `/panel` tem ação no mapa.

### Banco (migração `0024`, SQL próprio)

- **Funções** (todas `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`). As de leitura exigem `app_is_platform_staff()`, senão `insufficient_privilege`:
  - **`platform_tenant_summaries()`:** devolve uma linha por prefeitura com `tenant_id`, `citizen_count`, `open_count`, `avg_resolution_days numeric null`, `late_review_count`, `stale_impediment_count` e `active_category_count`.
  - **`platform_overview()`:** devolve uma linha com `active_tenants`, `onboarding_tenants`, `citizens`, `requests_this_month`, `requests_last_month` e `avg_resolution_days`.
  - **`platform_tenant_detail(p_tenant_id uuid)`:** os números da P3, ou seja, as contagens de cidadãos, abertas, abertas há 3 dias, revisão, revisão atrasada, equipes, agentes ativos e convidados, gestores, admins, categorias ativas, usuários do painel e tempo médio. Prefeitura inexistente devolve zero linhas.
  - **`platform_find_or_create_tenant_admin(p_name text, p_cpf text, p_email text) RETURNS TABLE (id uuid, email text)`:** igual a `panel_find_or_create_manager_user`, mas só para `app_is_platform_admin()`.
- **Tabela de origem:** a P2 lê `municipalities` direto, porque `app_user` já pode ler essa tabela.
- **`staff_audit_events_insert`:** continua igual (só a equipe, em nome próprio, na prefeitura do contexto).
- **Funções do 5b:** são recriadas com `CREATE OR REPLACE` para aceitar `app_is_platform_staff()` na checagem de quem chama.

### Outros

- **Seed:** o admin da plataforma (CPF `11144477735`) já existe. Acrescentar a conta de suporte `Suporte Demo`, CPF `86288366757`, e-mail `suporte.demo@alocidadao.dev`, papel `support`, e um contrato para a prefeitura demo: plano `complete`, 50 incluídos, início `2026-11-01`, fim `2027-10-31`.
- **Pendências desta parte:**
  - usar `municipalities` ao criar a prefeitura;
  - exigir e-mail e CPF do admin;
  - nenhum dado pessoal em `details` da auditoria;
  - `app.platform_role` nunca para token do app.

  Ficam para o 6b: `municipality_leads.updated_by`, as correções de conta pelo suporte, `city_interest` e `platform_role` na exclusão de conta, e o `installation_id` das sessões revogadas.

## Global Constraints

- TypeScript `~6.0.3`, Node `>=22`, Zod 4. Nenhuma dependência nova.
- **Nomes e textos:**
  - Identificadores e valores gravados em inglês. A tela mostra rótulos em português, mapeados no `shared`.
  - Comentários e mensagens em português.
  - Nomes de teste em português no `packages/db` e em inglês nos outros pacotes.
  - Textos das telas copiados do Pencil (`telas-backoffice-pencil.md`) ou das decisões acima, sem mudar uma vírgula.
- **Isolamento (decisão 0001):**
  - A API conecta como `app_user`.
  - `app.platform_role` só é gravado depois de `requirePlatformStaff` ou de `requirePanelMember` conferir `users.platform_role` no banco, e nunca para token de audiência `app`.
  - Leitura entre prefeituras só por funções que devolvem agregados.
- **Migrações:** não editar 0000–0023. Estruturais com `drizzle-kit generate`; funções, políticas e grants em SQL próprio (`--custom`).
- **Erros da API:** `{ code: string }` em snake_case. Toda rota declara schema de resposta (sucesso e erros).
- **Visual:**
  - Tokens e componentes do painel (`apps/web/src/styles/tokens.css`, `apps/web/src/ui/*`).
  - Os literais do menu escuro viram tokens: `--sidebar-dark-bg` (o `text-primary`), `--sidebar-dark-active` `#1E293B`, `--sidebar-dark-border` `#334155`, `--sidebar-dark-muted` `#94A3B8` e `--sidebar-dark-icon` `#CBD5E1`.
  - Ícones `lucide-react`.
  - Todo botão só com ícone tem `aria-label`; todo campo tem `label`.
- **Testes do web:** com `@testing-library/react` e o cliente da API simulado (`vi.mock`).
- **Commits:**
  - Mensagem curta em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  - Antes de cada commit: `pnpm lint`, `pnpm format:check` e os testes e o typecheck dos pacotes da tarefa.
- **Branch:** `backoffice-6a`, a partir do `main`, no próprio checkout.

## Review Focus

1. **Papel interno vindo do token ou do app:**
   - Um token `app` de alguém com `platform_role` não abre `/backoffice/*` nem o modo suporte.
   - Papel retirado no banco vale na próxima chamada.
   - Conta congelada perde o acesso.
   - Testes `app audience token never gets platform staff` e `removed platform role is 403 on the next call` (Task 3).
2. **Suporte agindo como admin da plataforma:**
   - O suporte não cria, não ativa, não suspende nem reativa (403 `admin_only`).
   - Nas funções do 5b, o suporte age como admin _da prefeitura_, nunca da plataforma.
   - Testes `support gets 403 admin_only on tenant writes` (Task 4) e `support can register a manager in support mode` (Task 3).
3. **Auditoria completa e sem dado pessoal:**
   - Toda rota que altera dados do `/panel` tem ação no mapa.
   - Gestor comum não gera auditoria.
   - `details` nunca traz CPF, telefone, e-mail ou texto digitado.
   - Testes `every non-GET panel route has an audit action`, `support assign writes one audit event without the body` e `manager actions write no staff audit` (Task 3).
4. **Criar prefeitura sem deixar pedaço:**
   - Uma recusa no meio da criação (`email_mismatch`, `tenant_exists`) não deixa prefeitura, contrato, conta ou categoria.
   - O catálogo copiado tem setores e categorias consistentes.
   - Testes `tenant creation rolls back on email mismatch` e `default catalog creates 3 departments and 9 categories` (Task 5).
5. **Prefeitura suspensa:**
   - Gestor, agente e equipe interna perdem o painel.
   - O cidadão não acha a prefeitura ao registrar.
   - Reativar devolve tudo.
   - Testes `suspended tenant blocks support mode and panel` e `suspended tenant disappears from citizen locate` (Task 4).

---

### Task 1: Contratos do backoffice no `shared`

**Files:**

- Create: `packages/shared/src/backoffice.ts`, `packages/shared/src/backoffice.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: `TENANT_STATUSES`, `PLATFORM_ROLES`, `cpfSchema`, `IconGroup`, `geoPointSchema` (se usado), `maskEmail`.
- Produces:
  - **Rótulos e constantes:**
    - `PLANS = ['essential', 'complete'] as const`, `PLAN_LABELS`;
    - `TENANT_STATUS_LABELS` (`onboarding` `Em implantação`, `active` `Ativa`, `suspended` `Suspensa`);
    - `PLATFORM_ROLE_LABELS` (`admin` `Admin`, `support` `Suporte`);
    - `STAFF_AUDIT_ACTIONS` (a lista da tabela das decisões) e `STAFF_AUDIT_ACTION_LABELS`;
    - `INCLUDED_USERS_MAX = 10000`.
  - **`DEFAULT_CATALOG`:** `readonly { name; icon; iconGroup; clusterRadiusM; defaultDeadlineDays; department: 'Obras' | 'Meio ambiente' | 'Serviços' }[]`, com as 9 categorias das decisões e os raios do seed.
  - **Respostas de leitura:**
    - `backofficeContextSchema = { user: { id, name }, platformRole: PlatformRole }`;
    - `platformOverviewSchema = { activeTenants, onboardingTenants, suspendedTenants, citizens, requestsThisMonth, requestsLastMonth, avgResolutionDays: number | null }`;
    - `tenantSummarySchema = { id, displayName, state, status: TenantStatus, plan: Plan | null, citizenCount, openCount, avgResolutionDays: number | null, lateReviewCount, staleImpedimentCount, activeCategoryCount }`;
    - `tenantListResponseSchema = { overview: PlatformOverview, items: TenantSummary[] }`;
    - `municipalityOptionSchema = { ibgeCode, name, state, taken: boolean }`;
    - `municipalitySearchResponseSchema = { items }`.
  - **Criar prefeitura:**
    - `tenantCreateBodySchema = { ibgeCode: /^\d{7}$/, displayName (2–120, trim), centralPhone: string | null (trim, até 20, vazio vira null), admin: { name (2–80), cpf: cpfSchema, email: z.email() em minúsculas }, contract: { plan: Plan, includedPanelUsers: int 1–10000, startsOn: z.iso.date(), endsOn: z.iso.date() | null }, copyDefaultCatalog: boolean }`;
    - o `.refine` exige `endsOn >= startsOn`, com o caminho `contract.endsOn`;
    - `tenantCreateResponseSchema = { id }`.
  - **Detalhe da prefeitura (`tenantDetailSchema`):**
    ```
    { id, displayName, state, ibgeCode, status, centralPhone: string | null,
      contract: { plan, includedPanelUsers, startsOn, endsOn: string | null } | null,
      stats: { citizenCount, openCount, staleTriageCount, awaitingReviewCount, lateReviewCount,
               avgResolutionDays: number | null, teamCount, activeAgentCount, invitedAgentCount,
               managerCount, adminCount, activeCategoryCount, panelUserCount },
      recentStaffActions: { action: string, staffName: string, at: datetime }[] }
    ```
  - **Mudar o status:** `tenantStatusBodySchema = { action: 'activate' | 'suspend' | 'reactivate' }`.
  - **Funções:**
    - `formatChange(current: number, previous: number): number | null`: variação em % arredondada; `null` quando `previous` é 0;
  - `meResponseSchema` já tem `platformRole`.

- [ ] **Step 1: Write the failing tests:**
  - `default catalog has 9 categories in 3 departments with the seed radii`;
  - `tenant create body lowercases the admin email, turns a blank central into null and rejects endsOn before startsOn`;
  - `formatChange rounds and returns null without a base`;
  - `every staff audit action has a label`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/shared test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/shared test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Contratos do backoffice: prefeituras, contrato, catálogo e auditoria`.

---

### Task 2: Banco: funções do backoffice, equipe interna nas funções do painel e seed

**Files:**

- Create: `packages/db/migrations/0024_*.sql` (SQL próprio), `packages/db/src/backoffice.test.ts`
- Modify: `packages/db/src/seed-dev-data.ts` (suporte demo e contrato), teste do seed, `packages/db/src/panel-people.test.ts` (a equipe interna como quem chama)

**Interfaces:**

- Consumes: `app_is_platform_staff()` e `app_is_platform_admin()`; o `statusSince` da atividade do 5b, que neste SQL é o evento mais recente da atividade com o status atual.
- Produces: as quatro funções das decisões (seção "Banco") e as funções do 5b aceitando a equipe interna. Exporta `SUPPORT_CPF` do seed.

- [ ] **Step 1: Write the failing tests** em `backoffice.test.ts`:
  - `só a equipe interna lê os agregados das prefeituras`;
  - `resumo por prefeitura conta cidadãos distintos, abertas e alertas de revisão e impedimento`;
  - `visão geral conta as solicitações do mês e do mês anterior no horário de Brasília`;
  - `tempo médio usa a publicação dos últimos 30 dias`;
  - `detalhe conta usuários do painel uma vez por pessoa`;
  - `admin da prefeitura é criado só pelo admin da plataforma`;
  - `admin da prefeitura com CPF existente mantém o e-mail`.

  Em `panel-people.test.ts`:
  - `suporte da plataforma cadastra agente e gestor sem vínculo na prefeitura`;
  - `quem não é do painel nem da equipe interna continua recusado`.

  No teste do seed: `seed cria a conta de suporte e o contrato da prefeitura demo`.

- [ ] **Step 2:** `pnpm --filter @alocidadao/db test` → FAIL.
- [ ] **Step 3:** Implementar. Nas funções do 5b, a checagem de quem chama passa a ser: equipe interna, ou vínculo ativo de gestor ou admin na prefeitura do contexto. As regras só do admin aceitam a equipe interna como admin.
- [ ] **Step 4:** `pnpm --filter @alocidadao/db test`, `pnpm --filter @alocidadao/api test` e `pnpm typecheck` → PASS. Rodar `pnpm db:migrate` e `pnpm db:seed:dev --reset` no banco local.
- [ ] **Step 5:** Commit: `Agregados do backoffice e equipe interna nas funções do painel`.

---

### Task 3: Equipe interna na API e modo suporte com auditoria

**Files:**

- Create: `apps/api/src/backoffice/staff.ts` (`requirePlatformStaff`), `apps/api/src/backoffice/routes.ts` (registro do escopo, contexto, entrar e sair), `apps/api/src/panel/audit.ts` (mapa de ações e gancho), `apps/api/src/backoffice/staff.test.ts`, `apps/api/src/panel/audit.test.ts`
- Modify: `apps/api/src/panel/member.ts` (equipe interna, `platformRole`, `panelDbContext`), todos os módulos de `apps/api/src/panel/*.ts` que chamam `withContext` (passam a usar `panelDbContext`), `apps/api/src/app.ts`, `apps/api/src/test/panel.ts` (ajudante para token de staff)

**Interfaces:**

- Consumes: `requireAuth`, `requireTenantMember`, `withContext`, os schemas da Task 1, as funções da Task 2.
- Produces:
  - `requirePlatformStaff(db, request, reply, roles?: readonly PlatformRole[]): Promise<{ userId; platformRole } | undefined>`.
  - `PanelIdentity` com `platformRole: PlatformRole | null` e `panelDbContext(identity): DbContext`.
  - `PANEL_AUDIT_ACTIONS: Record<string, StaffAuditAction>`, com a chave `'POST /panel/occurrences/:id/assign'` (método + `routeOptions.url`).
  - `registerPanelAudit(app, db)`, o gancho `onResponse` do escopo `/panel`.
  - **Rotas:**
    - `GET /backoffice/context` → `backofficeContextSchema`;
    - `POST /backoffice/tenants/:id/support/enter`: 204; 404 `tenant_not_found`; 409 `tenant_suspended`;
    - `POST /backoffice/tenants/:id/support/leave`: 204.
  - Ajudante de teste `staffAuthHeader(db, userId)`.

- [ ] **Step 1: Write the failing tests:**
  - `app audience token never gets platform staff`;
  - `removed platform role is 403 on the next call`;
  - `frozen staff account is 403`;
  - `support enters an onboarding tenant and sees the map`;
  - `support gets 403 not_a_member on a suspended tenant panel`;
  - `support can register a manager in support mode`;
  - `every non-GET panel route has an audit action`. O teste percorre as rotas registradas (`app.printRoutes` ou o gancho `onRoute`) e compara com o mapa;
  - `support assign writes one audit event without the body`;
  - `manager actions write no staff audit`;
  - `enter and leave write support.enter and support.leave`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `Equipe interna na API: modo suporte com auditoria`.

---

### Task 4: Prefeituras na API: lista, detalhe e status

**Files:**

- Create: `apps/api/src/backoffice/tenants.ts`, `apps/api/src/backoffice/tenants.test.ts`
- Modify: `apps/api/src/backoffice/routes.ts`

**Interfaces:**

- Consumes: `requirePlatformStaff`, as funções de agregado da Task 2, os schemas da Task 1.
- Produces:
  - `GET /backoffice/tenants` → `tenantListResponseSchema`, na ordem das decisões. O plano vem do contrato mais recente, com `starts_on` maior.
  - `GET /backoffice/tenants/:id` → `tenantDetailSchema`. Prefeitura inexistente: 404 `tenant_not_found`. As 5 ações mais recentes da auditoria são lidas com `tenantId` no contexto.
  - `POST /backoffice/tenants/:id/status` → 200 `{ status }`, só para o admin. Erros: 403 `admin_only`; 404 `tenant_not_found`; 409 `tenant_status_conflict`; 422 `tenant_not_ready`, na ativação sem categoria ativa ou sem equipe. Grava a auditoria.

- [ ] **Step 1: Write the failing tests:**
  - `tenant list orders active, onboarding and suspended and picks the first alert`;
  - `tenant detail brings stats, contract and the 5 latest staff actions`;
  - `support gets 403 admin_only on tenant writes`;
  - `activation needs an active category and a team`;
  - `suspend then reactivate writes two audit events`;
  - `suspended tenant blocks support mode and panel`;
  - `suspended tenant disappears from citizen locate`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `Prefeituras no backoffice: lista, detalhe, ativar e suspender`.

---

### Task 5: Nova prefeitura na API

**Files:**

- Create: `apps/api/src/backoffice/create-tenant.ts`, `apps/api/src/backoffice/create-tenant.test.ts`
- Modify: `apps/api/src/backoffice/routes.ts`, `apps/api/src/db-errors.ts` (constraint de `tenants.ibge_code`, se faltar)

**Interfaces:**

- Consumes:
  - `platform_find_or_create_tenant_admin` (Task 2);
  - `DEFAULT_CATALOG` e `tenantCreateBodySchema` (Task 1);
  - o padrão `Refusal` / `runOrRefuse` do 5b (`apps/api/src/panel/actions.ts`);
  - o mapeamento de 23505 por nome de constraint.
- Produces:
  - `GET /backoffice/municipalities?q=` → `municipalitySearchResponseSchema`, para admin e suporte:
    - `q` com até 7 dígitos busca o código por prefixo;
    - texto com pelo menos 2 letras busca o nome com `unaccent` e `ILIKE` (se a extensão `unaccent` não existir, comparar `lower()` e anotar);
    - até 10 resultados, por nome.
  - `POST /backoffice/tenants` → 201 `tenantCreateResponseSchema`, só para o admin, numa transação só:
    - 409 `tenant_exists`, `email_mismatch` (com `maskedEmail`), `email_in_use`, `cpf_unavailable` e `staff_account_not_allowed`;
    - 422 `municipality_not_found`.

- [ ] **Step 1: Write the failing tests:**
  - `municipality search by name ignores accents and marks taken ones`;
  - `municipality search by code prefix`;
  - `admin creates an onboarding tenant with boundary, contract and tenant admin`;
  - `default catalog creates 3 departments and 9 categories`;
  - `tenant without catalog has no categories`;
  - `tenant creation rolls back on email mismatch`;
  - `creating an existing municipality is 409 tenant_exists`;
  - `support gets 403 admin_only on tenant creation`;
  - `tenant creation writes tenant.create in the new tenant audit`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api test` e `pnpm --filter @alocidadao/api typecheck` → PASS.
- [ ] **Step 5:** Commit: `Nova prefeitura no backoffice`.

---

### Task 6: Cliente da API do backoffice

**Files:**

- Modify: `packages/api-client/src/index.ts`, `packages/api-client/src/index.test.ts`

**Interfaces:**

- Consumes: as rotas das Tasks 3 a 5.
- Produces:
  - `backofficeContext()`;
  - `backofficeTenants()`, `backofficeTenant(id)`, `backofficeSetTenantStatus(id, { action })`;
  - `backofficeMunicipalities(q)`, `backofficeCreateTenant(body)`;
  - `backofficeEnterSupport(id)`, `backofficeLeaveSupport(id)`.

  Sem cabeçalho `x-tenant-id`. As rotas do painel continuam usando o `x-tenant-id` da prefeitura do modo suporte.

- [ ] **Step 1: Write the failing tests:**
  - `backofficeCreateTenant posts the body and surfaces email_mismatch with maskedEmail`;
  - `backoffice calls send no tenant header`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/api-client test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm --filter @alocidadao/api-client test` e `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit: `Cliente da API do backoffice`.

---

### Task 7: Shell do backoffice e entrada da equipe interna

**Files:**

- Create:
  - `apps/web/src/backoffice/BackofficeLayout.tsx`;
  - `apps/web/src/backoffice/BackofficeSidebar.tsx` + `.module.css`;
  - `apps/web/src/backoffice/backoffice-menu.ts`;
  - `apps/web/src/backoffice/ComingSoon.tsx`;
  - os testes `BackofficeLayout.test.tsx`.
- Modify: `apps/web/src/App.tsx` (rotas `/backoffice/*` e o destino depois do login), `apps/web/src/auth/LoginPage.tsx` (destino), `apps/web/src/styles/tokens.css` (tokens do menu escuro)

**Interfaces:**

- Consumes: `backofficeContext()`, `me()` (`platformRole`), `panelLogout` (o mesmo `Sair` do painel), `PLATFORM_ROLE_LABELS`.
- Produces:
  - `BackofficeLayout`: busca o contexto. Em 403 `not_platform_staff`, volta para `/mapa`.
  - Rotas `/backoffice/prefeituras`, `/backoffice/prefeituras/nova`, `/backoffice/prefeituras/:id`, `/backoffice/interesse`, `/backoffice/equipe` e `/backoffice/auditoria`.
  - `/backoffice` redireciona para `/backoffice/prefeituras`.

- [ ] **Step 1: Write the failing tests:**
  - `staff lands on the backoffice after login and others on the map`;
  - `menu shows the four items and the role label`;
  - `non-staff opening the backoffice goes to the map`;
  - `coming soon pages show the item title and the text`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar, seguindo a seção 1 da spec do backoffice e as capturas.
- [ ] **Step 4:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/web typecheck` → PASS.
- [ ] **Step 5:** Commit: `Backoffice: menu e entrada da equipe interna`.

---

### Task 8: P1 Prefeituras

**Files:**

- Create: `apps/web/src/backoffice/tenants/TenantsPage.tsx`, `StatCard.tsx`, `TenantStatusBadge.tsx`, `tenant-alert.ts`, `*.module.css`, os testes

**Interfaces:**

- Consumes:
  - `backofficeTenants()`;
  - `DataTable` do 5b;
  - `TENANT_STATUS_LABELS`, `PLAN_LABELS`, `formatChange`;
  - os formatadores de número (`Intl.NumberFormat('pt-BR')`) e de dias (`4,2 dias`).
- Produces:
  - `StatCard({ label, value, help, tone?: 'warning' })`, usado na P3;
  - `TenantStatusBadge({ status })`;
  - `tenantAlert(summary): { tone: 'warning' | 'info'; text: string } | null`.

- [ ] **Step 1: Write the failing tests:**
  - `subtitle and cards use the singular and hide empty parts`;
  - `month change shows plus, minus or no comparison with the previous month name`;
  - `alert picks review, then impediment, then categories`;
  - `table orders by status group and opens the detail`;
  - `new tenant button only for the admin`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar, seguindo `P1-prefeituras.png`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/web typecheck` → PASS.
- [ ] **Step 5:** Commit: `Backoffice: lista de prefeituras`.

---

### Task 9: P2 Nova prefeitura

**Files:**

- Create: `apps/web/src/backoffice/tenants/NewTenantPage.tsx`, `MunicipalitySearch.tsx`, `*.module.css`, os testes

**Interfaces:**

- Consumes: `backofficeMunicipalities(q)`, `backofficeCreateTenant(body)`; `formatCpf`, `maskEmail`; `PLANS` e `PLAN_LABELS`; o `Toast` do painel.
- Produces: `MunicipalitySearch({ value, onChange })`, com combobox acessível (`role="combobox"`, lista `role="listbox"`), espera de 300 ms antes de buscar e os municípios já cadastrados desabilitados.

- [ ] **Step 1: Write the failing tests:**
  - `choosing a municipality fills the display name and shows the IBGE notice`;
  - `taken municipalities are disabled`;
  - `create sends the body and opens the new tenant with the notice`;
  - `server errors land on the right fields`;
  - `cancel goes back to the list`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar, seguindo `P2-nova-prefeitura.png`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/web typecheck` → PASS.
- [ ] **Step 5:** Commit: `Backoffice: nova prefeitura`.

---

### Task 10: P3 Visão geral e P4 modo suporte

**Files:**

- Create:
  - `apps/web/src/backoffice/tenants/TenantDetailPage.tsx`, `TenantStatusActions.tsx`, `*.module.css`;
  - `apps/web/src/session/support-tenant.ts` (ler, gravar e apagar `ac_support_tenant`);
  - `apps/web/src/shell/SupportBanner.tsx` + `.module.css`;
  - os testes.
- Modify: `apps/web/src/shell/PanelLayout.tsx` (prefeitura do modo suporte, faixa, altura), `apps/web/src/shell/Sidebar.tsx` (usuário `Equipe Alô Cidadão`, sem `Sair`), `apps/web/src/shell/use-panel.ts` (`support: { tenantId; displayName } | null`)

**Interfaces:**

- Consumes:
  - `backofficeTenant(id)`, `backofficeSetTenantStatus`, `backofficeEnterSupport`, `backofficeLeaveSupport`;
  - `StatCard` e `TenantStatusBadge` (Task 8);
  - `ConfirmDialog` do 5b; `STAFF_AUDIT_ACTION_LABELS`; `formatLastActive` do 5b (para `hoje, 10:02`).
- Produces: `getSupportTenant(): { tenantId; displayName } | null`, `setSupportTenant(value)` e `clearSupportTenant()`.

- [ ] **Step 1: Write the failing tests:**
  - `detail shows stats, people, contract and recent actions with labels`;
  - `review card turns warning only with late reviews`;
  - `activate asks for confirmation and shows tenant_not_ready`;
  - `suspend asks for confirmation; reactivate does not`;
  - `support role sees no status actions`;
  - `enter support stores the tenant and opens the map with the banner`;
  - `manage teams enters support on the teams page`;
  - `leaving support clears the tenant and returns to the detail`;
  - `reload keeps support mode from session storage`.
- [ ] **Step 2:** `pnpm --filter @alocidadao/web test` → FAIL.
- [ ] **Step 3:** Implementar, seguindo `P3-detalhe-da-prefeitura.png` e `P4-painel-em-modo-suporte.png`.
- [ ] **Step 4:** `pnpm --filter @alocidadao/web test` e `pnpm --filter @alocidadao/web typecheck` → PASS.
- [ ] **Step 5:** Commit: `Backoffice: detalhe da prefeitura e modo suporte`.

---

### Task 11: Documentação, pendências e passada final no navegador

**Files:**

- Modify:
  - `docs/decisoes/0001-isolamento-por-prefeitura.md`: a equipe interna no painel, os agregados por função e o papel interno nunca para token do app;
  - `docs/design-system.md`: menu escuro, cartão de indicador, faixa do modo suporte;
  - `apps/web/README.md`: como entrar como admin e como suporte da plataforma;
  - `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`: itens do 6a `[x]`, uma seção "Plano 6b" com o que ficou e a lista de textos criados sem Pencil nesta parte;
  - este plano: seção "Resultado no navegador".
- Create: capturas em `docs/superpowers/plans/resultado-backoffice-6a/`.

- [x] **Step 1:** Subir o banco (`pnpm infra:up`), `pnpm db:migrate`, `pnpm db:seed:dev --reset`, a API e o web.
- [x] **Step 2:** Passada no navegador (Playwright MCP, 1440x900). Uma captura de cada tela e estado, e a lista do que não foi exercitado:
  - entrada do admin e do suporte;
  - P1;
  - P2 com busca e criação;
  - P3 em implantação, ativa e suspensa;
  - ativar, suspender e reativar;
  - entrar no modo suporte, agir e sair;
  - a ação aparecendo em "Últimas ações".
- [x] **Step 3:** Corrigir o que a passada achar, com teste quando for lógica.
- [x] **Step 4:** Atualizar as pendências e a documentação.
- [x] **Step 5:** `pnpm test`, `pnpm lint`, `pnpm format:check` → PASS. Commit: `Backoffice 6a: documentação, pendências e passada no navegador`.

## Resultado no navegador

26/10/2026, Playwright (Chromium) em 1440x900, com o código fixo de desenvolvimento `123456`. Depois de `pnpm infra:up` e `pnpm db:migrate`, `pnpm db:seed:dev --reset` rodou antes da passada e de novo no fim (o `--reset` não apaga a "Prefeitura de São José" criada na passada; ela continua no banco de desenvolvimento). Capturas em `docs/superpowers/plans/resultado-backoffice-6a/`.

**API e web desta passada.** A porta 3333 tinha uma API antiga deste checkout (iniciada às 19:41, antes do último commit do modo suporte), que não dava para garantir como atual. Foi iniciada uma API própria na porta 3334 (`PORT=3334 pnpm exec tsx src/server.ts`, em `apps/api`) e o web na 5173 apontando para ela com `API_PROXY_TARGET=http://localhost:3334` (variável nova em `vite.config.ts`, com padrão `http://localhost:3333`). A API antiga da 3333 não foi tocada. Os processos próprios foram parados no fim. O Docker caiu no meio da passada e foi religado (`open -a Docker`, `pnpm infra:up`, `db:migrate`, `db:seed:dev --reset`).

Conferência com o Pencil: feita a olho, só em textos, ordem e estrutura das telas; não houve comparação lado a lado com as capturas do Pencil nem medida de pixels.

| Passo                                     | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada do admin (CPF 11144477735)        | OK (`01`): vai para `/backoffice/prefeituras`; menu escuro com os 4 itens, `Admin Demo` e `Admin · Alô Cidadão`, `Sair`, `Nova prefeitura`. `01` foi tirada antes do ajuste da coluna `Abrir` (ver "Problemas").                                                                                                                                                                                                                                   |
| Entrada do suporte (CPF 86288366757)      | OK (`22`, `23`): vai para o backoffice com `Suporte Demo` e `Suporte · Alô Cidadão`, sem `Nova prefeitura`; abrir `/backoffice/prefeituras/nova` volta para a P1.                                                                                                                                                                                                                                                                                  |
| Gestora (Rita Demo, 39053344705)          | OK, sem captura: entra em `/mapa`; abrir `/backoffice/prefeituras` volta para `/mapa`.                                                                                                                                                                                                                                                                                                                                                             |
| P1 com uma prefeitura                     | OK (`01`): `1 prefeitura · 1 ativa`; indicadores `1`, `5`, `217` (`sem comparação com setembro`), `1,1 dias`; linha da Demo com `Completo`, `5`, `12`, `1,1 dias` e `1 aguardando revisão há +1 dia`.                                                                                                                                                                                                                                              |
| P1 com duas prefeituras                   | OK (`18`, `22`): `2 prefeituras · 2 ativas`; a nova (`Essencial`, `0`, `0`, `—`, `—`) e a Demo.                                                                                                                                                                                                                                                                                                                                                    |
| P2 vazia e validação do cliente           | OK (`02`, `03`): formulário com os campos do Pencil; ao enviar vazio, `Preencha este campo.` no município, no nome de exibição, no nome, no CPF, no e-mail e no início da vigência.                                                                                                                                                                                                                                                                |
| P2 busca de município                     | OK (`04`): `sao jose` (sem acento) lista 10 resultados no formato `São José — SC · 4216602`.                                                                                                                                                                                                                                                                                                                                                       |
| P2 município escolhido                    | OK (`05`): aviso verde `Limite do município importado do IBGE`, `Prefeitura de São José` e `156` preenchidos.                                                                                                                                                                                                                                                                                                                                      |
| P2 erro `email_mismatch`                  | OK (`06`): CPF de Carlos Demo com outro e-mail mostra `Este CPF já tem outro e-mail cadastrado: g•••@alocidadao.dev.` no campo de e-mail.                                                                                                                                                                                                                                                                                                          |
| P2 criar                                  | OK (`07`): com um CPF novo (12345678909), criou a prefeitura e abriu a P3 `Prefeitura de São José`, `Em implantação`, `SC · IBGE 4216602 · cliente desde 01/11/2026 · plano Essencial`, `9 ativas` categorias (catálogo marcado), `1 admin`, `1 de 50 incluídos`, `156` e `Criou a prefeitura` nas últimas ações. O aviso `Prefeitura criada. Ela está em implantação.` não foi capturado (sumiu antes da captura); só o teste de unidade o cobre. |
| P3 em implantação                         | OK (`07`): `Ativar prefeitura` e `Entrar no painel da prefeitura`.                                                                                                                                                                                                                                                                                                                                                                                 |
| Ativar sem equipe                         | OK (`08`, `09`): o diálogo abre e, ao confirmar, o aviso `Antes de ativar, cadastre ao menos uma categoria ativa e uma equipe.` (422 `tenant_not_ready`); a prefeitura continua em implantação.                                                                                                                                                                                                                                                    |
| Entrar no modo suporte (admin)            | OK (`10`): `Entrar no painel da prefeitura` abre `/mapa` com a faixa `Você está na Prefeitura de São José como equipe Alô Cidadão · …` e `Sair da prefeitura`; caixa do usuário `Admin Demo` · `Equipe Alô Cidadão`, sem `Sair`; o mapa abre em São José. Recarregar em `/equipes` manteve o modo suporte.                                                                                                                                         |
| Agir no modo suporte (admin)              | OK (`11`): em `Equipes e agentes`, a lista de setores tem `Meio ambiente`, `Obras` e `Serviços` (catálogo copiado); `Nova equipe` com `Equipe Obras SJ` no setor `Obras` salvou e abriu a equipe.                                                                                                                                                                                                                                                  |
| Sair do modo suporte                      | OK (`12`): `Sair da prefeitura` volta à P3 da prefeitura e apaga `ac_support_tenant` do `sessionStorage` (conferido por script); `Equipes` passou de 0 para 1.                                                                                                                                                                                                                                                                                     |
| Ação na auditoria ("Últimas ações")       | OK (`12`, `14`, `16`, `17`, `26`): `Entrou no painel (suporte)`, `Criou uma equipe`, `Saiu do painel`, `Ativou a prefeitura`, `Suspendeu a prefeitura` e `Reativou a prefeitura` com `Admin Demo · hoje, 20:0x`; a do suporte aparece como `Suporte Demo` (`Publicou um atendimento`).                                                                                                                                                             |
| Ativar (com equipe)                       | OK (`13`, `14`): diálogo `Ativar Prefeitura de São José?` com o texto das decisões e `Cancelar`/`Ativar`; depois, selo `Ativa`, `Suspender` e o aviso `Prefeitura ativada.`.                                                                                                                                                                                                                                                                       |
| Suspender                                 | OK (`15`, `16`): diálogo aberto e confirmado; selo `Suspensa`, `Reativar` no lugar de `Suspender`, `Entrar no painel da prefeitura` desabilitado com `Reative a prefeitura para entrar no painel.`, botões `Gerenciar` apagados, aviso `Prefeitura suspensa.`. O diálogo `Suspender Prefeitura de São José?` mostra o texto das decisões, `Cancelar` e `Suspender` em `danger`.                                                                    |
| Reativar                                  | OK (`17`): sem confirmação, volta a `Ativa` com `Prefeitura reativada.`.                                                                                                                                                                                                                                                                                                                                                                           |
| P3 de prefeitura ativa com dados (Demo A) | OK (`19`, `24`): `5` cidadãos, `12` abertas (`1 abertas há +3 dias`), cartão `Aguardando revisão` com borda `warning` (`2`, `1 há mais de 1 dia`), `1,1 dias`; `3` equipes, `1 ativo · 1 convidado`, `1 · 1 admin`, `9 ativas`; contrato `Completo`, `01/11/2026 a 31/10/2027`, `4 de 50 incluídos`, central `—`.                                                                                                                                  |
| `Gerenciar` categorias                    | OK (`20`): entra no modo suporte e abre `/categorias`.                                                                                                                                                                                                                                                                                                                                                                                             |
| P3 do suporte                             | OK (`24`): só `Entrar no painel da prefeitura`; sem `Ativar`, `Suspender` ou `Reativar`.                                                                                                                                                                                                                                                                                                                                                           |
| Suporte entra, age e sai                  | OK (`25`, `26`): entrou na Demo A, publicou um atendimento em `/revisao` (cartão e fila 2 para 1), saiu; as últimas ações mostram `Entrou no painel (suporte)`, `Publicou um atendimento` e `Saiu do painel` por `Suporte Demo`, e os indicadores mudaram (revisão `1`, tempo médio `1,2 dias`).                                                                                                                                                   |
| Página provisória                         | OK (`21`): `Equipe Alô Cidadão` abre a página provisória com o título do item.                                                                                                                                                                                                                                                                                                                                                                     |

Problemas achados e corrigidos:

- **Botão `Abrir` quebrado em letras na P1** (`A`/`br`/`ir`): a coluna de ação tinha 70 de largura; agora tem 104, o botão tem `white-space: nowrap` e a coluna de alertas passou de 210 para 250 (para `1 aguardando revisão há +1 dia` caber numa linha) e a de status de 140 para 120. Só CSS e largura, sem teste de unidade; conferido no navegador (`18`, `22`, `23`).
- **Teste flutuante do 5b** (`ReviewPage.test.tsx`, `review queue opens the first item…`): falhou uma vez na suíte inteira em paralelo (a URL com `?atividade=` aparece depois do título) e passou sozinho; a espera da URL agora usa `waitFor`.
- **`API_PROXY_TARGET`** em `apps/web/vite.config.ts` para o web apontar para outra porta da API (padrão igual ao anterior); documentado em `apps/web/README.md`.

O que chamou atenção e não foi mudado:

- No modo suporte, ao publicar na revisão, o console mostra um 404 de `GET /panel/reviews/{id}` (o detalhe da atividade já publicada é recarregado). Sem efeito na tela; vem do 5b.
- Na P2, o rótulo `Central de atendimento` quebra em duas linhas e desalinha o campo `156` em relação ao `Nome de exibição` (`06`).
- O console do navegador também mostra os 409/422 das chamadas que o fluxo provocou de propósito (`email_mismatch`, `tenant_not_ready`).

Não executado no navegador (só os testes da API e do web cobrem):

- P2: resultado `já cadastrado` desabilitado e o erro `tenant_exists` (a Demo usa o IBGE de teste `9999901`, que não está na busca); `municipality_not_found`; `email_in_use` e `cpf_unavailable`; o erro `O fim da vigência não pode ser antes do início.`; catálogo desmarcado (prefeitura sem setores nem categorias); `Cancelar` e a seta de voltar; navegação do resultado da busca pelo teclado; CPF, e-mail e quantidade inválidos (`CPF inválido.`, `E-mail inválido.`, `Informe de 1 a 10000.`); falha da busca (`Não foi possível buscar os municípios.`) e `Confira os dados e tente de novo.`.
- P1: prefeitura suspensa na tabela e o apoio com suspensas; alertas `impedimentos parados` e `Sem categorias configuradas`; variação `+12%`/`-5%`; estado vazio e erro de carga.
- P3: `tenant_status_conflict` (aviso `A situação da prefeitura mudou. Atualizamos a tela.`); `Gerenciar` de equipes, agentes e gestores (só `categorias` foi clicado); `Entrar` com a prefeitura suspensa pela API (`tenant_suspended`) e o `Gerenciar` desabilitado foi só visto, não clicado; as caixas de contrato sem fim de vigência e sem central na prefeitura nova (a nova tem `desde 01/11/2026` e `156`; a Demo tem `—`); indicador de tempo médio com dado só na Demo.
- API do suporte recebendo 403 `admin_only` ao ativar, suspender, reativar ou criar (a tela só esconde os botões); `403 not_a_member` do suporte numa prefeitura suspensa pelo painel.
- Modo suporte: fechar a aba sem sair (sem `support.leave`); falha de `support/leave` ignorada; outras ações auditadas além de `team.create` e `work_order.publish`; a faixa do suporte em outras páginas do painel além de `/mapa`, `/equipes`, `/revisao` e `/categorias`.
- Menu: as páginas provisórias `Interesse por cidade` e `Auditoria` (só `Equipe Alô Cidadão` foi aberta).
- Conferência de pixels contra o Pencil (cores, espaçamentos) e telas em largura menor que 1440.
