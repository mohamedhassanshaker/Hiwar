-- D240: system email notifications when a request or work item finishes, with each person's
-- preference and one row per email sent, skipped or failed.
ALTER TABLE "core"."notification_preference" ADD COLUMN "request_finished_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."notification_preference" ADD COLUMN "work_item_finished_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "gov"."mail_notification" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "notification_key" text NOT NULL,
  "kind" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid,
  "person_id" uuid REFERENCES "core"."person"("id") ON DELETE set null,
  "recipient" text,
  "outcome" text NOT NULL,
  "status" text DEFAULT 'Queued' NOT NULL,
  "reason" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "mail_notification_kind_check" CHECK ("kind" in ('RequestFinished', 'WorkItemFinished', 'Test')),
  CONSTRAINT "mail_notification_status_check" CHECK ("status" in ('Queued', 'Sending', 'Sent', 'Failed', 'Skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_notification_key" ON "gov"."mail_notification" ("notification_key");
--> statement-breakpoint
CREATE INDEX "mail_notification_due_idx" ON "gov"."mail_notification" ("next_attempt_at") WHERE "status" in ('Queued', 'Sending');
--> statement-breakpoint
CREATE INDEX "mail_notification_recent_idx" ON "gov"."mail_notification" ("created_at");
