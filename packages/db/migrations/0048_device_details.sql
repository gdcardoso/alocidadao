-- Dados do aparelho: versão do sistema, fabricante e modelo em devices, e o retrato do
-- aparelho (ou do navegador do painel) em cada sessão e em cada solicitação.
ALTER TABLE "devices" ADD COLUMN "os_version" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "manufacturer" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "device" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device" jsonb;--> statement-breakpoint
-- O app atualiza o próprio aparelho (upsert): as colunas novas entram na permissão por coluna.
GRANT UPDATE (os_version, manufacturer, model) ON devices TO app_user;
