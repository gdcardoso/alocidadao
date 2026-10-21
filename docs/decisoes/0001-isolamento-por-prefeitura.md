# 0001 — Isolamento por prefeitura no banco (RLS)

**Status:** aceita · 21/10/2026

## Decisão

O isolamento entre prefeituras é garantido pelo PostgreSQL, não só pela API. Mesmo uma consulta que esqueça o filtro de prefeitura devolve apenas os dados da prefeitura do contexto.

## Como funciona

1. **Dois papéis no banco.** O dono (`alocidadao`) roda as migrações. A API conecta como `app_user`, que não é superusuário nem tem `BYPASSRLS`, então as políticas sempre se aplicam a ele.
2. **Contexto por transação.** A API abre toda operação com `withContext(db, { tenantId, userId, platformAdmin }, fn)` (`packages/db/src/client.ts`). O helper grava `app.tenant_id`, `app.user_id` e `app.platform_admin` com `set_config(..., true)`, que vale só até o fim da transação; a conexão volta limpa para o pool.
3. **Políticas.** As tabelas da prefeitura (`memberships`, `departments`, `department_managers`, `teams`, `team_members`, `categories`, `request_counters`, `requests`, `work_orders`, `status_events`) têm `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política `tenant_id = app_current_tenant()` para leitura e escrita. Sem contexto, `app_current_tenant()` é `NULL` e nada é liberado.
4. **FK composta.** Toda tabela da prefeitura tem `UNIQUE (tenant_id, id)`, e as referências entre elas usam `(tenant_id, x_id)`. Um registro não aponta para outro de prefeitura diferente, mesmo conhecendo o id.
5. **Tabelas globais.**
   - `tenants`: leitura livre (o cidadão escolhe a prefeitura); criar e alterar só com `app.platform_admin = on`.
   - `users`: cada um vê a si mesmo e quem tem vínculo com a prefeitura do contexto. A coluna `is_platform_admin` fica fora dos grants de `INSERT`/`UPDATE`, então a API não consegue promover ninguém.
   - Login: `auth_find_user_by_email(email)` é `SECURITY DEFINER` e devolve só id, hash da senha e se é admin da plataforma.
6. **Regras que o banco garante.**
   - Histórico (`status_events`) só aceita inserção.
   - No máximo uma atividade ativa (`assigned` ou `in_execution`) por solicitação.
   - Protocolo sequencial por prefeitura e ano (`2026-000001`), gerado por `next_request_protocol()` no `DEFAULT` da coluna.

## Como é provado

`packages/db/src/rls.test.ts` cria duas prefeituras e roda as consultas como `app_user`, a mesma conexão da API. Os testes falham se qualquer leitura, alteração, exclusão ou referência cruzada passar.

## Consequências

- Toda consulta da API precisa passar por `withContext`. Fora dele, `app_user` não vê dado nenhum de prefeitura, então o erro aparece logo em desenvolvimento.
- `app.platform_admin` é definido pela API depois de conferir `users.is_platform_admin` no banco. Ele protege contra erro de código, não contra uma API comprometida.
- O admin da plataforma opera dentro de uma prefeitura definindo o `tenantId` dela no contexto; não existe papel que ignore o RLS na API.
- Migrações rodam sempre com o dono do banco (`DATABASE_OWNER_URL`); a API nunca tem permissão de DDL.
