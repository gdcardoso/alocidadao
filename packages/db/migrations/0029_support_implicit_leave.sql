-- Saída implícita do modo suporte (Plano 6b). Ao entrar no modo suporte e ao entrar no painel por
-- login, se o último evento support.* de quem chama for support.enter, grava um support.leave
-- naquela prefeitura com details {"reason": "implicit"} e devolve a prefeitura; senão, nulo.
-- SECURITY DEFINER: a leitura da auditoria é por prefeitura (0022), e o último evento da pessoa
-- pode estar em qualquer uma. Lê e grava só eventos de quem chama, nunca de outra pessoa.
-- O advisory lock por pessoa evita duas saídas para a mesma entrada em chamadas simultâneas.

CREATE FUNCTION platform_close_open_support()
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_action text;
    v_tenant_id uuid;
  BEGIN
    PERFORM platform_require_staff('platform_close_open_support');
    PERFORM pg_advisory_xact_lock(hashtextextended('support_session:' || app_current_user()::text, 0));

    SELECT e.action, e.tenant_id INTO v_action, v_tenant_id
    FROM staff_audit_events e
    WHERE e.staff_user_id = app_current_user()
      AND e.action IN ('support.enter', 'support.leave')
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1;

    IF v_action IS DISTINCT FROM 'support.enter' OR v_tenant_id IS NULL THEN
      RETURN NULL;
    END IF;

    PERFORM platform_record_audit(
      v_tenant_id, 'support.leave', 'tenant', v_tenant_id, '{"reason": "implicit"}'::jsonb
    );
    RETURN v_tenant_id;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_close_open_support() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_close_open_support() TO app_user;
