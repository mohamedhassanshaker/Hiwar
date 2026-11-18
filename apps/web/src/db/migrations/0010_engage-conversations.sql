CREATE TABLE "ai"."channel_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_key" text NOT NULL,
	"body_text" text,
	"action" text NOT NULL,
	"detail" text,
	"conversation_id" uuid,
	"room_id" uuid,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "channel_message_direction_check" CHECK ("direction" in ('Inbound', 'Outbound')),
	CONSTRAINT "channel_message_action_check" CHECK ("action" in ('Process', 'Offline', 'Throttled', 'Dropped'))
);
--> statement-breakpoint
CREATE TABLE "ai"."conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"text_en" text,
	"text_ar" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "conversation_message_role_check" CHECK ("role" in ('Visitor', 'Agent', 'System')),
	CONSTRAINT "conversation_message_payload_check" CHECK ("payload_json" is null or jsonb_typeof("payload_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "ai"."channel" ADD COLUMN "inbound_secret_ref" "bytea";--> statement-breakpoint
ALTER TABLE "ai"."channel" ADD COLUMN "offline_message_en" text;--> statement-breakpoint
ALTER TABLE "ai"."channel" ADD COLUMN "offline_message_ar" text;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD COLUMN "visitor_key" text;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD COLUMN "state_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "ai"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_conversation_id_deployment_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."deployment_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_room_id_discussion_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "work"."discussion_room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "work"."request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_deployment_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."deployment_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_message_sender_idx" ON "ai"."channel_message" USING btree ("channel_id","sender_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_order_key" ON "ai"."conversation_message" USING btree ("conversation_id","sort_order");--> statement-breakpoint
CREATE INDEX "deployment_conversation_visitor_idx" ON "ai"."deployment_conversation" USING btree ("deployment_id","visitor_key");--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_state_check" CHECK ("state_json" is null or jsonb_typeof("state_json") = 'object');