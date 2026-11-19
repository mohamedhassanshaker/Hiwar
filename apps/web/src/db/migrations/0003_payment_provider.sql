ALTER TABLE "invoices" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_customer_id" text;