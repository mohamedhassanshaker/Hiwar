-- D375: what the Setup Director (removed by D371) left in the database. Nothing writes the
-- change-set tables any more, and an install that is not reseeded still holds the Director's
-- agent, its two flags and its two permissions.
--
-- The Director's runs stay, under the trigger and context of any other conversation a person
-- starts in the console; the agent they name says they were the Director's.
UPDATE "ai"."run" SET "trigger" = 'Manual' WHERE "trigger" = 'Setup';
--> statement-breakpoint
UPDATE "ai"."run" SET "context_type" = 'Console' WHERE "context_type" = 'Setup';
--> statement-breakpoint
ALTER TABLE "ai"."run" DROP CONSTRAINT "run_trigger_check";
--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_trigger_check" CHECK ("trigger" in ('Mention', 'Assignment', 'RequestStep', 'Schedule', 'Widget', 'Manual', 'Replay', 'Delegation'));
--> statement-breakpoint
ALTER TABLE "ai"."run" DROP CONSTRAINT "run_context_check";
--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_context_check" CHECK ("context_type" in ('Room', 'WorkItem', 'Request', 'Deployment', 'Console'));
--> statement-breakpoint
-- An agent that reported to the Director reports to whoever the Director reported to.
UPDATE "ai"."agent" AS a
SET "reports_to_type" = d."reports_to_type", "reports_to_id" = d."reports_to_id", "updated_at" = now(), "version" = a."version" + 1
FROM "ai"."agent" AS d
WHERE d."code" = 'dir' AND a."reports_to_type" = 'Agent' AND a."reports_to_id" = d."id";
--> statement-breakpoint
-- Retired, not deleted: its runs, approvals and audit entries still name it. No longer a
-- system agent, so the owner may delete it like any other.
UPDATE "ai"."agent"
SET "status" = 'Retired', "is_system" = false, "updated_at" = now(), "version" = "version" + 1
WHERE "code" = 'dir';
--> statement-breakpoint
DELETE FROM "gov"."feature_flag" WHERE "key" IN ('setup-director', 'setup-director-can-propose-new-agents');
--> statement-breakpoint
-- No check reads them; their role grants go with them (`role_permission` cascades).
DELETE FROM "core"."permission" WHERE "code" IN ('setup:read', 'setup:apply');
--> statement-breakpoint
ALTER TABLE "ai"."approval" DROP COLUMN "change_set_id";
--> statement-breakpoint
DROP TABLE "gov"."change_set_item";
--> statement-breakpoint
DROP TABLE "gov"."change_set";
--> statement-breakpoint
DROP TABLE "gov"."setup_conversation";
--> statement-breakpoint
DROP TABLE "gov"."blueprint_version";
