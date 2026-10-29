-- Gatilho dos avisos (Plano 7): cada linha nova de status_events vira avisos na fila de envio
-- (notification_outbox: push e, na conclusão para o cidadão, e-mail) e no sino do painel
-- (panel_notifications). As regras são as "Regras do gatilho" do plano:
-- - Evento de solicitação (request_id sem work_order_id):
--   - cidadão dono: com from_status, ator diferente do dono e to_status diferente de 'completed',
--     o tipo sai de to_status (in_progress, rejected, awaiting_confirmation com e-mail, open);
--   - sino: ocorrência nova (from nulo, 'open', só esta solicitação na ocorrência), contestação
--     (awaiting_confirmation → open pelo dono) e cancelamento pelo dono.
-- - Evento de atividade (work_order_id): agentes da equipe na atribuição/repasse (from nulo →
--   assigned) e no pedido de ajuste; sino na conclusão (com details.withPhotos) e no impedimento.
--   Reagendar (impeded → assigned) não avisa. Protocolo: o da solicitação mais antiga.
-- - Evento só da ocorrência: nada.
-- Destinatários com conta ativa e não excluída; quem agiu (actor_user_id) nunca recebe.
-- SECURITY DEFINER: quem grava o evento (cidadão, agente, gestor) não enxerga os vínculos, a
-- equipe nem a fila pelo RLS. Tudo é filtrado pela prefeitura do evento.

CREATE FUNCTION notify_from_status_event()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_citizen_id uuid;
    v_protocol text;
    v_kind text;
    v_bell_kind text;
    v_bell_details jsonb;
  BEGIN
    IF NEW.work_order_id IS NOT NULL THEN
      -- Protocolo da atividade: o da solicitação mais antiga da ocorrência (como a lista do agente).
      SELECT r.protocol INTO v_protocol
      FROM requests r
      WHERE r.tenant_id = NEW.tenant_id AND r.occurrence_id = NEW.occurrence_id
      ORDER BY r.created_at, r.id
      LIMIT 1;
      IF v_protocol IS NULL THEN
        RETURN NULL;
      END IF;

      IF NEW.from_status IS NULL AND NEW.to_status = 'assigned' THEN
        v_kind := 'work_order_assigned';
      ELSIF NEW.to_status = 'rework_requested' THEN
        v_kind := 'work_order_rework';
      END IF;
      IF v_kind IS NOT NULL THEN
        INSERT INTO notification_outbox (tenant_id, user_id, channel, kind, protocol, work_order_id)
        SELECT NEW.tenant_id, tm.user_id, 'push', v_kind, v_protocol, NEW.work_order_id
        FROM work_orders wo
        JOIN team_members tm ON tm.tenant_id = wo.tenant_id AND tm.team_id = wo.team_id
        JOIN users u ON u.id = tm.user_id
        WHERE wo.tenant_id = NEW.tenant_id
          AND wo.id = NEW.work_order_id
          AND u.account_status = 'active'
          AND u.deleted_at IS NULL
          AND tm.user_id IS DISTINCT FROM NEW.actor_user_id
          AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.tenant_id = NEW.tenant_id
              AND m.user_id = tm.user_id
              AND m.role = 'field_agent'
              AND m.status = 'active'
          );
      END IF;

      IF NEW.to_status = 'awaiting_review' THEN
        v_bell_kind := 'work_order_completed';
        -- As fotos da conclusão entram antes do evento, na mesma transação (now() é o início dela).
        v_bell_details := jsonb_build_object('withPhotos', EXISTS (
          SELECT 1 FROM photos p
          WHERE p.tenant_id = NEW.tenant_id
            AND p.work_order_id = NEW.work_order_id
            AND p.purpose = 'completion'
            AND p.created_at = now()
        ));
      ELSIF NEW.to_status = 'impeded' THEN
        v_bell_kind := 'work_order_impeded';
      END IF;

    ELSIF NEW.request_id IS NOT NULL THEN
      SELECT r.citizen_id, r.protocol INTO v_citizen_id, v_protocol
      FROM requests r
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id;
      IF v_protocol IS NULL THEN
        RETURN NULL;
      END IF;

      IF NEW.from_status IS NOT NULL
        AND NEW.actor_user_id IS DISTINCT FROM v_citizen_id
        AND NEW.to_status <> 'completed' THEN
        v_kind := CASE NEW.to_status
          WHEN 'in_progress' THEN 'request_in_progress'
          WHEN 'rejected' THEN 'request_rejected'
          WHEN 'awaiting_confirmation' THEN 'request_awaiting_confirmation'
          WHEN 'open' THEN 'request_reopened'
        END;
      END IF;
      IF v_kind IS NOT NULL THEN
        INSERT INTO notification_outbox (tenant_id, user_id, channel, kind, protocol, request_id)
        SELECT NEW.tenant_id, u.id, c.channel, v_kind, v_protocol, NEW.request_id
        FROM users u
        CROSS JOIN (VALUES ('push'), ('email')) AS c(channel)
        WHERE u.id = v_citizen_id
          AND u.account_status = 'active'
          AND u.deleted_at IS NULL
          AND (c.channel = 'push' OR v_kind = 'request_awaiting_confirmation');
      END IF;

      IF NEW.from_status IS NULL AND NEW.to_status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM requests r
          WHERE r.tenant_id = NEW.tenant_id
            AND r.occurrence_id = NEW.occurrence_id
            AND r.id <> NEW.request_id
        ) THEN
        v_bell_kind := 'occurrence_new';
      ELSIF NEW.from_status = 'awaiting_confirmation' AND NEW.to_status = 'open'
        AND NEW.actor_user_id = v_citizen_id THEN
        v_bell_kind := 'request_contested';
      ELSIF NEW.to_status = 'cancelled' AND NEW.actor_user_id = v_citizen_id THEN
        v_bell_kind := 'request_cancelled';
      END IF;
    END IF;

    -- Sino: admins ativos e gestores ativos do setor da categoria da ocorrência; uma linha por pessoa.
    IF v_bell_kind IS NOT NULL THEN
      INSERT INTO panel_notifications
        (tenant_id, user_id, kind, protocol, occurrence_id, work_order_id, details)
      SELECT NEW.tenant_id, u.id, v_bell_kind, v_protocol, NEW.occurrence_id, NEW.work_order_id,
        v_bell_details
      FROM users u
      WHERE u.account_status = 'active'
        AND u.deleted_at IS NULL
        AND u.id IS DISTINCT FROM NEW.actor_user_id
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.tenant_id = NEW.tenant_id
            AND m.user_id = u.id
            AND m.status = 'active'
            AND (
              m.role = 'tenant_admin'
              OR (
                m.role = 'manager'
                AND EXISTS (
                  SELECT 1
                  FROM occurrences o
                  JOIN categories cat ON cat.tenant_id = o.tenant_id AND cat.id = o.category_id
                  JOIN department_managers dm
                    ON dm.tenant_id = cat.tenant_id AND dm.department_id = cat.department_id
                  WHERE o.tenant_id = NEW.tenant_id
                    AND o.id = NEW.occurrence_id
                    AND dm.user_id = u.id
                )
              )
            )
        );
    END IF;

    RETURN NULL;
  END;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_from_status_event() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER status_events_notify
  AFTER INSERT ON status_events
  FOR EACH ROW EXECUTE FUNCTION notify_from_status_event();
