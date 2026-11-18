ALTER TABLE "ai"."run" DROP CONSTRAINT IF EXISTS "run_status_check";--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_status_check" CHECK ("status" in ('Queued', 'Running', 'Waiting', 'Blocked', 'Succeeded', 'Failed', 'Cancelled', 'BudgetExceeded'));
