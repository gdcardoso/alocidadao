-- Isolamento por prefeitura (mesmo padrão da migração 0002).
ALTER TABLE occurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE occurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON occurrences FOR ALL TO app_user
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON occurrences TO app_user;
--> statement-breakpoint

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON photos FOR ALL TO app_user
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- A foto enviada não muda: a revisão do gestor (pending → published/discarded) é a única
-- alteração permitida, por isso o UPDATE vale só para a coluna review e não há DELETE.
GRANT SELECT, INSERT ON photos TO app_user;
--> statement-breakpoint
GRANT UPDATE (review) ON photos TO app_user;
