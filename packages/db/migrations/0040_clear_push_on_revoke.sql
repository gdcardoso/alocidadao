-- Revogar sessões no servidor também apaga o token de push dos aparelhos da conta.
-- Substituem as funções da 0014 (congelar conta parada) e da 0039 (recuperar conta congelada),
-- com os mesmos atributos e grants.

CREATE OR REPLACE FUNCTION auth_freeze_stale_account(p_user_id uuid, p_phone text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'auth_freeze_stale_account: sem usuário no contexto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE users u SET account_status = 'frozen'
    WHERE u.id = p_user_id
      AND u.id <> app_current_user()
      AND u.phone = p_phone
      AND u.account_status = 'active'
      AND u.deleted_at IS NULL
      AND coalesce(u.last_active_at, u.created_at) <= now() - interval '90 days';
    IF NOT FOUND THEN
      RETURN false;
    END IF;

    UPDATE sessions s SET revoked_at = now()
    WHERE s.user_id = p_user_id AND s.revoked_at IS NULL;

    -- Sem sessão, sem push: a conta antiga não recebe mais avisos nos aparelhos.
    UPDATE devices d SET push_token = NULL WHERE d.user_id = p_user_id AND d.push_token IS NOT NULL;
    RETURN true;
  END;
  $$;
--> statement-breakpoint

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
      AND u.cpf IS NOT NULL
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

    -- Sem sessão, sem push: os aparelhos antigos deixam de receber avisos desta conta.
    UPDATE devices d SET push_token = NULL WHERE d.user_id = p_user_id AND d.push_token IS NOT NULL;

    PERFORM platform_record_audit(p_tenant_id, 'account.recover', 'user', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint

-- Chamável pelo app_user com o hash do token de renovação: seguro porque só age em sessão já
-- morta (revogada ou expirada), e quem tem o hash já é o dono do token daquele aparelho.
COMMENT ON FUNCTION auth_clear_push_for_dead_session(text) IS
  'Apaga o token de push do aparelho de uma sessão revogada ou expirada, pelo hash do token de renovação.';
