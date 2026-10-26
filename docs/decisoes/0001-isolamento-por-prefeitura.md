# 0001 — Isolamento por prefeitura no banco (RLS)

**Status:** aceita · 21/10/2026

## Decisão

O isolamento entre prefeituras é garantido pelo PostgreSQL, não só pela API. Mesmo uma consulta que esqueça o filtro de prefeitura devolve apenas os dados da prefeitura do contexto.

## Como funciona

1. **Dois papéis no banco.** O dono (`alocidadao`) roda as migrações. A API conecta como `app_user`, que não é superusuário nem tem `BYPASSRLS`, então as políticas sempre se aplicam a ele.
2. **Contexto por transação.** A API abre toda operação com `withContext(db, { tenantId, userId, platformRole }, fn)` (`packages/db/src/client.ts`). O helper grava `app.tenant_id`, `app.user_id` e `app.platform_role` (`admin`, `support` ou vazio) com `set_config(..., true)`, que vale só até o fim da transação; a conexão volta limpa para o pool. `app_is_platform_admin()` é o papel `admin`; `app_is_platform_staff()` é `admin` ou `support` (a equipe interna).
3. **Políticas.** As tabelas da prefeitura (`memberships`, `departments`, `department_managers`, `teams`, `team_members`, `categories`, `request_counters`, `occurrences`, `requests`, `work_orders`, `status_events`, `photos`, `client_actions`) têm `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política `tenant_id = app_current_tenant()` para leitura e escrita. Sem contexto, `app_current_tenant()` é `NULL` e nada é liberado.
4. **FK composta.** Toda tabela da prefeitura tem `UNIQUE (tenant_id, id)`, e as referências entre elas usam `(tenant_id, x_id)`. Um registro não aponta para outro de prefeitura diferente, mesmo conhecendo o id.
5. **Tabelas globais.**
   - `tenants`: leitura livre (o cidadão escolhe a prefeitura); criar e alterar só o admin.
   - `users`: cada um vê a si mesmo; a equipe interna vê todos; os demais, só quem tem vínculo com a prefeitura do contexto. `platform_role` e `account_status` ficam fora dos grants de `INSERT`/`UPDATE`, então a API não dá papel interno a ninguém nem congela conta por `UPDATE` direto.
   - `users` (escrita): cada um altera só a própria conta, inclusive a equipe interna (ver "Acesso"). O `INSERT` não precisa de filtro de papel: `platform_role` está fora do grant, então conta nova nunca nasce com papel.
   - Login (sem senha): funções `SECURITY DEFINER` que só acham contas `active` e devolvem só o necessário para seguir o login (ver "Acesso").
   - `tenant_contracts`: a equipe interna lê; só o admin cria e altera.
   - `staff_audit_events`: a prefeitura do contexto lê o que a equipe interna fez nela; só a equipe grava, em nome próprio (`staff_user_id = app_current_user()`), e só inserção.
   - `city_interest`: cada cidadão registra e vê o próprio interesse; a equipe interna vê todos.
   - `municipality_leads`: só a equipe interna lê e grava.
6. **Regras que o banco garante.**
   - Histórico (`status_events`), ações do aparelho (`client_actions`) e auditoria da equipe interna (`staff_audit_events`) só aceitam inserção.
   - No máximo uma atividade ativa por ocorrência (qualquer status menos `completed` e `cancelled`).
   - Um telefone tem no máximo uma conta `active` (número reaproveitado: a conta antiga é congelada).
   - Protocolo sequencial por prefeitura e ano (`2026-000001`), gerado por `next_request_protocol()` no `DEFAULT` da coluna.

## Acesso

Acesso sem senha (Plano 2). Migrações `auth_functions` (0013) e `account_functions` (0014).

1. **Funções de login e de conta.** Todas são `SECURITY DEFINER`, com `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` e `GRANT EXECUTE ... TO app_user`.
   - Login, sem contexto de usuário: `auth_issue_code` e `auth_consume_code` (códigos de verificação; `app_user` não lê nem grava `verification_codes`), `auth_find_user_by_phone(phone, installation_id)`, `auth_find_user_by_cpf(cpf)` e `auth_session_for_refresh(token_hash)`. Só acham contas `active` e não excluídas.
   - Conta, sobre `app_current_user()` e recusando a chamada sem usuário no contexto: `account_change_phone(phone)`, `account_delete()` e `account_activate_invitations()`. Nenhuma recebe id de usuário.
   - `auth_freeze_stale_account(user_id, phone)` é a exceção: recebe o id da conta antiga, mas só a congela se ela ainda está ativa com aquele telefone e parada há 90 dias, e exige no contexto outra conta, diferente da antiga (a nova, no cadastro, ou a que está trocando de número).
   - Excluir conta não apaga a linha: ela fica `frozen`, com `deleted_at` e sem nome, telefone, e-mail e CPF. As sessões são revogadas, os aparelhos apagados e os vínculos desativados; as solicitações continuam com a prefeitura.
2. **Escrita em `users` só na própria conta.** A política `users_update` é `id = app_current_user()` para todos, inclusive suporte e admin; isso substitui a regra da 0011. O `UPDATE` direto cobre só `name`, `email`, `last_active_at`, `terms_version` e `terms_accepted_at`. Telefone muda só por `account_change_phone`, depois de a API conferir o código; CPF não muda por enquanto. O cadastro pelo gestor e as correções do suporte terão funções próprias.
3. **O dono precisa de `BYPASSRLS`** (ou ser superusuário). As funções `SECURITY DEFINER` rodam como o dono, e com `FORCE ROW LEVEL SECURITY` tabelas como `memberships`, `sessions`, `devices` e `verification_codes` não têm política para ele. No desenvolvimento o dono é superusuário; em produção, o papel dono precisa de `BYPASSRLS`.
4. **O token de acesso não consulta o banco.** É um JWT de 15 min: ao sair, ele ainda vale até vencer. Vínculo desativado, conta congelada e conta excluída são conferidos no banco a cada rota que monta contexto, então nesses casos o efeito é imediato. O token de renovação só deixa de valer ao sair, ao congelar ou ao excluir a conta.

## Como é provado

`packages/db/src/rls.test.ts` cria duas prefeituras e roda as consultas como `app_user`, a mesma conexão da API. Os testes falham se qualquer leitura, alteração, exclusão ou referência cruzada passar. As políticas da equipe interna e das tabelas da plataforma são provadas em `packages/db/src/platform.test.ts`; as de acesso e de conta, em `packages/db/src/auth.test.ts` e `packages/db/src/account.test.ts`.

## Consequências

- Toda consulta da API precisa passar por `withContext`. Fora dele, `app_user` não vê dado nenhum de prefeitura, então o erro aparece logo em desenvolvimento.
- `app.platform_role` é definido pela API depois de conferir `users.platform_role` no banco. Ele protege contra erro de código, não contra uma API comprometida.
- Suporte enxerga contas, mas não as altera por `UPDATE` direto, nem cria ou altera prefeitura ou contrato; prefeitura e contrato são do admin. Toda ação da equipe interna dentro de uma prefeitura deixa registro em `staff_audit_events`, que a prefeitura lê e ninguém altera.
- A equipe interna opera dentro de uma prefeitura definindo o `tenantId` dela no contexto; não existe papel que ignore o RLS na API.
- **A equipe interna no painel (Plano 6a).** Admin e suporte entram em qualquer prefeitura em implantação ou ativa pelo modo suporte, sem vínculo. `requirePanelMember` confere `users.platform_role` no banco e devolve `role: 'tenant_admin'` com `platformRole`; o contexto do painel (`panelDbContext`) carrega `{ tenantId, userId, platformRole }`, e o RLS segue valendo para a prefeitura escolhida. Prefeitura suspensa recusa a equipe interna (403 `not_a_member`), como recusa o gestor. Quem é da equipe e também gestor segue sempre o caminho da equipe, e as ações aparecem na auditoria como suporte.
- **Papel interno nunca para token do app.** `app.platform_role` só é gravado depois de `requirePlatformStaff` ou `requirePanelMember` conferirem o papel no banco, e só para token de audiência `panel`. Token `app` nunca recebe papel interno, mesmo de conta que tem `platform_role`.
- **Leitura entre prefeituras só por agregados.** As telas do backoffice leem de funções `SECURITY DEFINER` que exigem `app_is_platform_staff()` e devolvem só contagens e médias (`platform_tenant_summaries`, `platform_overview`, `platform_tenant_detail`; migração `0024`). A equipe interna não ganha `SELECT` nas tabelas das prefeituras. O admin da prefeitura nova nasce por `platform_find_or_create_tenant_admin`, só para `app_is_platform_admin()`.
- **Auditoria do modo suporte.** Entrar, sair e cada chamada não-GET do `/panel` bem-sucedida gravam `staff_audit_events`, com `details` só com a rota (`{ route }`), nunca o corpo, para nenhum dado pessoal ir para a auditoria.
- Migrações rodam sempre com o dono do banco (`DATABASE_OWNER_URL`); a API nunca tem permissão de DDL.
