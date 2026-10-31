-- Correções da validação (Plano pronto-para-validacao, tarefa 11).

-- ── Recuperar conta congelada com o CPF já liberado ──
-- O código pode ter sido pedido antes de o CPF ser liberado: recuperar tiraria o número de uma conta
-- sem CPF e estouraria users_phone_or_cpf_check (500). Sem CPF a conta não é mais recuperável:
-- a busca não a acha e a API responde invalid_code. Substitui a função da 0030 (mesmos atributos
-- e grants da 0026).

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

    PERFORM platform_record_audit(p_tenant_id, 'account.recover', 'user', p_user_id, NULL);
  END;
  $$;
--> statement-breakpoint

-- ── Pegada da fila: confere de novo a equipe nos avisos work_order_* ──
-- Além da conta ativa, quem saiu da equipe da atividade ou perdeu o vínculo de agente depois de o
-- aviso entrar na fila não recebe: a linha vai a 'skipped' (last_error 'not_in_team'). Substitui a
-- função da 0034 (mesmos atributos e grants).

CREATE OR REPLACE FUNCTION notification_claim_batch(p_limit int)
  RETURNS TABLE (
    id uuid,
    channel text,
    kind text,
    protocol text,
    tenant_id uuid,
    request_id uuid,
    work_order_id uuid,
    details jsonb,
    attempts int,
    push_tokens jsonb,
    email text
  )
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    WITH picked AS (
      SELECT o.id,
        (u.account_status = 'active' AND u.deleted_at IS NULL) AS account_ok,
        -- Atividade da equipe: a pessoa ainda precisa ser agente ativo da prefeitura e estar na
        -- equipe da atividade (pode ter saído depois de o aviso entrar na fila).
        (
          o.kind NOT LIKE 'work\_order\_%'
          OR EXISTS (
            SELECT 1
            FROM work_orders wo
            JOIN team_members tm ON tm.team_id = wo.team_id AND tm.tenant_id = wo.tenant_id
            JOIN memberships m ON m.tenant_id = wo.tenant_id AND m.user_id = tm.user_id
            WHERE wo.id = o.work_order_id
              AND wo.tenant_id = o.tenant_id
              AND tm.user_id = o.user_id
              AND m.role = 'field_agent'
              AND m.status = 'active'
          )
        ) AS team_ok
      FROM notification_outbox o
      JOIN users u ON u.id = o.user_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= now()
      ORDER BY o.next_attempt_at, o.id
      LIMIT p_limit
      FOR UPDATE OF o SKIP LOCKED
    ),
    skipped AS (
      UPDATE notification_outbox o
      SET status = 'skipped',
          last_error = CASE WHEN NOT p.account_ok THEN 'account_unavailable' ELSE 'not_in_team' END
      FROM picked p
      WHERE o.id = p.id AND NOT (p.account_ok AND p.team_ok)
      RETURNING o.id
    ),
    claimed AS (
      UPDATE notification_outbox o
      SET attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
      FROM picked p
      WHERE o.id = p.id AND p.account_ok AND p.team_ok
      RETURNING o.*
    )
    SELECT c.id, c.channel, c.kind, c.protocol, c.tenant_id, c.request_id, c.work_order_id,
      c.details, c.attempts,
      COALESCE(
        (
          SELECT jsonb_agg(DISTINCT jsonb_build_object('platform', d.platform, 'token', d.push_token))
          FROM devices d
          WHERE d.user_id = c.user_id AND d.push_token IS NOT NULL
        ),
        '[]'::jsonb
      ),
      u.email
    FROM claimed c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at, c.id
  $$;
--> statement-breakpoint

-- ── Sessão morta no servidor: apaga o token de push do aparelho ──
-- Renovação com o token de uma sessão já revogada ou expirada (revogada no servidor, ou logout
-- feito offline): o aparelho da sessão deixa de receber push. Sessão ainda válida não é tocada.
-- Roda como o dono: a renovação não tem pessoa no contexto.

CREATE FUNCTION auth_clear_push_for_dead_session(p_token_hash text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE devices d SET push_token = NULL
    FROM sessions s
    WHERE s.refresh_token_hash = p_token_hash
      AND (s.revoked_at IS NOT NULL OR (s.expires_at IS NOT NULL AND s.expires_at <= now()))
      AND s.installation_id IS NOT NULL
      AND d.user_id = s.user_id
      AND d.installation_id = s.installation_id
      AND d.push_token IS NOT NULL
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_clear_push_for_dead_session(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_clear_push_for_dead_session(text) TO app_user;
