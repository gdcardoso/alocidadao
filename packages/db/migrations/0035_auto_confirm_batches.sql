-- Confirmação automática em lotes: no máximo 100 candidatas por chamada, para não segurar as
-- travas de toda a fila atrasada numa só transação. O agendador repete a chamada enquanto ela
-- devolver o tamanho do lote. O resto da função é igual ao da 0034 (SECURITY DEFINER, travas
-- com SKIP LOCKED, eventos, regra de fechar a ocorrência). Devolve quantas confirmou.

CREATE OR REPLACE FUNCTION auto_confirm_requests()
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
      LIMIT 100
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

-- Candidatas a confirmação automática sem varrer a tabela de solicitações.
CREATE INDEX requests_awaiting_confirmation_idx ON requests (status_changed_at)
  WHERE status = 'awaiting_confirmation';
