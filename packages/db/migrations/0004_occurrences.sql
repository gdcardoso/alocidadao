-- Ainda não há dados reais (spec, seção 9): apaga os dados operacionais para as colunas novas obrigatórias.
TRUNCATE status_events, client_actions, work_orders, requests, request_counters;
--> statement-breakpoint
CREATE TYPE "public"."icon_group" AS ENUM('infrastructure', 'environment', 'public_services');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('triage', 'in_progress', 'awaiting_confirmation', 'completed', 'rejected', 'merged', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."photo_review" AS ENUM('pending', 'published', 'discarded');--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"location" geometry(point, 4326) NOT NULL,
	"status" "occurrence_status" DEFAULT 'triage' NOT NULL,
	"merged_into_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrences_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "occurrences_tenant_id_id_category_id_unique" UNIQUE("tenant_id","id","category_id")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid,
	"work_order_id" uuid,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"review" "photo_review",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "photos_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."request_id", "photos"."work_order_id") = 1),
	CONSTRAINT "photos_review_check" CHECK (("photos"."work_order_id" is null) = ("photos"."review" is null))
);
--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."request_status";--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('open', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled', 'rejected');--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."request_status";--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "status" SET DATA TYPE "public"."request_status" USING "status"::"public"."request_status";--> statement-breakpoint
-- Ajuste manual: o índice parcial abaixo compara status com o tipo antigo e impede passar a coluna
-- por text. Ele sai antes da troca do tipo e volta igual depois (a migração seguinte o remove).
DROP INDEX "work_orders_one_active_per_request_idx";--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'assigned'::text;--> statement-breakpoint
DROP TYPE "public"."work_order_status";--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('assigned', 'in_execution', 'awaiting_review', 'rework_requested', 'impeded', 'completed', 'cancelled');--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'assigned'::"public"."work_order_status";--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DATA TYPE "public"."work_order_status" USING "status"::"public"."work_order_status";--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_one_active_per_request_idx" ON "work_orders" USING btree ("request_id") WHERE "work_orders"."status" in ('assigned', 'in_execution');--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "icon_group" "icon_group" DEFAULT 'infrastructure' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "cluster_radius_m" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "occurrence_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "gps_location" geometry(point, 4326) NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "occurrence_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "occurrence_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "manager_instructions" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "agent_note" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "public_note" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_tenant_id_category_id_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_tenant_id_merged_into_id_occurrences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","merged_into_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_tenant_id_request_id_requests_tenant_id_id_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_tenant_id_work_order_id_work_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occurrences_tenant_id_status_index" ON "occurrences" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "occurrences_location_idx" ON "occurrences" USING gist ("location");--> statement-breakpoint
CREATE INDEX "photos_request_id_index" ON "photos" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "photos_work_order_id_index" ON "photos" USING btree ("work_order_id");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_tenant_id_occurrence_id_category_id_occurrences_tenant_id_id_category_id_fk" FOREIGN KEY ("tenant_id","occurrence_id","category_id") REFERENCES "public"."occurrences"("tenant_id","id","category_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_tenant_id_occurrence_id_occurrences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_occurrence_id_occurrences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_occurrence_id_index" ON "requests" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "status_events_occurrence_id_created_at_index" ON "status_events" USING btree ("occurrence_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_one_active_per_occurrence_idx" ON "work_orders" USING btree ("occurrence_id") WHERE "work_orders"."status" not in ('completed', 'cancelled');--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_cluster_radius_m_check" CHECK ("categories"."cluster_radius_m" between 1 and 500);--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_location_adjust_check" CHECK (ST_DWithin("requests"."location"::geography, "requests"."gps_location"::geography, 205));