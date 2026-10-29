-- Backoffice da equipe interna (Plano 6b): interesse por cidade (P5), equipe interna (P6),
-- auditoria (P7), conta congelada com o CPF preso e as correções sem tela. Leitura e escrita entre
-- prefeituras só por funções SECURITY DEFINER (decisão 0001). Exigem app.platform_role, que a API
-- só grava depois de conferir users.platform_role no banco.

-- ── staff_audit_events: ações do backoffice sem prefeitura ──
-- A coluna tenant_id aceita nulo desde a 0025. Grava só quem é da equipe, em nome próprio, na
-- prefeitura do contexto ou sem prefeitura. A leitura continua por prefeitura (0022): as linhas
-- sem prefeitura só aparecem em platform_audit_events, só para o admin.

DROP POLICY staff_audit_events_insert ON staff_audit_events;
--> statement-breakpoint
CREATE POLICY staff_audit_events_insert ON staff_audit_events FOR INSERT TO app_user
  WITH CHECK (
    (tenant_id = app_current_tenant() OR tenant_id IS NULL)
    AND app_is_platform_staff()
    AND staff_user_id = app_current_user()
  );
--> statement-breakpoint

-- ── Grava uma linha de auditoria em nome de quem chama ──
-- Interna: sem GRANT para app_user; roda dentro das funções abaixo, como o dono. p_tenant_id nulo
-- para as ações do backoffice. details nunca leva dado pessoal (nome, telefone, CPF, e-mail).

CREATE FUNCTION platform_record_audit(
  p_tenant_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb
)
  RETURNS void
  LANGUAGE plpgsql VOLATILE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR NOT app_is_platform_staff() THEN
      RAISE EXCEPTION 'platform_record_audit: só a equipe interna, em nome próprio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO staff_audit_events (tenant_id, staff_user_id, action, target_type, target_id, details)
    VALUES (p_tenant_id, app_current_user(), p_action, p_target_type, p_target_id, p_details);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_record_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- ── Último Admin da equipe interna ──
-- Trava única para tudo que tira um Admin (troca de papel, remoção, exclusão da conta): duas
-- chamadas simultâneas esperam uma pela outra, e a segunda já vê o resultado da primeira. Depois
-- da trava, recusa se não sobra outro Admin ativo além de p_user_id. Interna, sem GRANT.

