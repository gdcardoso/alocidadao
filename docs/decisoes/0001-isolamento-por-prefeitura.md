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
   - Login (sem senha): `auth_find_user_by_phone(phone)` e `auth_find_user_by_cpf(cpf)` são `SECURITY DEFINER`, só acham contas `active` e devolvem só o necessário para seguir o login.
   - `tenant_contracts`: a equipe interna lê; só o admin cria e altera.
   - `staff_audit_events`: a prefeitura do contexto lê o que a equipe interna fez nela; só a equipe grava, em nome próprio (`staff_user_id = app_current_user()`), e só inserção.
   - `city_interest`: cada cidadão registra e vê o próprio interesse; a equipe interna vê todos.
   - `municipality_leads`: só a equipe interna lê e grava.
6. **Regras que o banco garante.**
   - Histórico (`status_events`), ações do aparelho (`client_actions`) e auditoria da equipe interna (`staff_audit_events`) só aceitam inserção.
   - No máximo uma atividade ativa por ocorrência (qualquer status menos `completed` e `cancelled`).
   - Um telefone tem no máximo uma conta `active` (número reaproveitado: a conta antiga é congelada).
   - Protocolo sequencial por prefeitura e ano (`2026-000001`), gerado por `next_request_protocol()` no `DEFAULT` da coluna.

## Como é provado

`packages/db/src/rls.test.ts` cria duas prefeituras e roda as consultas como `app_user`, a mesma conexão da API. Os testes falham se qualquer leitura, alteração, exclusão ou referência cruzada passar. As políticas da equipe interna e das tabelas da plataforma são provadas em `packages/db/src/platform.test.ts`.

## Consequências

- Toda consulta da API precisa passar por `withContext`. Fora dele, `app_user` não vê dado nenhum de prefeitura, então o erro aparece logo em desenvolvimento.
- `app.platform_role` é definido pela API depois de conferir `users.platform_role` no banco. Ele protege contra erro de código, não contra uma API comprometida.
- Suporte enxerga e atende contas, mas não cria nem altera prefeitura ou contrato; isso é do admin. Toda ação da equipe interna dentro de uma prefeitura deixa registro em `staff_audit_events`, que a prefeitura lê e ninguém altera.
- A equipe interna opera dentro de uma prefeitura definindo o `tenantId` dela no contexto; não existe papel que ignore o RLS na API.
- Migrações rodam sempre com o dono do banco (`DATABASE_OWNER_URL`); a API nunca tem permissão de DDL.
