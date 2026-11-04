CREATE TYPE "public"."invite_kind" AS ENUM('panel', 'agent', 'staff');--> statement-breakpoint
CREATE TABLE "invite_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"kind" "invite_kind" NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_deliveries_tenant_check" CHECK (("invite_deliveries"."kind" = 'staff') = ("invite_deliveries"."tenant_id" is null))
);
--> statement-breakpoint
ALTER TABLE "invite_deliveries" ADD CONSTRAINT "invite_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_deliveries" ADD CONSTRAINT "invite_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_deliveries" ADD CONSTRAINT "invite_deliveries_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_deliveries_user_id_tenant_id_kind_sent_at_index" ON "invite_deliveries" USING btree ("user_id","tenant_id","kind","sent_at" DESC NULLS LAST);