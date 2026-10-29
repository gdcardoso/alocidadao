-- Correções da revisão final do Plano 6b na conta congelada (substituem as funções da 0026).
-- - Recuperar sempre tira o número: a conta só congela porque o número foi para outra pessoa
--   (auth_freeze_stale_account), que pode ainda ter o chip mesmo depois de excluir a conta dela.
-- - Liberar o CPF de conta congelada sem número é recusado ('frozen_account_without_phone'): a conta
--   ficaria sem CPF e sem número (users_phone_or_cpf_check).
-- - Conta congelada de alguém da equipe interna (platform_role) só o admin recupera ou libera
--   ('admin_only').
-- - platform_open_support_tenant: a prefeitura do modo suporte aberto de quem chama, para a API
--   conferir a prefeitura que vai para a auditoria.

-- Descongela com o e-mail novo e revoga as sessões antigas. last_active_at vai a agora, para a
-- conta não ser congelada de novo como parada. A conta fica sempre sem número: ele foi reusado por
-- outra pessoa, que entraria nesta conta só com o SMS. A pessoa entra pelo CPF e e-mail e cadastra
-- o número de novo no Perfil (com verificação por SMS). E-mail de outra conta cai em
-- users_email_lower_idx (23505).

CREATE OR REPLACE FUNCTION platform_recover_frozen_account(p_user_id uuid, p_email text, p_tenant_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_platform_role platform_role;
  BEGIN
    PERFORM platform_require_staff('platform_recover_frozen_account');

    SELECT u.platform_role INTO v_platform_role
    FROM users u
    WHERE u.id = p_user_id AND u.account_status = 'frozen' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform_recover_frozen_account: conta congelada inexistente'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_platform_role IS NOT NULL AND NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'admin_only' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE users u
    SET account_status = 'active',
        last_active_at = now(),
        email = p_email,
        phone = NULL
    WHERE u.id = p_user_id;

    UPDATE sessions s SET revoked_at = now()
    WHERE s.user_id = p_user_id AND s.revoked_at IS NULL;

    PERFORM platform_record_audit(p_tenant_id, 'account.recover', 'user', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint

-- Tira o CPF da conta congelada, que continua congelada; o cadastro segue com uma conta nova.
-- Sem número, a conta ficaria sem CPF e sem número: recusa, sem mexer nela.

CREATE OR REPLACE FUNCTION platform_release_frozen_cpf(p_cpf text, p_tenant_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_phone text;
    v_platform_role platform_role;
  BEGIN
    PERFORM platform_require_staff('platform_release_frozen_cpf');

    SELECT u.id, u.phone, u.platform_role INTO v_id, v_phone, v_platform_role
    FROM users u
    WHERE u.cpf = p_cpf AND u.account_status = 'frozen' AND u.deleted_at IS NULL
    FOR UPDATE;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'platform_release_frozen_cpf: conta congelada inexistente'
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_platform_role IS NOT NULL AND NOT app_is_platform_admin() THEN
      RAISE EXCEPTION 'admin_only' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'frozen_account_without_phone' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users u SET cpf = NULL WHERE u.id = v_id;

    PERFORM platform_record_audit(p_tenant_id, 'account.release_cpf', 'user', v_id, NULL);
  END;
  $$;
--> statement-breakpoint

-- Prefeitura do modo suporte aberto de quem chama: a do último evento support.* dela, se for
-- support.enter; senão, nulo. Lê só eventos de quem chama (a leitura da auditoria é por prefeitura).

CREATE FUNCTION platform_open_support_tenant()
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_action text;
    v_tenant_id uuid;
  BEGIN
    PERFORM platform_require_staff('platform_open_support_tenant');

    SELECT e.action, e.tenant_id INTO v_action, v_tenant_id
    FROM staff_audit_events e
    WHERE e.staff_user_id = app_current_user()
      AND e.action IN ('support.enter', 'support.leave')
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1;

    IF v_action IS DISTINCT FROM 'support.enter' THEN
      RETURN NULL;
    END IF;
    RETURN v_tenant_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_open_support_tenant() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_open_support_tenant() TO app_user;
