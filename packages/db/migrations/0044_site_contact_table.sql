CREATE TABLE "site_contact" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"whatsapp" text NOT NULL,
	"email" text NOT NULL,
	"response_note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "site_contact_single_row_check" CHECK ("site_contact"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "site_contact" ADD CONSTRAINT "site_contact_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;