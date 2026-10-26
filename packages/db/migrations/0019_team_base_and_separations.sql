CREATE TABLE "occurrence_separations" (
	"tenant_id" uuid NOT NULL,
	"occurrence_a_id" uuid NOT NULL,
	"occurrence_b_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_separations_occurrence_a_id_occurrence_b_id_pk" PRIMARY KEY("occurrence_a_id","occurrence_b_id"),
	CONSTRAINT "occurrence_separations_order_check" CHECK ("occurrence_separations"."occurrence_a_id" < "occurrence_separations"."occurrence_b_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "base_address" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "base_location" geometry(point, 4326);--> statement-breakpoint
ALTER TABLE "occurrence_separations" ADD CONSTRAINT "occurrence_separations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_separations" ADD CONSTRAINT "occurrence_separations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_separations" ADD CONSTRAINT "occurrence_separations_tenant_id_occurrence_a_id_occurrences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","occurrence_a_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_separations" ADD CONSTRAINT "occurrence_separations_tenant_id_occurrence_b_id_occurrences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","occurrence_b_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_merged_into_check" CHECK (("occurrences"."status" = 'merged') = ("occurrences"."merged_into_id" is not null) and "occurrences"."merged_into_id" <> "occurrences"."id");