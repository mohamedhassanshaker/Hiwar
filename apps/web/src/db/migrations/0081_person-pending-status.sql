-- A person can register themselves and wait for an approver (D393). `Pending` is one more
-- value of the person status; no existing row changes.
ALTER TABLE "core"."person" DROP CONSTRAINT "person_status_check";
--> statement-breakpoint
ALTER TABLE "core"."person" ADD CONSTRAINT "person_status_check"
  CHECK ("status" in ('Invited', 'Pending', 'Active', 'Suspended'));
