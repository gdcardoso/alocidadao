-- Cadastro de agentes e gestores pelo painel e leitura da auditoria pela gestão da prefeitura.
-- O RLS de users só deixa o app_user ver a si mesmo, a equipe interna e quem tem vínculo na
-- prefeitura do contexto, e só inserir a própria conta. Por isso achar ou criar a conta de outra
-- pessoa passa por funções SECURITY DEFINER, como as da 0014 (o dono precisa de BYPASSRLS).
-- Todas conferem que quem chama tem vínculo ativo manager ou tenant_admin na prefeitura do
-- contexto. O alcance por setor (qual equipe, qual agente) continua na API.
-- Conflitos nos índices únicos (users_phone_active_idx, users_email_lower_idx, users.cpf) saem
-- como 23505, e a API traduz em phone_in_use e email_in_use.

-- ── Quem chama é da gestão da prefeitura ──
-- Interna: não tem GRANT para app_user; roda dentro das funções abaixo, como o dono.

CREATE FUNCTION panel_require_manager(p_function text, p_admin_only boolean)
  RETURNS void
  LANGUAGE plpgsql STABLE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR app_current_tenant() IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = app_current_user()
        AND m.tenant_id = app_current_tenant()
        AND m.status = 'active'
        AND (m.role = 'tenant_admin' OR (m.role = 'manager' AND NOT p_admin_only))
    ) THEN
      RAISE EXCEPTION '%: sem permissão de gestão na prefeitura', p_function
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_require_manager(text, boolean) FROM PUBLIC;
--> statement-breakpoint

-- ── Agente: acha a conta ativa pelo celular ou cria uma ──
-- A conta que já existe (um cidadão, por exemplo) mantém o próprio nome.

CREATE FUNCTION panel_find_or_create_agent_user(p_name text, p_phone text)
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

-- ── Gestor: acha a conta ativa pelo CPF ou cria uma ──
-- A conta que já existe mantém nome e e-mail; sem e-mail, recebe o digitado. Devolve o e-mail
-- final: a API compara com o digitado para responder email_mismatch. E-mail de outra conta cai
-- em users_email_lower_idx (23505).

CREATE FUNCTION panel_find_or_create_manager_user(p_name text, p_cpf text, p_email text)
  RETURNS TABLE (id uuid, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_manager_user', false);

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

-- ── Troca do celular de um agente que nunca entrou ──
-- Quem já entrou no app troca o número no Perfil (account_change_phone): assim o gestor nunca
-- muda o login de quem já usa o app, nem o de um cidadão. Número de outra conta ativa cai em
-- users_phone_active_idx (23505).

CREATE FUNCTION panel_change_agent_phone(p_user_id uuid, p_phone text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_last_active timestamptz;
  BEGIN
    PERFORM panel_require_manager('panel_change_agent_phone', false);

    SELECT u.last_active_at INTO v_last_active
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
    IF v_last_active IS NOT NULL THEN
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

-- ── Troca do e-mail de um gestor (só o admin da prefeitura) ──
-- E-mail de outra conta cai em users_email_lower_idx (23505).

CREATE FUNCTION panel_change_manager_email(p_user_id uuid, p_email text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM panel_require_manager('panel_change_manager_email', true);

    UPDATE users u SET email = p_email
    WHERE u.id = p_user_id
      AND u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = u.id
          AND m.tenant_id = app_current_tenant()
          AND m.role = 'manager'
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'panel_change_manager_email: gestor inexistente nesta prefeitura'
        USING ERRCODE = 'no_data_found';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION panel_change_manager_email(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION panel_change_manager_email(uuid, text) TO app_user;
--> statement-breakpoint

-- ── staff_audit_events: na prefeitura do contexto, lê a equipe interna e a gestão ──
-- Substitui a política da 0009, que deixava qualquer vínculo (cidadão, agente) ler.
-- Plano 6: quem gravar em details não põe dado pessoal (nome, telefone, CPF, e-mail): a
-- gestão da prefeitura lê esta tabela.

DROP POLICY staff_audit_events_select ON staff_audit_events;
--> statement-breakpoint
CREATE POLICY staff_audit_events_select ON staff_audit_events FOR SELECT TO app_user
  USING (
    tenant_id = app_current_tenant()
    AND (
      app_is_platform_staff()
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = app_current_user()
          AND m.tenant_id = app_current_tenant()
          AND m.status = 'active'
          AND m.role IN ('manager', 'tenant_admin')
      )
    )
  );
