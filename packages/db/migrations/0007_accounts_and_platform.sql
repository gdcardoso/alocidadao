CREATE TYPE "public"."account_status" AS ENUM('active', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."commercial_status" AS ENUM('new', 'contacted', 'negotiating', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('admin', 'support');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('onboarding', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "city_interest" (
	"ibge_code" char(7) NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "city_interest_ibge_code_user_id_pk" PRIMARY KEY("ibge_code","user_id"),
	CONSTRAINT "city_interest_ibge_code_check" CHECK ("city_interest"."ibge_code" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "municipality_leads" (
	"ibge_code" char(7) PRIMARY KEY NOT NULL,
	"commercial_status" "commercial_status" DEFAULT 'new' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "municipality_leads_ibge_code_check" CHECK ("municipality_leads"."ibge_code" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "staff_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"included_panel_users" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_contracts_ends_on_check" CHECK ("tenant_contracts"."ends_on" >= "tenant_contracts"."starts_on"),
	CONSTRAINT "tenant_contracts_included_panel_users_check" CHECK ("tenant_contracts"."included_panel_users" > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "membership_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" "tenant_status" DEFAULT 'onboarding' NOT NULL;--> statement-breakpoint
-- Ainda não há prefeituras reais, mas o banco de desenvolvimento tem a demo.
UPDATE "tenants" SET "display_name" = "name", "status" = CASE WHEN "active" THEN 'active'::tenant_status ELSE 'onboarding'::tenant_status END;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "central_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" "account_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role";--> statement-breakpoint
ALTER TABLE "city_interest" ADD CONSTRAINT "city_interest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "municipality_leads" ADD CONSTRAINT "municipality_leads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_events_tenant_id_created_at_index" ON "staff_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "tenant_contracts_tenant_id_index" ON "tenant_contracts" USING btree ("tenant_id");--> statement-breakpoint
-- O cidadão demo do banco de desenvolvimento não tinha telefone nem CPF: ganha o telefone que o seed passa a usar.
UPDATE "users" SET "phone" = '+5511900000002' WHERE "email" = 'cidadao.demo@alocidadao.dev' AND "phone" IS NULL AND "cpf" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_active_idx" ON "users" USING btree ("phone") WHERE "users"."account_status" = 'active';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cpf_check" CHECK ("users"."cpf" ~ '^[0-9]{11}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_or_cpf_check" CHECK ("users"."phone" is not null or "users"."cpf" is not null);