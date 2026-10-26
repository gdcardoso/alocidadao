-- Isolamento por prefeitura das separações (mesmo padrão da migração 0006).
ALTER TABLE occurrence_separations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE occurrence_separations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON occurrence_separations FOR ALL TO app_user
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- O gestor marca o par como "é outro problema" e não volta atrás: só leitura e inclusão.
GRANT SELECT, INSERT ON occurrence_separations TO app_user;
--> statement-breakpoint

-- Login do painel: só conta o vínculo de gestão em prefeitura em implantação ou ativa.
-- A suspensa não entra (o papel interno da plataforma continua valendo).
CREATE OR REPLACE FUNCTION auth_find_user_by_cpf(p_cpf text)
  RETURNS TABLE (id uuid, email text, has_panel_access boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT
      u.id,
      u.email,
      u.platform_role IS NOT NULL OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = u.id
          AND m.status = 'active'
          AND m.role IN ('manager', 'tenant_admin')
          AND t.status IN ('onboarding', 'active')
      )
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active' AND u.deleted_at IS NULL
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_cpf(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_cpf(text) TO app_user;
