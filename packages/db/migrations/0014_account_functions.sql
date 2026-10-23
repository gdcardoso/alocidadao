-- Conta: cada um altera só a própria conta; telefone, exclusão, congelamento do número
-- reaproveitado e ativação de convites passam por funções (ver
-- docs/decisoes/0001-isolamento-por-prefeitura.md, seção "Acesso").
-- As funções SECURITY DEFINER rodam como o dono, que precisa de BYPASSRLS (ou ser
-- superusuário): memberships, sessions e devices têm FORCE e nenhuma política para ele.

-- ── users: escrita só na própria conta (substitui a regra da 0011) ──
-- O suporte deixa de alterar contas por UPDATE direto; o cadastro pelo gestor e as
-- correções do suporte terão funções próprias.

DROP POLICY users_update ON users;
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO app_user
  USING (id = app_current_user())
  WITH CHECK (id = app_current_user());
--> statement-breakpoint
-- Telefone só muda por account_change_phone, depois de a API conferir o código.
-- O CPF não muda por enquanto.
REVOKE UPDATE (phone, cpf) ON users FROM app_user;
--> statement-breakpoint

-- ── Troca de número da própria conta ──
-- Telefone já usado por outra conta ativa cai em users_phone_active_idx (23505).

CREATE FUNCTION account_change_phone(p_phone text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := app_current_user();
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'account_change_phone: sem usuário no contexto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE users u SET phone = p_phone
    WHERE u.id = v_user AND u.account_status = 'active' AND u.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_change_phone: conta inexistente ou inativa'
        USING ERRCODE = 'no_data_found';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION account_change_phone(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account_change_phone(text) TO app_user;
--> statement-breakpoint

-- ── Exclusão da própria conta ──
-- A linha fica (as solicitações continuam com a prefeitura): congelada, com deleted_at e
-- sem dados pessoais. Sessões revogadas, aparelhos apagados, vínculos inativos. Os códigos
-- de verificação também saem: o destino (telefone ou e-mail) reidentificaria a conta.

CREATE FUNCTION account_delete()
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := app_current_user();
    v_phone text;
    v_email text;
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'account_delete: sem usuário no contexto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Guarda telefone e e-mail antes de apagá-los, para limpar os códigos enviados a eles.
    SELECT u.phone, u.email INTO v_phone, v_email
    FROM users u WHERE u.id = v_user AND u.deleted_at IS NULL
    FOR UPDATE;

    UPDATE users u
    SET name = 'Conta excluída',
        email = NULL,
        phone = NULL,
        cpf = NULL,
        account_status = 'frozen',
        deleted_at = now()
    WHERE u.id = v_user AND u.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_delete: conta inexistente ou já excluída'
        USING ERRCODE = 'no_data_found';
    END IF;

    UPDATE sessions s SET revoked_at = now()
    WHERE s.user_id = v_user AND s.revoked_at IS NULL;

    DELETE FROM devices d WHERE d.user_id = v_user;

    DELETE FROM verification_codes vc
    WHERE vc.user_id = v_user
      OR (v_phone IS NOT NULL AND vc.target = v_phone)
      OR (v_email IS NOT NULL AND lower(vc.target) = lower(v_email));

    UPDATE memberships m SET status = 'inactive'
    WHERE m.user_id = v_user AND m.status <> 'inactive';
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION account_delete() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account_delete() TO app_user;
--> statement-breakpoint

-- ── Número reaproveitado: congela a conta antiga ao criar a nova ──
-- Exceção à regra "só a própria conta": recebe o id da conta antiga, mas só congela se ela
-- está ativa, tem esse telefone e está parada (90 dias). Exige contexto de usuário, que é
-- a conta nova sendo criada na mesma transação.

CREATE FUNCTION auth_freeze_stale_account(p_user_id uuid, p_phone text)
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
    RETURN true;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_freeze_stale_account(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_freeze_stale_account(uuid, text) TO app_user;
--> statement-breakpoint

-- ── Convites: ao entrar, os vínculos invited da própria conta passam a active ──

CREATE FUNCTION account_activate_invitations()
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := app_current_user();
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'account_activate_invitations: sem usuário no contexto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE memberships m SET status = 'active'
    WHERE m.user_id = v_user AND m.status = 'invited';
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION account_activate_invitations() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account_activate_invitations() TO app_user;
