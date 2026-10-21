-- Isolamento por prefeitura no próprio banco (ver docs/decisoes/0001-isolamento-por-prefeitura.md).
-- A API conecta como app_user, que não é superusuário nem tem BYPASSRLS:
-- tudo que ele lê ou grava passa pelas políticas abaixo.

GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint

-- ── Tabelas da prefeitura: só enxergam e gravam linhas de app_current_tenant() ──

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships', 'departments', 'department_managers', 'teams', 'team_members',
    'categories', 'request_counters', 'requests', 'work_orders', 'status_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO app_user
         USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  memberships, departments, department_managers, teams, team_members, categories, requests, work_orders
  TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON request_counters TO app_user;
--> statement-breakpoint
-- Histórico é trilha de auditoria: só inserção.
GRANT SELECT, INSERT ON status_events TO app_user;
--> statement-breakpoint

-- O usuário logado vê os próprios vínculos em todas as prefeituras (para escolher em qual entrar).
CREATE POLICY own_memberships_select ON memberships FOR SELECT TO app_user
  USING (user_id = app_current_user());
--> statement-breakpoint

-- ── tenants: leitura pública (o cidadão escolhe a prefeitura), escrita só do admin da plataforma ──

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_select ON tenants FOR SELECT TO app_user USING (true);
--> statement-breakpoint
CREATE POLICY tenants_insert ON tenants FOR INSERT TO app_user WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
CREATE POLICY tenants_update ON tenants FOR UPDATE TO app_user
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenants TO app_user;
--> statement-breakpoint

-- ── users: cada um vê a si mesmo e quem tem vínculo com a prefeitura atual ──

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT TO app_user
  USING (
    id = app_current_user()
    OR app_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()
    )
  );
--> statement-breakpoint
-- Cadastro: a API gera o id e o define como app.user_id antes de inserir.
CREATE POLICY users_insert ON users FOR INSERT TO app_user
  WITH CHECK (id = app_current_user() OR app_is_platform_admin());
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO app_user
  USING (id = app_current_user() OR app_is_platform_admin())
  WITH CHECK (id = app_current_user() OR app_is_platform_admin());
--> statement-breakpoint
-- is_platform_admin fica fora dos grants de coluna: a API nunca consegue se promover.
GRANT SELECT ON users TO app_user;
--> statement-breakpoint
GRANT INSERT (id, name, email, phone, cpf, password_hash) ON users TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, email, phone, cpf, password_hash) ON users TO app_user;
--> statement-breakpoint

-- Login: buscar o usuário pelo e-mail antes de existir contexto.
-- SECURITY DEFINER roda como o dono da tabela e devolve só o necessário para conferir a senha.
CREATE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, password_hash text, is_platform_admin boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.password_hash, u.is_platform_admin
    FROM users u
    WHERE lower(u.email) = lower(p_email)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO app_user;
