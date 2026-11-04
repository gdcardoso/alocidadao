-- Convites por e-mail: e-mail do agente no cadastro e na troca pelo painel, registro das entregas
-- (invite_deliveries) e a lista de agentes que ainda não receberam o convite da prefeitura
-- (ver docs/decisoes/0001-isolamento-por-prefeitura.md).

-- ── invite_deliveries: sem política e sem GRANT; só as funções SECURITY DEFINER acessam ──

ALTER TABLE invite_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invite_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON invite_deliveries FROM PUBLIC;
--> statement-breakpoint

-- ── Agente: acha a conta ativa pelo celular ou cria uma, agora com o e-mail (substitui a da 0026) ──
-- Mesmo comportamento de antes; a conta que já existe mantém nome e e-mail e, sem e-mail, recebe o
-- digitado. Devolve o e-mail final: a API compara com o digitado (pessoa com outro e-mail). E-mail de
-- outra conta cai em users_email_lower_idx (23505). p_email nulo acha ou cria sem mexer no e-mail.

DROP FUNCTION panel_find_or_create_agent_user(text, text);
--> statement-breakpoint
CREATE FUNCTION panel_find_or_create_agent_user(p_name text, p_phone text, p_email text)
  RETURNS TABLE (id uuid, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_agent_user', false);

    SELECT u.id, u.email, u.platform_role INTO v_id, v_email, v_platform_role
    FROM users u
    WHERE u.phone = p_phone AND u.account_status = 'active' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF v_platform_role IS NOT NULL THEN
      RAISE EXCEPTION 'staff_account_not_allowed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO users (name, phone, email) VALUES (p_name, p_phone, p_email)
      RETURNING users.id, users.email INTO v_id, v_email;
    ELSIF v_email IS NULL AND p_email IS NOT NULL THEN
      UPDATE users u SET email = p_email WHERE u.id = v_id
      RETURNING u.email INTO v_email;
    END IF;

    id := v_id;
    email := v_email;
    RETURN NEXT;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_find_or_create_agent_user(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_find_or_create_agent_user(text, text, text) TO app_user;
--> statement-breakpoint

-- ── Troca do e-mail do agente (espelho de panel_change_manager_email) ──
-- O e-mail é o segundo fator de entrada no painel: recusa (email_change_not_allowed) conta da equipe
-- interna e, fora do modo suporte, quem tem acesso de gestão em qualquer prefeitura ou é agente em
-- outra prefeitura. Não reenvia o convite.

CREATE FUNCTION panel_change_agent_email(p_user_id uuid, p_email text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_change_agent_email', false);

    SELECT u.platform_role INTO v_platform_role
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
      RAISE EXCEPTION 'panel_change_agent_email: agente inexistente nesta prefeitura'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_platform_role IS NOT NULL OR (
      NOT app_is_platform_staff() AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = p_user_id
          AND (
            m.role IN ('manager', 'tenant_admin')
            OR (m.role = 'field_agent' AND m.tenant_id <> app_current_tenant())
          )
      )
    ) THEN
      RAISE EXCEPTION 'email_change_not_allowed'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users u SET email = p_email WHERE u.id = p_user_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_change_agent_email(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_change_agent_email(uuid, text) TO app_user;
--> statement-breakpoint

-- ── Registro de uma entrega de convite ──
-- Devolve 0 e grava a entrega, ou os segundos que faltam para o próximo envio (sem gravar) quando
-- já houve um do mesmo tipo para o mesmo par pessoa/prefeitura há menos de p_min_interval_seconds.
-- O envio automático passa 0. Quem grava: a equipe interna, ou gestor/admin com vínculo ativo na
-- prefeitura; o convite da equipe interna (sem prefeitura), só o admin da plataforma.

CREATE FUNCTION invite_record(
  p_user_id uuid,
  p_tenant_id uuid,
  p_kind invite_kind,
  p_min_interval_seconds int
)
  RETURNS int
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_last timestamptz;
    v_wait int;
  BEGIN
    IF (p_kind = 'staff') <> (p_tenant_id IS NULL) THEN
      RAISE EXCEPTION 'invite_record: só o convite da equipe interna vem sem prefeitura'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF app_current_user() IS NULL OR NOT (
      CASE WHEN p_kind = 'staff' THEN app_is_platform_admin()
      ELSE app_is_platform_staff() OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = app_current_user()
          AND m.tenant_id = p_tenant_id
          AND m.status = 'active'
          AND m.role IN ('manager', 'tenant_admin')
      )
      END
    ) THEN
      RAISE EXCEPTION 'invite_record: sem permissão para registrar o convite'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Dois reenvios ao mesmo tempo não passam juntos pelo limite.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'invite_record:' || p_user_id || ':' || coalesce(p_tenant_id::text, '') || ':' || p_kind,
        0
      )
    );

    IF p_min_interval_seconds > 0 THEN
      SELECT max(d.sent_at) INTO v_last
      FROM invite_deliveries d
      WHERE d.user_id = p_user_id
        AND d.tenant_id IS NOT DISTINCT FROM p_tenant_id
        AND d.kind = p_kind;
      IF v_last IS NOT NULL THEN
        v_wait := ceil(p_min_interval_seconds - extract(epoch FROM now() - v_last))::int;
        IF v_wait > 0 THEN
          RETURN v_wait;
        END IF;
      END IF;
    END IF;

    INSERT INTO invite_deliveries (user_id, tenant_id, kind, sent_by)
    VALUES (p_user_id, p_tenant_id, p_kind, app_current_user());
    RETURN 0;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invite_record(uuid, uuid, invite_kind, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invite_record(uuid, uuid, invite_kind, int) TO app_user;
--> statement-breakpoint

-- ── Agentes que ainda não receberam o convite da prefeitura (só o admin da plataforma) ──
-- Usada quando a prefeitura é ativada: vínculo de agente convidado ou ativo, conta ativa, com
-- e-mail e nenhuma entrega `agent` para o par pessoa/prefeitura.

CREATE FUNCTION invite_pending_agents(p_tenant_id uuid)
  RETURNS TABLE (user_id uuid, name text, email text, phone text, team_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'invite_pending_agents: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
      SELECT u.id, u.name, u.email, u.phone, t.name
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN team_members tm ON tm.tenant_id = m.tenant_id AND tm.user_id = m.user_id
      LEFT JOIN teams t ON t.tenant_id = tm.tenant_id AND t.id = tm.team_id
      WHERE m.tenant_id = p_tenant_id
        AND m.role = 'field_agent'
        AND m.status IN ('invited', 'active')
        AND u.account_status = 'active'
        AND u.deleted_at IS NULL
        AND u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM invite_deliveries d
          WHERE d.user_id = m.user_id
            AND d.tenant_id = p_tenant_id
            AND d.kind = 'agent'
        )
      ORDER BY u.name;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invite_pending_agents(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invite_pending_agents(uuid) TO app_user;
