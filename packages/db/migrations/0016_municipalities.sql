CREATE TABLE "municipalities" (
	"ibge_code" char(7) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" char(2) NOT NULL,
	"boundary" geometry(MultiPolygon, 4326) NOT NULL,
	CONSTRAINT "municipalities_ibge_code_check" CHECK ("municipalities"."ibge_code" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE INDEX "municipalities_boundary_idx" ON "municipalities" USING gist ("boundary");