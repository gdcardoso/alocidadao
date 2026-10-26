-- Backoffice da equipe interna (Plano 6a): agregados das prefeituras para a P1 e a P3, a conta do
-- admin da prefeitura nova (P2) e a equipe interna nas funções de cadastro do painel (modo suporte).
-- Leitura entre prefeituras só por estas funções SECURITY DEFINER, que devolvem números, nunca
-- linhas de outra prefeitura (decisão 0001). Exigem app.platform_role, que a API só grava depois
-- de conferir users.platform_role no banco.

-- ── Quem chama é da gestão da prefeitura ou da equipe interna ──
-- Mesma assinatura da 0022: as funções do painel aceitam a equipe interna (admin e suporte) na
-- prefeitura do contexto, sem vínculo, inclusive nas regras só do admin da prefeitura.
-- Interna: continua sem GRANT para app_user.

CREATE OR REPLACE FUNCTION panel_require_manager(p_function text, p_admin_only boolean)
  RETURNS void
  LANGUAGE plpgsql STABLE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR app_current_tenant() IS NULL OR NOT (
      app_is_platform_staff()
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = app_current_user()
          AND m.tenant_id = app_current_tenant()
          AND m.status = 'active'
          AND (m.role = 'tenant_admin' OR (m.role = 'manager' AND NOT p_admin_only))
      )
    ) THEN
      RAISE EXCEPTION '%: sem permissão de gestão na prefeitura', p_function
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_require_manager(text, boolean) FROM PUBLIC;
--> statement-breakpoint

-- ── Funções de cadastro do painel ──
-- Recriadas sem mudar o corpo da 0022: a checagem de quem chama é a de panel_require_manager acima.
-- As recusas do alvo (quem já entrou, quem é da equipe interna, gestor ou admin de outra
-- prefeitura, admin desta) continuam as mesmas para a equipe interna.

