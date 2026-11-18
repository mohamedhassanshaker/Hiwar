-- The attribute values a step's action supplied, recorded with the action (D314), so the
-- request's history shows what was collected at each step.
ALTER TABLE "work"."request_event" ADD COLUMN "attributes" jsonb;
--> statement-breakpoint
ALTER TABLE "work"."request_event" ADD CONSTRAINT "request_event_attributes_check"
  CHECK ("attributes" is null or jsonb_typeof("attributes") = 'object');