CREATE FUNCTION platform_lock_admins()
  RETURNS void
  LANGUAGE sql VOLATILE
  SET search_path = public, pg_temp
  AS $$ SELECT pg_advisory_xact_lock(hashtext('platform_admins')) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_lock_admins() FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION platform_require_other_admin(p_user_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.platform_role = 'admin'
        AND u.id <> p_user_id
        AND u.account_status = 'active'
        AND u.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'last_platform_admin' USING ERRCODE = 'check_violation';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_require_other_admin(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ── municipality_leads: quem mudou e quando, sempre do contexto ──
-- Vale para as funções e para a escrita direta que a política da 0009 permite à equipe.

CREATE FUNCTION municipality_leads_stamp()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    NEW.updated_by := app_current_user();
    NEW.updated_at := now();
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION municipality_leads_stamp() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER municipality_leads_stamp
  BEFORE INSERT OR UPDATE ON municipality_leads
  FOR EACH ROW EXECUTE FUNCTION municipality_leads_stamp();
--> statement-breakpoint

-- ── P5: interesse por cidade (equipe interna) ──
-- Uma linha por município com interesse. Pedidos: pessoas distintas (a chave de city_interest já
-- é uma por pessoa e município). Sem linha em municipality_leads: 'new'. Já é cliente: existe
-- prefeitura com o código IBGE, em qualquer status. Ordem: pedidos, do maior para o menor; depois
-- o nome.

CREATE FUNCTION platform_city_interest()
  RETURNS TABLE (
    ibge_code char(7),
    name text,
    state text,
    request_count integer,
    last_30_days integer,
    first_at timestamptz,
    commercial_status commercial_status,
    is_customer boolean
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    PERFORM platform_require_staff('platform_city_interest');

    RETURN QUERY
    SELECT
      ci.ibge_code,
      coalesce(m.name, ci.ibge_code::text),
      m.state::text,
      count(*)::int,
      (count(*) FILTER (WHERE ci.created_at >= now() - interval '30 days'))::int,
      min(ci.created_at),
      coalesce(ml.commercial_status, 'new'),
      EXISTS (SELECT 1 FROM tenants t WHERE t.ibge_code = ci.ibge_code::text)
    FROM city_interest ci
    LEFT JOIN municipalities m ON m.ibge_code = ci.ibge_code
    LEFT JOIN municipality_leads ml ON ml.ibge_code = ci.ibge_code
    GROUP BY ci.ibge_code, m.name, m.state, ml.commercial_status
    ORDER BY count(*) DESC, coalesce(m.name, ci.ibge_code::text), ci.ibge_code;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_city_interest() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_city_interest() TO app_user;
--> statement-breakpoint

-- ── P5: muda a situação comercial (equipe interna) ──
-- Cria a linha se não existir; quem mudou e quando vêm do trigger. Município inexistente:
-- no_data_found. Auditoria sem prefeitura, com o código IBGE em details (não é dado pessoal).

CREATE FUNCTION platform_set_lead_status(p_ibge_code char(7), p_status commercial_status)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM platform_require_staff('platform_set_lead_status');

    IF NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.ibge_code = p_ibge_code) THEN
      RAISE EXCEPTION 'platform_set_lead_status: município inexistente'
        USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO municipality_leads (ibge_code, commercial_status, updated_by)
    VALUES (p_ibge_code, p_status, app_current_user())
    ON CONFLICT (ibge_code) DO UPDATE SET commercial_status = excluded.commercial_status;

    PERFORM platform_record_audit(
      NULL, 'lead.update', 'municipality', NULL, jsonb_build_object('ibgeCode', p_ibge_code)
    );
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_set_lead_status(char, commercial_status) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_set_lead_status(char, commercial_status) TO app_user;
--> statement-breakpoint

-- ── P6: a equipe interna (só o admin da plataforma) ──
-- Contas com platform_role e não excluídas. O CPF vai inteiro: a API mascara.

CREATE FUNCTION platform_staff_list()
  RETURNS TABLE (
    user_id uuid,
    name text,
    cpf text,
    email text,
    platform_role platform_role,
    last_active_at timestamptz
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_staff_list: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT u.id, u.name, u.cpf, u.email, u.platform_role, u.last_active_at
    FROM users u
    WHERE u.platform_role IS NOT NULL AND u.deleted_at IS NULL
    ORDER BY u.name, u.id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_staff_list() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_staff_list() TO app_user;
--> statement-breakpoint

-- ── P6: adiciona uma pessoa à equipe ──
-- As regras de platform_find_or_create_tenant_admin: acha a conta ativa pelo CPF ou cria uma com
-- nome, CPF, e-mail e papel. A existente mantém o nome; sem e-mail, recebe o digitado; com outro
-- e-mail, check_violation 'email_mismatch' (sem diferenciar maiúsculas). Recusas: 'already_staff'
-- (já tem platform_role) e 'tenant_member_not_allowed' (vínculo de gestor, admin ou agente ativo
-- ou convidado em alguma prefeitura; o convite vira ativo no próximo login). Vínculo inativo e
-- cidadão não impedem. E-mail de outra conta cai em users_email_lower_idx e CPF de conta congelada
-- em users_cpf_unique (23505; a API responde cpf_unavailable).

CREATE FUNCTION platform_staff_add(p_name text, p_cpf text, p_email text, p_role platform_role)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
    v_role platform_role;
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_staff_add: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.id, u.email, u.platform_role INTO v_id, v_email, v_role
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'active' AND u.deleted_at IS NULL
    FOR UPDATE;

    IF v_id IS NULL THEN
      INSERT INTO users (name, cpf, email, platform_role)
      VALUES (p_name, p_cpf, p_email, p_role)
      RETURNING users.id INTO v_id;
    ELSE
      IF v_role IS NOT NULL THEN
        RAISE EXCEPTION 'already_staff' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = v_id
          AND m.role IN ('manager', 'tenant_admin', 'field_agent')
          AND m.status IN ('active', 'invited')
      ) THEN
        RAISE EXCEPTION 'tenant_member_not_allowed' USING ERRCODE = 'check_violation';
      END IF;
      IF v_email IS NOT NULL AND lower(v_email) <> lower(p_email) THEN
        RAISE EXCEPTION 'email_mismatch' USING ERRCODE = 'check_violation';
      END IF;

      UPDATE users u
      SET platform_role = p_role, email = coalesce(u.email, p_email)
      WHERE u.id = v_id;
    END IF;

    PERFORM platform_record_audit(NULL, 'staff.create', 'staff', v_id, NULL);
    RETURN v_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_staff_add(text, text, text, platform_role) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_staff_add(text, text, text, platform_role) TO app_user;
--> statement-breakpoint

-- ── P6: edita nome e e-mail de quem é da equipe ──
-- Quem não é da equipe (ou excluído): no_data_found. E-mail de outra conta cai no índice único.

CREATE FUNCTION platform_staff_update(p_user_id uuid, p_name text, p_email text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_staff_update: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE users u SET name = p_name, email = p_email
    WHERE u.id = p_user_id AND u.platform_role IS NOT NULL AND u.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_staff_update: pessoa fora da equipe'
        USING ERRCODE = 'no_data_found';
    END IF;

    PERFORM platform_record_audit(NULL, 'staff.update', 'staff', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_staff_update(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_staff_update(uuid, text, text) TO app_user;
--> statement-breakpoint

-- ── P6: troca o papel (Admin ⇄ Suporte) ──
-- Ninguém troca o próprio papel ('self_change_not_allowed'); tirar o último Admin:
-- 'last_platform_admin'.

CREATE FUNCTION platform_staff_set_role(p_user_id uuid, p_role platform_role)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_role platform_role;
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_staff_set_role: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_user_id = app_current_user() THEN
      RAISE EXCEPTION 'self_change_not_allowed' USING ERRCODE = 'check_violation';
    END IF;

    PERFORM platform_lock_admins();
    SELECT u.platform_role INTO v_role
    FROM users u
    WHERE u.id = p_user_id AND u.platform_role IS NOT NULL AND u.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_staff_set_role: pessoa fora da equipe'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_role = 'admin' AND p_role <> 'admin' THEN
      PERFORM platform_require_other_admin(p_user_id);
    END IF;

    UPDATE users u SET platform_role = p_role WHERE u.id = p_user_id;
    PERFORM platform_record_audit(NULL, 'staff.role_change', 'staff', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_staff_set_role(uuid, platform_role) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_staff_set_role(uuid, platform_role) TO app_user;
--> statement-breakpoint

-- ── P6: remove da equipe ──
-- Tira o platform_role; a conta continua e as linhas de auditoria com o nome dela ficam. Mesmas
-- travas da troca de papel.

CREATE FUNCTION platform_staff_remove(p_user_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_role platform_role;
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_staff_remove: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_user_id = app_current_user() THEN
      RAISE EXCEPTION 'self_change_not_allowed' USING ERRCODE = 'check_violation';
    END IF;

    PERFORM platform_lock_admins();
    SELECT u.platform_role INTO v_role
    FROM users u
    WHERE u.id = p_user_id AND u.platform_role IS NOT NULL AND u.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_staff_remove: pessoa fora da equipe'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_role = 'admin' THEN
      PERFORM platform_require_other_admin(p_user_id);
    END IF;

    UPDATE users u SET platform_role = NULL WHERE u.id = p_user_id;
    PERFORM platform_record_audit(NULL, 'staff.remove', 'staff', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_staff_remove(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_staff_remove(uuid) TO app_user;
--> statement-breakpoint

-- ── P7: auditoria (só o admin da plataforma) ──
-- Filtros opcionais (nulo: todos): prefeitura, pessoa da equipe e período em datas de Brasília,
-- com p_to inclusivo. A prefeitura filtrada deixa de fora as linhas sem prefeitura. Da mais
-- recente para a mais antiga; total é o número de linhas com os filtros, antes da página (sem
-- linha na página, a API responde total 0). O rótulo do alvo é resolvido agora, nunca guardado:
-- nome da equipe, categoria ou setor; protocolo da solicitação mais antiga da ocorrência (a da
-- atividade, para work_order); nome da conta ou 'Conta excluída'; nome de exibição da prefeitura;
-- 'Nome — UF' do município; '—' sem alvo ou alvo que já não existe.

CREATE FUNCTION platform_audit_events(
  p_tenant_id uuid,
  p_staff_user_id uuid,
  p_from date,
  p_to date,
  p_limit integer,
  p_offset integer
)
  RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    staff_name text,
    tenant_id uuid,
    tenant_name text,
    action text,
    target_type text,
    target_label text,
    total bigint
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'platform_audit_events: só o admin da plataforma'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH page AS (
      SELECT e.*, count(*) OVER () AS total
      FROM staff_audit_events e
      WHERE (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
        AND (p_staff_user_id IS NULL OR e.staff_user_id = p_staff_user_id)
        AND (p_from IS NULL OR e.created_at >= p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND (
          p_to IS NULL
          OR e.created_at < (p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
        )
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT p_limit OFFSET p_offset
    )
    SELECT
      p.id,
      p.created_at,
      s.name,
      p.tenant_id,
      t.display_name,
      p.action,
      p.target_type,
      coalesce(
        CASE
          WHEN p.target_type = 'team' THEN (
            SELECT tm.name FROM teams tm WHERE tm.tenant_id = p.tenant_id AND tm.id = p.target_id
          )
          WHEN p.target_type = 'category' THEN (
            SELECT c.name FROM categories c WHERE c.tenant_id = p.tenant_id AND c.id = p.target_id
          )
          WHEN p.target_type = 'department' THEN (
            SELECT d.name FROM departments d
            WHERE d.tenant_id = p.tenant_id AND d.id = p.target_id
          )
          WHEN p.target_type = 'occurrence' THEN (
            SELECT r.protocol FROM requests r
            WHERE r.tenant_id = p.tenant_id AND r.occurrence_id = p.target_id
            ORDER BY r.created_at, r.id
            LIMIT 1
          )
          WHEN p.target_type = 'work_order' THEN (
            SELECT r.protocol
            FROM work_orders w
            JOIN requests r ON r.tenant_id = w.tenant_id AND r.occurrence_id = w.occurrence_id
            WHERE w.tenant_id = p.tenant_id AND w.id = p.target_id
            ORDER BY r.created_at, r.id
            LIMIT 1
          )
          WHEN p.target_type IN ('agent', 'manager', 'staff', 'user') THEN (
            SELECT CASE WHEN u.deleted_at IS NOT NULL THEN 'Conta excluída' ELSE u.name END
            FROM users u WHERE u.id = p.target_id
          )
          WHEN p.target_type = 'tenant' THEN (
            SELECT tt.display_name FROM tenants tt WHERE tt.id = p.target_id
          )
          WHEN p.target_type = 'municipality' THEN (
            SELECT m.name || ' — ' || m.state
            FROM municipalities m WHERE m.ibge_code = p.details ->> 'ibgeCode'
          )
        END,
        '—'
      ),
      p.total
    FROM page p
    JOIN users s ON s.id = p.staff_user_id
    LEFT JOIN tenants t ON t.id = p.tenant_id
    ORDER BY p.created_at DESC, p.id DESC;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_audit_events(uuid, uuid, date, date, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_audit_events(uuid, uuid, date, date, integer, integer) TO app_user;
--> statement-breakpoint

-- ── Conta congelada com o CPF preso (equipe interna) ──
-- A conta antiga só volta para quem provar o e-mail dela (a API confere o código antes de chamar
-- a recuperação); liberar o CPF nunca dá acesso a ela, que continua congelada. p_tenant_id é a
-- prefeitura do modo suporte, nulo na P2 e na P6: vai só para a auditoria.

CREATE FUNCTION platform_frozen_account_by_cpf(p_cpf text)
  RETURNS TABLE (user_id uuid, email text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    PERFORM platform_require_staff('platform_frozen_account_by_cpf');

    RETURN QUERY
    SELECT u.id, u.email
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'frozen' AND u.deleted_at IS NULL;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_frozen_account_by_cpf(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_frozen_account_by_cpf(text) TO app_user;
--> statement-breakpoint

-- Descongela com o e-mail novo e revoga as sessões antigas. last_active_at vai a agora, para a
-- conta não ser congelada de novo como parada. O número que congelou a conta já é de outra conta
-- ativa: a recuperada fica sem número (entra pelo CPF e e-mail; troca o número no Perfil). E-mail
-- de outra conta cai em users_email_lower_idx (23505).

CREATE FUNCTION platform_recover_frozen_account(p_user_id uuid, p_email text, p_tenant_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM platform_require_staff('platform_recover_frozen_account');

    PERFORM 1 FROM users u
    WHERE u.id = p_user_id AND u.account_status = 'frozen' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_recover_frozen_account: conta congelada inexistente'
        USING ERRCODE = 'no_data_found';
    END IF;

    UPDATE users u
    SET account_status = 'active',
        last_active_at = now(),
        email = p_email,
        phone = CASE
          WHEN EXISTS (
            SELECT 1 FROM users o
            WHERE o.phone = u.phone AND o.account_status = 'active' AND o.id <> u.id
          ) THEN NULL
          ELSE u.phone
        END
    WHERE u.id = p_user_id;

    UPDATE sessions s SET revoked_at = now()
    WHERE s.user_id = p_user_id AND s.revoked_at IS NULL;

    PERFORM platform_record_audit(p_tenant_id, 'account.recover', 'user', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_recover_frozen_account(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_recover_frozen_account(uuid, text, uuid) TO app_user;
--> statement-breakpoint

-- Tira o CPF da conta congelada, que continua congelada; o cadastro segue com uma conta nova.

CREATE FUNCTION platform_release_frozen_cpf(p_cpf text, p_tenant_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    PERFORM platform_require_staff('platform_release_frozen_cpf');

    UPDATE users u SET cpf = NULL
    WHERE u.cpf = p_cpf AND u.account_status = 'frozen' AND u.deleted_at IS NULL
    RETURNING u.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'platform_release_frozen_cpf: conta congelada inexistente'
        USING ERRCODE = 'no_data_found';
    END IF;

    PERFORM platform_record_audit(p_tenant_id, 'account.release_cpf', 'user', v_id, NULL);
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_release_frozen_cpf(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_release_frozen_cpf(text, uuid) TO app_user;
--> statement-breakpoint

-- ── Exclusão da própria conta (substitui a da 0014) ──
-- Além do que a 0014 faz: apaga o interesse por cidade, tira o papel na equipe interna (o último
-- Admin não exclui: 'last_platform_admin', com a trava de platform_lock_admins) e deixa de guardar
-- installation_id nas sessões, que ficam todas revogadas.

CREATE OR REPLACE FUNCTION account_delete()
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := app_current_user();
    v_phone text;
    v_email text;
    v_role platform_role;
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'account_delete: sem usuário no contexto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- A trava vem antes da linha da conta, na mesma ordem da troca de papel e da remoção.
    IF EXISTS (SELECT 1 FROM users u WHERE u.id = v_user AND u.platform_role IS NOT NULL) THEN
      PERFORM platform_lock_admins();
    END IF;

    -- Guarda telefone e e-mail antes de apagá-los, para limpar os códigos enviados a eles.
    SELECT u.phone, u.email, u.platform_role INTO v_phone, v_email, v_role
    FROM users u WHERE u.id = v_user AND u.deleted_at IS NULL
    FOR UPDATE;

    IF v_role = 'admin' THEN
      PERFORM platform_require_other_admin(v_user);
    END IF;

    UPDATE users u
    SET name = 'Conta excluída',
        email = NULL,
        phone = NULL,
        cpf = NULL,
        platform_role = NULL,
        account_status = 'frozen',
        deleted_at = now()
    WHERE u.id = v_user AND u.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_delete: conta inexistente ou já excluída'
        USING ERRCODE = 'no_data_found';
    END IF;

    UPDATE sessions s
    SET revoked_at = coalesce(s.revoked_at, now()),
        installation_id = NULL
    WHERE s.user_id = v_user;

    DELETE FROM devices d WHERE d.user_id = v_user;

    DELETE FROM verification_codes vc
    WHERE vc.user_id = v_user
      OR (v_phone IS NOT NULL AND vc.target = v_phone)
      OR (v_email IS NOT NULL AND lower(vc.target) = lower(v_email));

    DELETE FROM city_interest ci WHERE ci.user_id = v_user;

    UPDATE memberships m SET status = 'inactive'
    WHERE m.user_id = v_user AND m.status <> 'inactive';
  END;
  $$;
--> statement-breakpoint

-- ── Cadastro de agente e gestor pelo painel (substitui as da 0024) ──
-- Conta da equipe interna (platform_role) não vira agente nem gestor: check_violation
-- 'staff_account_not_allowed', como platform_find_or_create_tenant_admin. Quem saiu da equipe pode.

CREATE OR REPLACE FUNCTION panel_find_or_create_agent_user(p_name text, p_phone text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_agent_user', false);

    SELECT u.id, u.platform_role INTO v_id, v_platform_role
    FROM users u
    WHERE u.phone = p_phone AND u.account_status = 'active' AND u.deleted_at IS NULL;
    IF v_platform_role IS NOT NULL THEN
      RAISE EXCEPTION 'staff_account_not_allowed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO users (name, phone) VALUES (p_name, p_phone)
      RETURNING users.id INTO v_id;
    END IF;
    RETURN v_id;
  END;
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION panel_find_or_create_manager_user(p_name text, p_cpf text, p_email text)
  RETURNS TABLE (id uuid, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_email text;
    v_platform_role platform_role;
  BEGIN
    PERFORM panel_require_manager('panel_find_or_create_manager_user', true);

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

-- ── Trocas no modo suporte (substitui as da 0024) ──
-- A equipe interna (app_is_platform_staff) troca o celular de agente com vínculo em outra
-- prefeitura ou com acesso de gestão, e o e-mail de gestor com outro painel ou admin. Continuam
-- recusados para todos: agente que já entrou no app (troca no Perfil) e conta da equipe interna.

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
    IF v_last_active IS NOT NULL OR v_platform_role IS NOT NULL OR (
      NOT app_is_platform_staff() AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = p_user_id
          AND (m.tenant_id <> app_current_tenant() OR m.role IN ('manager', 'tenant_admin'))
      )
    ) THEN
      RAISE EXCEPTION 'phone_change_not_allowed'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users u SET phone = p_phone WHERE u.id = p_user_id;
  END;
  $$;
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
    IF v_platform_role IS NOT NULL OR (
      NOT app_is_platform_staff() AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = p_user_id
          AND (
            (m.tenant_id <> app_current_tenant() AND m.role IN ('manager', 'tenant_admin'))
            OR (m.tenant_id = app_current_tenant() AND m.role = 'tenant_admin')
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

-- ── Tempo médio até a conclusão (substitui a da 0024) ──
-- Cada solicitação conta uma vez, pelo evento awaiting_confirmation mais recente dela nos últimos
-- 30 dias: a republicação depois de uma devolução não pesa em dobro.

CREATE OR REPLACE FUNCTION platform_avg_resolution_days(p_tenant_id uuid)
  RETURNS numeric
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT round(avg(extract(epoch FROM latest.published_at - r.created_at) / 86400)::numeric, 1)
    FROM (
      SELECT se.tenant_id, se.request_id, max(se.created_at) AS published_at
      FROM status_events se
      WHERE se.to_status = 'awaiting_confirmation'
        AND se.request_id IS NOT NULL
        AND se.created_at >= now() - interval '30 days'
      GROUP BY se.tenant_id, se.request_id
    ) latest
    JOIN requests r ON r.tenant_id = latest.tenant_id AND r.id = latest.request_id
    JOIN tenants t ON t.id = latest.tenant_id
    WHERE CASE WHEN p_tenant_id IS NULL THEN t.status = 'active' ELSE t.id = p_tenant_id END
  $$;