CREATE OR REPLACE FUNCTION panel_find_or_create_agent_user(p_name text, p_phone text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_agent_user', false);

    SELECT u.id INTO v_id
    FROM users u
    WHERE u.phone = p_phone AND u.account_status = 'active' AND u.deleted_at IS NULL;
    IF v_id IS NULL THEN
      INSERT INTO users (name, phone) VALUES (p_name, p_phone)
      RETURNING users.id INTO v_id;
    END IF;
    RETURN v_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_find_or_create_agent_user(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_find_or_create_agent_user(text, text) TO app_user;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION panel_find_or_create_manager_user(p_name text, p_cpf text, p_email text)
  RETURNS TABLE (id uuid, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_manager_user', true);

    SELECT u.id, u.email INTO v_id, v_email
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF v_id IS NULL THEN
      INSERT INTO users (name, cpf, email) VALUES (p_name, p_cpf, p_email)
      RETURNING users.id, users.email INTO v_id, v_email;
    ELSIF v_email IS NULL THEN
      UPDATE users u SET email = p_email WHERE u.id = v_id
      RETURNING u.email INTO v_email;
    END IF;

    id := v_id;
    email := v_email;
    RETURN NEXT;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_find_or_create_manager_user(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_find_or_create_manager_user(text, text, text) TO app_user;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION panel_change_agent_phone(p_user_id uuid, p_phone text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_last_active timestamptz;
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_change_agent_phone', false);

    SELECT u.last_active_at, u.platform_role INTO v_last_active, v_platform_role
    FROM users u
    WHERE u.id = p_user_id
      AND u.account_status = 'active'
      AND u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = u.id
          AND m.tenant_id = app_current_tenant()
          AND m.role = 'field_agent'
      )
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'panel_change_agent_phone: agente inexistente nesta prefeitura'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_last_active IS NOT NULL OR v_platform_role IS NOT NULL OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = p_user_id
        AND (m.tenant_id <> app_current_tenant() OR m.role IN ('manager', 'tenant_admin'))
    ) THEN
      RAISE EXCEPTION 'phone_change_not_allowed'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users u SET phone = p_phone WHERE u.id = p_user_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_change_agent_phone(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_change_agent_phone(uuid, text) TO app_user;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION panel_change_manager_email(p_user_id uuid, p_email text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_change_manager_email', true);

    SELECT u.platform_role INTO v_platform_role
    FROM users u
    WHERE u.id = p_user_id
      AND u.account_status = 'active'
      AND u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = u.id
          AND m.tenant_id = app_current_tenant()
          AND m.role = 'manager'
      )
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'panel_change_manager_email: gestor inexistente nesta prefeitura'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_platform_role IS NOT NULL OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = p_user_id
        AND (
          (m.tenant_id <> app_current_tenant() AND m.role IN ('manager', 'tenant_admin'))
          OR (m.tenant_id = app_current_tenant() AND m.role = 'tenant_admin')
        )
    ) THEN
      RAISE EXCEPTION 'email_change_not_allowed'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users u SET email = p_email WHERE u.id = p_user_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_change_manager_email(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_change_manager_email(uuid, text) TO app_user;
--> statement-breakpoint

-- ── Quem chama é da equipe interna ──
-- Interna: sem GRANT para app_user; roda dentro das funções abaixo, como o dono.

CREATE FUNCTION platform_require_staff(p_function text)
  RETURNS void
  LANGUAGE plpgsql STABLE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT app_is_platform_staff() THEN
      RAISE EXCEPTION '%: só a equipe interna da plataforma', p_function
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_require_staff(text) FROM PUBLIC;
--> statement-breakpoint

-- ── Desde quando a atividade está no status atual (statusSince do 5b) ──
-- O evento mais recente da atividade com to_status igual ao status atual; sem evento, o
-- updated_at. Interna, sem GRANT.

CREATE FUNCTION platform_work_order_status_since(p_work_order work_orders)
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(
      (
        SELECT max(se.created_at)
        FROM status_events se
        WHERE se.tenant_id = p_work_order.tenant_id
          AND se.work_order_id = p_work_order.id
          AND se.to_status = p_work_order.status::text
      ),
      p_work_order.updated_at
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_work_order_status_since(work_orders) FROM PUBLIC;
--> statement-breakpoint

-- ── Desde quando a ocorrência está no status atual (statusSince do 5a) ──
-- O evento mais recente da própria ocorrência (sem solicitação nem atividade) com to_status igual
-- ao status atual; sem evento, o created_at. Interna, sem GRANT.

CREATE FUNCTION platform_occurrence_status_since(p_occurrence occurrences)
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(
      (
        SELECT max(se.created_at)
        FROM status_events se
        WHERE se.tenant_id = p_occurrence.tenant_id
          AND se.occurrence_id = p_occurrence.id
          AND se.request_id IS NULL
          AND se.work_order_id IS NULL
          AND se.to_status = p_occurrence.status::text
      ),
      p_occurrence.created_at
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_occurrence_status_since(occurrences) FROM PUBLIC;
--> statement-breakpoint

-- ── Tempo médio até a conclusão, em dias com uma casa ──
-- Para cada evento de solicitação para awaiting_confirmation (a publicação do atendimento) dos
-- últimos 30 dias, o tempo desde a criação da solicitação. p_tenant_id nulo: todas as prefeituras
-- ativas (visão geral). Sem evento: nulo. Interna, sem GRANT.

CREATE FUNCTION platform_avg_resolution_days(p_tenant_id uuid)
  RETURNS numeric
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT round(avg(extract(epoch FROM se.created_at - r.created_at) / 86400)::numeric, 1)
    FROM status_events se
    JOIN requests r ON r.tenant_id = se.tenant_id AND r.id = se.request_id
    JOIN tenants t ON t.id = se.tenant_id
    WHERE se.to_status = 'awaiting_confirmation'
      AND se.created_at >= now() - interval '30 days'
      AND CASE WHEN p_tenant_id IS NULL THEN t.status = 'active' ELSE t.id = p_tenant_id END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_avg_resolution_days(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ── P1: uma linha por prefeitura, em qualquer status ──
-- Cidadãos: pessoas distintas com alguma solicitação. Abertas: ocorrências em triagem ou em
-- atendimento. Alertas: atividades aguardando revisão e impedidas há 24 h ou mais.

CREATE FUNCTION platform_tenant_summaries()
  RETURNS TABLE (
    tenant_id uuid,
    citizen_count integer,
    open_count integer,
    avg_resolution_days numeric,
    late_review_count integer,
    stale_impediment_count integer,
    active_category_count integer
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    PERFORM platform_require_staff('platform_tenant_summaries');

    RETURN QUERY
    SELECT
      t.id,
      (SELECT count(DISTINCT r.citizen_id)::int FROM requests r WHERE r.tenant_id = t.id),
      (
        SELECT count(*)::int FROM occurrences o
        WHERE o.tenant_id = t.id AND o.status IN ('triage', 'in_progress')
      ),
      platform_avg_resolution_days(t.id),
      (
        SELECT count(*)::int FROM work_orders w
        WHERE w.tenant_id = t.id
          AND w.status = 'awaiting_review'
          AND platform_work_order_status_since(w) <= now() - interval '24 hours'
      ),
      (
        SELECT count(*)::int FROM work_orders w
        WHERE w.tenant_id = t.id
          AND w.status = 'impeded'
          AND platform_work_order_status_since(w) <= now() - interval '24 hours'
      ),
      (SELECT count(*)::int FROM categories c WHERE c.tenant_id = t.id AND c.active)
    FROM tenants t;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_tenant_summaries() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_tenant_summaries() TO app_user;
--> statement-breakpoint

-- ── P1: os indicadores do topo ──
-- Cidadãos: pessoas distintas com alguma solicitação em prefeitura ativa. Solicitações do mês e
-- do mês anterior: todas as prefeituras, com a virada do mês no horário de Brasília.

CREATE FUNCTION platform_overview()
  RETURNS TABLE (
    active_tenants integer,
    onboarding_tenants integer,
    suspended_tenants integer,
    citizens integer,
    requests_this_month integer,
    requests_last_month integer,
    avg_resolution_days numeric
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_month timestamp := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo');
    v_this_month timestamptz := v_month AT TIME ZONE 'America/Sao_Paulo';
    v_last_month timestamptz := (v_month - interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
    v_next_month timestamptz := (v_month + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  BEGIN
    PERFORM platform_require_staff('platform_overview');

    RETURN QUERY
    SELECT
      (SELECT count(*)::int FROM tenants t WHERE t.status = 'active'),
      (SELECT count(*)::int FROM tenants t WHERE t.status = 'onboarding'),
      (SELECT count(*)::int FROM tenants t WHERE t.status = 'suspended'),
      (
        SELECT count(DISTINCT r.citizen_id)::int
        FROM requests r
        JOIN tenants t ON t.id = r.tenant_id
        WHERE t.status = 'active'
      ),
      (
        SELECT count(*)::int FROM requests r
        WHERE r.created_at >= v_this_month AND r.created_at < v_next_month
      ),
      (
        SELECT count(*)::int FROM requests r
        WHERE r.created_at >= v_last_month AND r.created_at < v_this_month
      ),
      platform_avg_resolution_days(NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_overview() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_overview() TO app_user;
--> statement-breakpoint

-- ── P3: os números da Visão geral de uma prefeitura ──
-- Abertas há +3 dias: em triagem há 72 h ou mais. Revisão atrasada: há 24 h ou mais. Usuários do
-- painel: agentes ativos ou convidados mais gestores e admins ativos, cada pessoa uma vez.
-- Prefeitura inexistente: nenhuma linha.

CREATE FUNCTION platform_tenant_detail(p_tenant_id uuid)
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
      (
        SELECT count(DISTINCT m.user_id)::int FROM memberships m
        WHERE m.tenant_id = t.id
          AND (
            (m.role = 'field_agent' AND m.status IN ('active', 'invited'))
            OR (m.role IN ('manager', 'tenant_admin') AND m.status = 'active')
          )
      ),
      platform_avg_resolution_days(t.id)
    FROM tenants t
    WHERE t.id = p_tenant_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_tenant_detail(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_tenant_detail(uuid) TO app_user;
--> statement-breakpoint

-- ── P2: admin da prefeitura nova (só o admin da plataforma) ──
-- As regras de panel_find_or_create_manager_user: acha a conta ativa pelo CPF ou cria uma com
-- nome, CPF e e-mail. A conta que já existe mantém nome e e-mail; sem e-mail, recebe o digitado.
-- Devolve o e-mail final: a API compara com o digitado para responder email_mismatch. E-mail de
-- outra conta cai em users_email_lower_idx e CPF de conta congelada em users_cpf_unique (23505).
-- Conta da equipe interna (platform_role) não vira admin de prefeitura: check_violation
-- 'staff_account_not_allowed'.

CREATE FUNCTION platform_find_or_create_tenant_admin(p_name text, p_cpf text, p_email text)
  RETURNS TABLE (id uuid, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
    v_platform_role text;
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_find_or_create_tenant_admin: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.id, u.email, u.platform_role INTO v_id, v_email, v_platform_role
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF v_platform_role IS NOT NULL THEN
      RAISE EXCEPTION 'staff_account_not_allowed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO users (name, cpf, email) VALUES (p_name, p_cpf, p_email)
      RETURNING users.id, users.email INTO v_id, v_email;
    ELSIF v_email IS NULL THEN
      UPDATE users u SET email = p_email WHERE u.id = v_id
      RETURNING u.email INTO v_email;
    END IF;

    id := v_id;
    email := v_email;
    RETURN NEXT;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_find_or_create_tenant_admin(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_find_or_create_tenant_admin(text, text, text) TO app_user;
