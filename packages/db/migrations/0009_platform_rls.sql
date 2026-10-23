-- Papéis da equipe interna, contas sem senha e as tabelas da plataforma
-- (ver docs/decisoes/0001-isolamento-por-prefeitura.md).

-- ── Contexto: o papel interno substitui app.platform_admin ──

-- 'admin', 'support' ou NULL. A API grava depois de conferir users.platform_role no banco.
CREATE FUNCTION app_current_platform_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.platform_role', true), '') $$;
--> statement-breakpoint
-- Mesmo nome e assinatura: as políticas de tenants continuam valendo sem mudar o texto.
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_current_platform_role() = 'admin', false) $$;
--> statement-breakpoint
CREATE FUNCTION app_is_platform_staff() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_current_platform_role() IN ('admin', 'support'), false) $$;
--> statement-breakpoint

-- ── users: a equipe interna (admin e suporte) enxerga e atende qualquer conta ──

DROP POLICY users_select ON users;
--> statement-breakpoint
DROP POLICY users_insert ON users;
--> statement-breakpoint
DROP POLICY users_update ON users;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT TO app_user
  USING (
    id = app_current_user()
    OR app_is_platform_staff()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()
    )
  );
--> statement-breakpoint
-- Cadastro: a API gera o id e o define como app.user_id antes de inserir.
CREATE POLICY users_insert ON users FOR INSERT TO app_user
  WITH CHECK (id = app_current_user() OR app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO app_user
  USING (id = app_current_user() OR app_is_platform_staff())
  WITH CHECK (id = app_current_user() OR app_is_platform_staff());
--> statement-breakpoint
-- platform_role e account_status ficam fora dos grants de coluna: a API não dá papel interno
-- a ninguém nem congela conta por UPDATE direto. REVOKE na tabela também tira os grants de coluna.
REVOKE INSERT, UPDATE ON users FROM app_user;
--> statement-breakpoint
GRANT INSERT (id, name, email, phone, cpf) ON users TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, email, phone, cpf, last_active_at) ON users TO app_user;
--> statement-breakpoint

-- ── Login sem contexto: SECURITY DEFINER roda como o dono e devolve só o necessário ──

CREATE FUNCTION auth_find_user_by_phone(p_phone text)
  RETURNS TABLE (id uuid, last_active_at timestamptz, has_email boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.last_active_at, u.email IS NOT NULL
    FROM users u
    WHERE u.phone = p_phone AND u.account_status = 'active'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_phone(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO app_user;
--> statement-breakpoint
CREATE FUNCTION auth_find_user_by_cpf(p_cpf text)
  RETURNS TABLE (id uuid, email text, platform_role text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.email, u.platform_role::text
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_cpf(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_cpf(text) TO app_user;
--> statement-breakpoint

-- ── tenant_contracts: a equipe interna lê; só o admin cria e altera ──

ALTER TABLE tenant_contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_contracts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_contracts_select ON tenant_contracts FOR SELECT TO app_user
  USING (app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY tenant_contracts_insert ON tenant_contracts FOR INSERT TO app_user
  WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
CREATE POLICY tenant_contracts_update ON tenant_contracts FOR UPDATE TO app_user
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_contracts TO app_user;
--> statement-breakpoint

-- ── staff_audit_events: a prefeitura lê o que a equipe interna fez nela; só inserção ──

ALTER TABLE staff_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff_audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_audit_events_select ON staff_audit_events FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Grava só quem é da equipe, em nome próprio, na prefeitura do contexto.
CREATE POLICY staff_audit_events_insert ON staff_audit_events FOR INSERT TO app_user
  WITH CHECK (
    tenant_id = app_current_tenant()
    AND app_is_platform_staff()
    AND staff_user_id = app_current_user()
  );
--> statement-breakpoint
GRANT SELECT, INSERT ON staff_audit_events TO app_user;
--> statement-breakpoint

-- ── city_interest: cada cidadão registra e vê o seu; a equipe interna vê todos ──

ALTER TABLE city_interest ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE city_interest FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY city_interest_select ON city_interest FOR SELECT TO app_user
  USING (user_id = app_current_user() OR app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY city_interest_insert ON city_interest FOR INSERT TO app_user
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
GRANT SELECT, INSERT ON city_interest TO app_user;
--> statement-breakpoint

-- ── municipality_leads: só a equipe interna ──

ALTER TABLE municipality_leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE municipality_leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY municipality_leads_select ON municipality_leads FOR SELECT TO app_user
  USING (app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY municipality_leads_insert ON municipality_leads FOR INSERT TO app_user
  WITH CHECK (app_is_platform_staff());
--> statement-breakpoint
CREATE POLICY municipality_leads_update ON municipality_leads FOR UPDATE TO app_user
  USING (app_is_platform_staff()) WITH CHECK (app_is_platform_staff());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON municipality_leads TO app_user;
