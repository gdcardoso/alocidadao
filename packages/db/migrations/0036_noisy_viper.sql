CREATE TABLE "ibge_neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ibge_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"boundary" geometry(MultiPolygon, 4326) NOT NULL,
	CONSTRAINT "ibge_neighborhoods_code_unique" UNIQUE("code"),
	CONSTRAINT "ibge_neighborhoods_ibge_code_check" CHECK ("ibge_neighborhoods"."ibge_code" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "tenant_neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"boundary" geometry(MultiPolygon, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_neighborhoods_tenant_id_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "neighborhood" text;--> statement-breakpoint
ALTER TABLE "tenant_neighborhoods" ADD CONSTRAINT "tenant_neighborhoods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ibge_neighborhoods_boundary_idx" ON "ibge_neighborhoods" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "ibge_neighborhoods_ibge_code_idx" ON "ibge_neighborhoods" USING btree ("ibge_code");--> statement-breakpoint
CREATE INDEX "tenant_neighborhoods_boundary_idx" ON "tenant_neighborhoods" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "occurrences_tenant_id_neighborhood_index" ON "occurrences" USING btree ("tenant_id","neighborhood");