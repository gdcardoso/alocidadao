ALTER TYPE "public"."commercial_status" ADD VALUE 'proposal_sent' BEFORE 'negotiating';--> statement-breakpoint
ALTER TABLE "staff_audit_events" ALTER COLUMN "tenant_id" DROP NOT NULL;