-- Funções da fila de avisos, dos aparelhos e do agendador (Plano 7). A API conecta como app_user,
-- que não lê a fila (notification_outbox, sem GRANT) nem os aparelhos de outras pessoas (devices,
-- RLS só dos próprios): tudo roda como o dono, em SECURITY DEFINER.

-- ── Pegada de um lote da fila ──
-- Linhas pendentes vencidas, com FOR UPDATE SKIP LOCKED: duas instâncias nunca pegam a mesma.
-- Quem pega soma a tentativa e trava a linha por 10 minutos (next_attempt_at), o tempo de enviar
-- e chamar notification_finish; se a instância cair no meio, a linha volta sozinha depois disso.
-- Conta congelada ou excluída: a linha vai a 'skipped' e não volta.
-- push_tokens: {platform, token} distintos dos aparelhos da pessoa com token.

CREATE FUNCTION notification_claim_batch(p_limit int)
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
      SELECT o.id, (u.account_status = 'active' AND u.deleted_at IS NULL) AS reachable
      FROM notification_outbox o
      JOIN users u ON u.id = o.user_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= now()
      ORDER BY o.next_attempt_at, o.id
      LIMIT p_limit
      FOR UPDATE OF o SKIP LOCKED
    ),
    skipped AS (
      UPDATE notification_outbox o
      SET status = 'skipped', last_error = 'account_unavailable'
      FROM picked p
      WHERE o.id = p.id AND NOT p.reachable
      RETURNING o.id
    ),
    claimed AS (
      UPDATE notification_outbox o
      SET attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
      FROM picked p
      WHERE o.id = p.id AND p.reachable
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
REVOKE ALL ON FUNCTION notification_claim_batch(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_claim_batch(int) TO app_user;
--> statement-breakpoint

-- ── Resultado do envio ──
-- 'sent', 'skipped' ou 'failed' finalizam a linha; 'pending' a devolve à fila daqui a
-- p_retry_in_seconds (quem decide a espera e a última tentativa é o envio da API). Só mexe em linha
-- ainda pendente: uma resposta atrasada não reabre o que já foi finalizado.

CREATE FUNCTION notification_finish(
  p_id uuid,
  p_status text,
  p_retry_in_seconds int,
  p_error text
)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_status = 'pending' THEN
      IF p_retry_in_seconds IS NULL OR p_retry_in_seconds < 0 THEN
        RAISE EXCEPTION 'invalid_retry' USING ERRCODE = '22023';
      END IF;
      UPDATE notification_outbox o
      SET next_attempt_at = now() + p_retry_in_seconds * interval '1 second',
        last_error = p_error
      WHERE o.id = p_id AND o.status = 'pending';
    ELSIF p_status IN ('sent', 'skipped', 'failed') THEN
      UPDATE notification_outbox o
      SET status = p_status,
        last_error = p_error,
        sent_at = CASE WHEN p_status = 'sent' THEN now() END
      WHERE o.id = p_id AND o.status = 'pending';
    ELSE
      RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_finish(uuid, text, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_finish(uuid, text, int, text) TO app_user;
--> statement-breakpoint

-- ── Tokens dos aparelhos ──
-- Token recusado pelo provedor (inválido, app desinstalado): sai de todos os aparelhos.

CREATE FUNCTION device_clear_push_token(p_token text)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE devices d SET push_token = NULL WHERE d.push_token = p_token
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION device_clear_push_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_clear_push_token(text) TO app_user;
--> statement-breakpoint

-- Registro do token pelo app: o token passa a ser só do aparelho atual. Tira-o de todos os registros
-- (de outras contas e de outros aparelhos da mesma conta); a API grava o token no aparelho atual em
-- seguida, na mesma transação, pelo RLS. Exige a pessoa no contexto (app_current_user()).

CREATE FUNCTION device_claim_push_token(p_token text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'no_user' USING ERRCODE = '42501';
    END IF;
    UPDATE devices d SET push_token = NULL WHERE d.push_token = p_token;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION device_claim_push_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_claim_push_token(text) TO app_user;
--> statement-breakpoint

-- ── Confirmação automática ──
-- Solicitação aguardando confirmação há 7 dias (AUTO_CONFIRM_AFTER_DAYS, packages/shared,
-- request-status.ts; ação 'auto_confirm', ator 'system') vai a 'completed' com evento sem ator. A
-- ocorrência fecha ('close': awaiting_confirmation → completed) com evento próprio só se nenhuma
-- outra solicitação dela ainda aguarda, como a confirmação do cidadão (apps/api/src/citizen/
-- requests.ts). Trava a ocorrência antes da solicitação, na mesma ordem da API, com SKIP LOCKED:
-- o que estiver ocupado fica para a próxima rodada. O gatilho dos avisos ignora a conclusão para
-- o cidadão e o evento só da ocorrência: nada vai à fila nem ao sino. Devolve quantas confirmou.

CREATE FUNCTION auto_confirm_requests()
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_candidate record;
    v_occurrence_status occurrence_status;
    v_count int := 0;
  BEGIN
    FOR v_candidate IN
      SELECT r.id, r.tenant_id, r.occurrence_id
      FROM requests r
      WHERE r.status = 'awaiting_confirmation'
        AND r.status_changed_at <= now() - interval '7 days'
      ORDER BY r.status_changed_at, r.id
    LOOP
      SELECT o.status INTO v_occurrence_status
      FROM occurrences o
      WHERE o.tenant_id = v_candidate.tenant_id AND o.id = v_candidate.occurrence_id
      FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      PERFORM 1 FROM requests r WHERE r.id = v_candidate.id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      -- Relida depois da trava: outra rodada ou o cidadão podem ter agido antes.
      UPDATE requests r
      SET status = 'completed', status_changed_at = now(), updated_at = now()
      WHERE r.id = v_candidate.id
        AND r.occurrence_id = v_candidate.occurrence_id
        AND r.status = 'awaiting_confirmation'
        AND r.status_changed_at <= now() - interval '7 days';
      CONTINUE WHEN NOT FOUND;

      INSERT INTO status_events (tenant_id, occurrence_id, request_id, from_status, to_status)
      VALUES (v_candidate.tenant_id, v_candidate.occurrence_id, v_candidate.id,
        'awaiting_confirmation', 'completed');
      v_count := v_count + 1;

      IF v_occurrence_status = 'awaiting_confirmation' AND NOT EXISTS (
        SELECT 1 FROM requests r
        WHERE r.tenant_id = v_candidate.tenant_id
          AND r.occurrence_id = v_candidate.occurrence_id
          AND r.id <> v_candidate.id
          AND r.status = 'awaiting_confirmation'
      ) THEN
        UPDATE occurrences o
        SET status = 'completed', updated_at = now()
        WHERE o.tenant_id = v_candidate.tenant_id AND o.id = v_candidate.occurrence_id;
        INSERT INTO status_events (tenant_id, occurrence_id, from_status, to_status)
        VALUES (v_candidate.tenant_id, v_candidate.occurrence_id, 'awaiting_confirmation',
          'completed');
      END IF;
    END LOOP;
    RETURN v_count;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auto_confirm_requests() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auto_confirm_requests() TO app_user;
--> statement-breakpoint

-- ── Limpeza ──
-- Avisos do sino com mais de 90 dias; linhas finalizadas da fila (sent, failed, skipped) com mais
-- de 30 dias. Pendentes ficam, qualquer que seja a idade.

CREATE FUNCTION notification_cleanup()
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    DELETE FROM panel_notifications p WHERE p.created_at < now() - interval '90 days';
    DELETE FROM notification_outbox o
    WHERE o.status IN ('sent', 'failed', 'skipped')
      AND o.created_at < now() - interval '30 days';
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_cleanup() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_cleanup() TO app_user;
