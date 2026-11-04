-- Contato da página de apresentação: leitura livre (a rota pública não tem login), alteração só
-- pelo admin da plataforma, sem INSERT nem DELETE para app_user (a linha única nasce aqui)
-- (ver docs/decisoes/0001-isolamento-por-prefeitura.md).

ALTER TABLE site_contact ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_contact FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON site_contact FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY site_contact_select ON site_contact FOR SELECT TO app_user
  USING (true);
--> statement-breakpoint
CREATE POLICY site_contact_update ON site_contact FOR UPDATE TO app_user
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
GRANT SELECT ON site_contact TO app_user;
--> statement-breakpoint
GRANT UPDATE (whatsapp, email, response_note, updated_at, updated_by) ON site_contact TO app_user;
--> statement-breakpoint
-- Valores iniciais (DEFAULT_SITE_CONTACT em packages/shared/src/site.ts).
INSERT INTO site_contact (id, whatsapp, email, response_note)
  VALUES (1, '+5562982089667', 'gdcardoso@gmail.com', 'Resposta no mesmo dia');
