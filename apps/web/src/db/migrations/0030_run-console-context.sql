ALTER TABLE "ai"."run" DROP CONSTRAINT "run_context_check";--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_context_check" CHECK ("context_type" in ('Room', 'WorkItem', 'Request', 'Deployment', 'Setup', 'Console'));
