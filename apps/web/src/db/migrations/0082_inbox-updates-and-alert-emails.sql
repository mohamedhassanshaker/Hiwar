-- D394: what happens to a person's requests and work items reaches their Inbox as an Update, which
-- carries its own title and link, and every Inbox item is also emailed as an Alert. Two more values
-- of an enum-like column each, and three nullable columns; no existing row changes.
ALTER TABLE "ai"."inbox_item" DROP CONSTRAINT "inbox_item_kind_check";
--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD CONSTRAINT "inbox_item_kind_check"
  CHECK ("kind" in ('Approval', 'Question', 'Mention', 'SlaWarning', 'Review', 'Update'));
--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD COLUMN "title_en" text;
--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD COLUMN "title_ar" text;
--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD COLUMN "link_path" text;
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" DROP CONSTRAINT "mail_notification_kind_check";
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD CONSTRAINT "mail_notification_kind_check"
  CHECK ("kind" in ('RequestCreated', 'RequestUpdated', 'RequestFinished', 'WorkItemFinished', 'Invitation', 'Test', 'AgentEmail', 'Alert'));
