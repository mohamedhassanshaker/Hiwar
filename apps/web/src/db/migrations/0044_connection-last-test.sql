-- A saved connection's last test and when it ran, so its health is what a test found rather than whether it is switched on.
ALTER TABLE "ai"."provider_connection" ADD COLUMN IF NOT EXISTS "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai"."provider_connection" ADD COLUMN IF NOT EXISTS "last_test_result_json" jsonb;--> statement-breakpoint
ALTER TABLE "ai"."provider_connection" DROP CONSTRAINT IF EXISTS "provider_connection_last_test_check";--> statement-breakpoint
ALTER TABLE "ai"."provider_connection" ADD CONSTRAINT "provider_connection_last_test_check" CHECK ("last_test_result_json" is null or jsonb_typeof("last_test_result_json") = 'object');
