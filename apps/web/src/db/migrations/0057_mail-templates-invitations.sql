-- D247: emails when a request is created or moves on; D248: a person invited is emailed a link to
-- accept, kept here as a hash, with the token itself encrypted only until the email is sent.
ALTER TABLE "gov"."mail_notification" DROP CONSTRAINT "mail_notification_kind_check";
--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD CONSTRAINT "mail_notification_kind_check" CHECK ("kind" in ('RequestCreated', 'RequestUpdated', 'RequestFinished', 'WorkItemFinished', 'Invitation', 'Test', 'AgentEmail'));
--> statement-breakpoint
ALTER TABLE "core"."notification_preference" ADD COLUMN "request_created_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "core"."notification_preference" ADD COLUMN "request_updated_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "core"."person_invitation" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "person_id" uuid NOT NULL REFERENCES "core"."person"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "token_cipher" text,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid,
  "version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_invitation_token" ON "core"."person_invitation" ("token_hash");
--> statement-breakpoint
CREATE INDEX "person_invitation_person" ON "core"."person_invitation" ("person_id");
