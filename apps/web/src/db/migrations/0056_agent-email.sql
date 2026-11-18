-- D242: an agent's email (`email_create`) goes through the same queue and consumer as the
-- system notifications, so its row carries the message itself and the run that wrote it.
ALTER TABLE "gov"."mail_notification" DROP CONSTRAINT "mail_notification_kind_check";
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD CONSTRAINT "mail_notification_kind_check" CHECK ("kind" in ('RequestFinished', 'WorkItemFinished', 'Test', 'AgentEmail'));
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD COLUMN "mail_subject" text;
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD COLUMN "mail_body" text;
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD COLUMN "run_id" uuid;
