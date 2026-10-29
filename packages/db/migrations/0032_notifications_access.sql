-- Acesso às tabelas de avisos do Plano 7.
-- - panel_notifications (sino do painel): cada pessoa lê só os próprios avisos da prefeitura atual e
--   só pode marcar como lido (UPDATE de read_at). Quem cria e apaga é o gatilho/limpeza (funções).
-- - notification_outbox (fila de push e e-mail): sem GRANT para app_user; só funções SECURITY DEFINER.
--   RLS ligada e forçada sem política, como segunda barreira.

ALTER TABLE panel_notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE panel_notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY panel_notifications_own ON panel_notifications FOR ALL TO app_user
  USING (tenant_id = app_current_tenant() AND user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
--> statement-breakpoint
REVOKE ALL ON panel_notifications FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON panel_notifications TO app_user;
--> statement-breakpoint
GRANT UPDATE (read_at) ON panel_notifications TO app_user;
--> statement-breakpoint
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON notification_outbox FROM PUBLIC;
