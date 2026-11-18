-- The embedded widget specification (D231): the deployment settings it reads, a List mode for
-- storylines, a conversation as an attachment owner for the file field, and the person who
-- answers after a handoff as a conversation role.
ALTER TABLE "ai"."embedded_deployment"
  ADD COLUMN "disclaimer_en" text,
  ADD COLUMN "disclaimer_ar" text,
  ADD COLUMN "disclaimer_dismissible" boolean DEFAULT true NOT NULL,
  ADD COLUMN "quick_actions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "voice_input" boolean DEFAULT true NOT NULL,
  ADD COLUMN "read_aloud" boolean DEFAULT true NOT NULL,
  ADD COLUMN "session_idle_minutes" integer DEFAULT 30 NOT NULL,
  ADD COLUMN "progress_retention_minutes" integer DEFAULT 1440 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai"."embedded_deployment"
  ADD CONSTRAINT "embedded_deployment_quick_actions_check" CHECK (jsonb_typeof("quick_actions_json") = 'array'),
  ADD CONSTRAINT "embedded_deployment_idle_check" CHECK ("session_idle_minutes" between 1 and 1440),
  ADD CONSTRAINT "embedded_deployment_retention_check" CHECK ("progress_retention_minutes" between 0 and 43200);
--> statement-breakpoint
ALTER TABLE "ai"."storyline_version" DROP CONSTRAINT "storyline_version_mode_check";
--> statement-breakpoint
ALTER TABLE "ai"."storyline_version" ADD CONSTRAINT "storyline_version_mode_check" CHECK ("mode" in ('Free', 'List', 'Guided', 'Strict'));
--> statement-breakpoint
ALTER TABLE "ai"."conversation_message" DROP CONSTRAINT "conversation_message_role_check";
--> statement-breakpoint
ALTER TABLE "ai"."conversation_message" ADD CONSTRAINT "conversation_message_role_check" CHECK ("role" in ('Visitor', 'Agent', 'HumanAgent', 'System'));
--> statement-breakpoint
ALTER TABLE "work"."attachment" DROP CONSTRAINT "attachment_owner_check";
--> statement-breakpoint
ALTER TABLE "work"."attachment" ADD CONSTRAINT "attachment_owner_check" CHECK ("owner_type" in ('Request', 'WorkItem', 'Room', 'Conversation'));
--> statement-breakpoint
CREATE TABLE "ai"."widget_event" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "deployment_id" uuid NOT NULL REFERENCES "ai"."embedded_deployment"("id") ON DELETE cascade,
  "conversation_id" uuid REFERENCES "ai"."deployment_conversation"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "props_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "widget_event_props_check" CHECK (jsonb_typeof("props_json") = 'object')
);
--> statement-breakpoint
CREATE INDEX "widget_event_deployment_idx" ON "ai"."widget_event" ("deployment_id", "at");
--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" DROP CONSTRAINT "deployment_conversation_outcome_check";
--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_outcome_check" CHECK ("outcome" is null or "outcome" in ('Completed', 'HandedOff', 'Abandoned', 'Cancelled', 'RequestCreated'));
