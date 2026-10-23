-- Acesso sem senha: RLS de códigos, sessões e aparelhos, e as funções usadas antes de
-- existir contexto de usuário (ver docs/decisoes/0001-isolamento-por-prefeitura.md).
-- As funções SECURITY DEFINER rodam como o dono, que precisa de BYPASSRLS (ou ser
-- superusuário): com FORCE, as tabelas não têm política para ele.

-- ── verification_codes: sem política e sem grant; só as funções acessam ──

ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verification_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── sessions: cada um vê e cria as próprias; sair só grava revoked_at ──

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_select ON sessions FOR SELECT TO app_user
  USING (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY sessions_insert ON sessions FOR INSERT TO app_user
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY sessions_update ON sessions FOR UPDATE TO app_user
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
GRANT SELECT, INSERT ON sessions TO app_user;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON sessions TO app_user;
--> statement-breakpoint

-- ── devices: cada um mantém os próprios aparelhos ──

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY devices_select ON devices FOR SELECT TO app_user
  USING (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY devices_insert ON devices FOR INSERT TO app_user
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY devices_update ON devices FOR UPDATE TO app_user
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY devices_delete ON devices FOR DELETE TO app_user
  USING (user_id = app_current_user());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON devices TO app_user;
--> statement-breakpoint
GRANT UPDATE (platform, app_version, push_token, last_seen_at) ON devices TO app_user;
--> statement-breakpoint

-- ── users: o cadastro grava a versão dos Termos aceita ──

GRANT INSERT (terms_version, terms_accepted_at) ON users TO app_user;
--> statement-breakpoint
GRANT UPDATE (terms_version, terms_accepted_at) ON users TO app_user;
--> statement-breakpoint

-- ── client_actions: além da prefeitura, a ação é sempre gravada em nome próprio ──

DROP POLICY tenant_isolation ON client_actions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON client_actions FOR ALL TO app_user
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
--> statement-breakpoint

-- ── Emissão de código: no máximo um a cada 60 s e 5 por hora para (finalidade, destino) ──

CREATE FUNCTION auth_issue_code(
  p_id uuid, p_purpose text, p_target text, p_user_id uuid, p_code_hash text
)
  RETURNS TABLE (issued boolean, retry_after_seconds int)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_last timestamptz;
    v_fifth timestamptz;
    v_next timestamptz;
  BEGIN
    -- Dois pedidos simultâneos para o mesmo destino não passam juntos pelo limite.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_purpose || ':' || p_target, 0));

    SELECT max(vc.created_at) INTO v_last
    FROM verification_codes vc
    WHERE vc.purpose = p_purpose AND vc.target = p_target;

    -- O quinto mais recente da última hora: quando ele sair da janela, cabe mais um.
    SELECT vc.created_at INTO v_fifth
    FROM verification_codes vc
    WHERE vc.purpose = p_purpose AND vc.target = p_target
      AND vc.created_at > now() - interval '1 hour'
    ORDER BY vc.created_at DESC
    OFFSET 4 LIMIT 1;

    -- greatest ignora nulos.
    v_next := greatest(v_last + interval '60 seconds', v_fifth + interval '1 hour');
    IF v_next > now() THEN
      RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_next - now())))::int;
      RETURN;
    END IF;

    INSERT INTO verification_codes (id, purpose, target, user_id, code_hash, expires_at)
    VALUES (p_id, p_purpose, p_target, p_user_id, p_code_hash, now() + interval '10 minutes');
    RETURN QUERY SELECT true, 0;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_issue_code(uuid, text, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_issue_code(uuid, text, text, uuid, text) TO app_user;
--> statement-breakpoint

-- ── Conferência de código: uso único, 10 min, trava na quinta tentativa errada ──

CREATE FUNCTION auth_consume_code(p_id uuid, p_code_hash text)
  RETURNS TABLE (result text, purpose text, target text, user_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_code verification_codes%ROWTYPE;
  BEGIN
    SELECT * INTO v_code FROM verification_codes vc WHERE vc.id = p_id FOR UPDATE;

    IF NOT FOUND OR v_code.consumed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_code.expires_at <= now() THEN
      RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_code.attempts >= 5 THEN
      RETURN QUERY SELECT 'locked'::text, NULL::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;

    IF v_code.code_hash <> p_code_hash THEN
      UPDATE verification_codes vc SET attempts = vc.attempts + 1 WHERE vc.id = p_id;
      RETURN QUERY SELECT
        CASE WHEN v_code.attempts + 1 >= 5 THEN 'locked' ELSE 'invalid' END::text,
        NULL::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;

    UPDATE verification_codes vc SET consumed_at = now() WHERE vc.id = p_id;
    RETURN QUERY SELECT 'ok'::text, v_code.purpose, v_code.target, v_code.user_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_consume_code(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_consume_code(uuid, text) TO app_user;
--> statement-breakpoint

-- ── Login pelo telefone: conta parada (90 dias) e aparelho conhecido ──

DROP FUNCTION auth_find_user_by_phone(text);
--> statement-breakpoint
CREATE FUNCTION auth_find_user_by_phone(p_phone text, p_installation_id uuid)
  RETURNS TABLE (id uuid, email text, stale boolean, known_device boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT
      u.id,
      u.email,
      coalesce(u.last_active_at, u.created_at) <= now() - interval '90 days',
      EXISTS (
        SELECT 1 FROM devices d
        WHERE d.user_id = u.id AND d.installation_id = p_installation_id
      )
    FROM users u
    WHERE u.phone = p_phone AND u.account_status = 'active' AND u.deleted_at IS NULL
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_phone(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text, uuid) TO app_user;
--> statement-breakpoint

-- ── Login do painel pelo CPF: papel interno ou vínculo ativo de gestão ──

DROP FUNCTION auth_find_user_by_cpf(text);
--> statement-breakpoint
CREATE FUNCTION auth_find_user_by_cpf(p_cpf text)
  RETURNS TABLE (id uuid, email text, has_panel_access boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT
      u.id,
      u.email,
      u.platform_role IS NOT NULL OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = u.id
          AND m.status = 'active'
          AND m.role IN ('manager', 'tenant_admin')
      )
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active' AND u.deleted_at IS NULL
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_cpf(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_cpf(text) TO app_user;
--> statement-breakpoint

-- ── Renovação: acha a sessão pelo hash do token e marca o uso ──

CREATE FUNCTION auth_session_for_refresh(p_token_hash text)
  RETURNS TABLE (session_id uuid, user_id uuid, audience text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    WITH touched AS (
      UPDATE sessions s
      SET last_used_at = now(),
          -- Painel: o prazo desliza a cada uso. App: expires_at continua nulo.
          expires_at = CASE
            WHEN s.idle_timeout_seconds IS NOT NULL
              THEN now() + make_interval(secs => s.idle_timeout_seconds)
            ELSE s.expires_at
          END
      FROM users u
      WHERE s.refresh_token_hash = p_token_hash
        AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND u.id = s.user_id
        AND u.account_status = 'active'
        AND u.deleted_at IS NULL
      RETURNING s.id, s.user_id, s.audience
    ), active AS (
      UPDATE users u SET last_active_at = now()
      FROM touched t
      WHERE u.id = t.user_id
      RETURNING u.id
    )
    SELECT t.id, t.user_id, t.audience FROM touched t
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_session_for_refresh(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_session_for_refresh(text) TO app_user;
