-- A request's next run reads the handoff the last one left, like a room's or a work item's.
ALTER TABLE "work"."context_handoff" DROP CONSTRAINT IF EXISTS "context_handoff_owner_check";--> statement-breakpoint
ALTER TABLE "work"."context_handoff" ADD CONSTRAINT "context_handoff_owner_check" CHECK ("owner_type" in ('Room', 'WorkItem', 'Request', 'Run'));
