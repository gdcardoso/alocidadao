-- Dados da prefeitura (painel): a contagem de usuários do painel passa a ter uma só definição,
-- usada pela Visão geral da P3 (platform_tenant_detail) e por panel_tenant_profile.

-- Usuários do painel: agentes ativos ou convidados mais gestores e admins ativos, cada pessoa
-- uma vez. Auxiliar interna: só o dono e as funções SECURITY DEFINER executam.
CREATE FUNCTION tenant_panel_user_count(p_tenant uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT count(DISTINCT m.user_id)::int FROM memberships m
    WHERE m.tenant_id = p_tenant
      AND (
        (m.role = 'field_agent' AND m.status IN ('active', 'invited'))
        OR (m.role IN ('manager', 'tenant_admin') AND m.status = 'active')
      )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_panel_user_count(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform_tenant_detail(p_tenant_id uuid)
  RETURNS TABLE (
    tenant_id uuid,
    citizen_count integer,
    open_count integer,
    stale_triage_count integer,
    awaiting_review_count integer,
    late_review_count integer,
    team_count integer,
    active_agent_count integer,
    invited_agent_count integer,
    manager_count integer,
    admin_count integer,
    active_category_count integer,
    panel_user_count integer,
    avg_resolution_days numeric
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    PERFORM platform_require_staff('platform_tenant_detail');

    RETURN QUERY
    SELECT
      t.id,
      (SELECT count(DISTINCT r.citizen_id)::int FROM requests r WHERE r.tenant_id = t.id),
      (
        SELECT count(*)::int FROM occurrences o
        WHERE o.tenant_id = t.id AND o.status IN ('triage', 'in_progress')
      ),
      (
        SELECT count(*)::int FROM occurrences o
        WHERE o.tenant_id = t.id
          AND o.status = 'triage'
          AND platform_occurrence_status_since(o) <= now() - interval '72 hours'
      ),
      (
        SELECT count(*)::int FROM work_orders w
        WHERE w.tenant_id = t.id AND w.status = 'awaiting_review'
      ),
      (
        SELECT count(*)::int FROM work_orders w
        WHERE w.tenant_id = t.id
          AND w.status = 'awaiting_review'
          AND platform_work_order_status_since(w) <= now() - interval '24 hours'
      ),
      (SELECT count(*)::int FROM teams tm WHERE tm.tenant_id = t.id),
      (
        SELECT count(DISTINCT m.user_id)::int FROM memberships m
        WHERE m.tenant_id = t.id AND m.role = 'field_agent' AND m.status = 'active'
      ),
      (
        SELECT count(DISTINCT m.user_id)::int FROM memberships m
        WHERE m.tenant_id = t.id AND m.role = 'field_agent' AND m.status = 'invited'
      ),
      (
        SELECT count(DISTINCT m.user_id)::int FROM memberships m
        WHERE m.tenant_id = t.id AND m.role = 'manager' AND m.status = 'active'
      ),
      (
        SELECT count(DISTINCT m.user_id)::int FROM memberships m
        WHERE m.tenant_id = t.id AND m.role = 'tenant_admin' AND m.status = 'active'
      ),
      (SELECT count(*)::int FROM categories c WHERE c.tenant_id = t.id AND c.active),
      tenant_panel_user_count(t.id),
      platform_avg_resolution_days(t.id)
    FROM tenants t
    WHERE t.id = p_tenant_id;
  END;
  $$;
--> statement-breakpoint

-- Dados da prefeitura do contexto, para o gestor e o admin (vínculo ativo) ou a equipe interna.
-- SECURITY DEFINER porque tenant_contracts só a equipe lê (RLS 0009). Sem contexto de prefeitura
-- ou sem permissão: null (a API responde 403). Contrato vigente: o de início mais recente.
CREATE FUNCTION panel_tenant_profile() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_result jsonb;
  BEGIN
    IF v_tenant IS NULL THEN
      RETURN NULL;
    END IF;
    IF NOT (
      app_is_platform_staff()
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.tenant_id = v_tenant
          AND m.user_id = app_current_user()
          AND m.role IN ('manager', 'tenant_admin')
          AND m.status = 'active'
      )
    ) THEN
      RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
      'displayName', t.display_name,
      'city', t.city,
      'state', t.state,
      'ibgeCode', t.ibge_code,
      'centralPhone', t.central_phone,
      'status', t.status,
      'contract', (
        SELECT jsonb_build_object(
          'plan', c.plan,
          'startsOn', c.starts_on,
          'endsOn', c.ends_on,
          'includedPanelUsers', c.included_panel_users
        )
        FROM tenant_contracts c
        WHERE c.tenant_id = t.id
        ORDER BY c.starts_on DESC, c.created_at DESC
        LIMIT 1
      ),
      'panelUserCount', tenant_panel_user_count(t.id),
      'neighborhoods', jsonb_build_object(
        'count', (SELECT count(*)::int FROM effective_neighborhoods(t.id)),
        'source', (SELECT min(e.source) FROM effective_neighborhoods(t.id) e)
      )
    ) INTO v_result
    FROM tenants t
    WHERE t.id = v_tenant;
    RETURN v_result;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_tenant_profile() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_tenant_profile() TO app_user;
