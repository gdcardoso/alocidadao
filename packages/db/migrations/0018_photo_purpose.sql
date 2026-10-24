CREATE TYPE "public"."photo_purpose" AS ENUM('report', 'contest', 'completion', 'impediment');--> statement-breakpoint
-- Ajuste manual: a coluna entra sem NOT NULL, as fotos existentes ganham o propósito pelo dono
-- (solicitação → relato, atividade → conclusão) e só então a coluna passa a ser obrigatória.
ALTER TABLE "photos" ADD COLUMN "purpose" "photo_purpose";--> statement-breakpoint
UPDATE "photos" SET "purpose" = CASE WHEN "request_id" IS NOT NULL THEN 'report'::"photo_purpose" ELSE 'completion'::"photo_purpose" END;--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "purpose" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_purpose_check" CHECK (("photos"."purpose" in ('report', 'contest')) = ("photos"."request_id" is not null));
