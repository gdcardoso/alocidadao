-- O login por e-mail e senha sai: a função lia password_hash e is_platform_admin.
-- As buscas por telefone e por CPF entram na migração platform_rls.
DROP FUNCTION auth_find_user_by_email(text);--> statement-breakpoint
-- O admin da plataforma passa a ser o papel 'admin' da equipe interna.
UPDATE "users" SET "platform_role" = 'admin' WHERE "is_platform_admin";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_platform_admin";
