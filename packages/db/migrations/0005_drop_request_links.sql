ALTER TABLE "requests" DROP CONSTRAINT "requests_tenant_id_duplicate_of_id_requests_tenant_id_id_fk";
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_tenant_id_request_id_requests_tenant_id_id_fk";
--> statement-breakpoint
DROP INDEX "work_orders_one_active_per_request_idx";--> statement-breakpoint
ALTER TABLE "requests" DROP COLUMN "duplicate_of_id";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "request_id";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "completion_note";