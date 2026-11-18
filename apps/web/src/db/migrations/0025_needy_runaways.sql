CREATE TABLE "work"."card_comment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"capture_ref" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "card_comment_content_check" CHECK (("deleted_at" is not null) or ("body_text" <> '') or ("capture_ref" is not null))
);
--> statement-breakpoint
CREATE TABLE "work"."card_comment_mention" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"comment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."card_comment_read" (
	"thread_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_comment_read_pk" PRIMARY KEY("thread_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "work"."card_comment_thread" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"card_id" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "card_comment_thread_card_check" CHECK ("card_id" in ('runs', 'tasks', 'attention', 'live'))
);
--> statement-breakpoint
CREATE TABLE "ai"."assistant_chat" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"screen" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."assistant_chat_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"body_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "assistant_chat_message_role_check" CHECK ("role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "work"."work_item" DROP CONSTRAINT "work_item_origin_check";--> statement-breakpoint
ALTER TABLE "work"."card_comment" ADD CONSTRAINT "card_comment_thread_id_card_comment_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "work"."card_comment_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment" ADD CONSTRAINT "card_comment_author_id_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment" ADD CONSTRAINT "card_comment_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "work"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment_mention" ADD CONSTRAINT "card_comment_mention_comment_id_card_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "work"."card_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment_mention" ADD CONSTRAINT "card_comment_mention_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment_read" ADD CONSTRAINT "card_comment_read_thread_id_card_comment_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "work"."card_comment_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comment_read" ADD CONSTRAINT "card_comment_read_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."assistant_chat" ADD CONSTRAINT "assistant_chat_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."assistant_chat_message" ADD CONSTRAINT "assistant_chat_message_chat_id_assistant_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "ai"."assistant_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_comment_thread_idx" ON "work"."card_comment" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "card_comment_work_item_idx" ON "work"."card_comment" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_comment_mention_key" ON "work"."card_comment_mention" USING btree ("comment_id","person_id");--> statement-breakpoint
CREATE INDEX "card_comment_mention_person_idx" ON "work"."card_comment_mention" USING btree ("person_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_comment_thread_card_key" ON "work"."card_comment_thread" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "assistant_chat_person_idx" ON "ai"."assistant_chat" USING btree ("person_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_chat_message_order_key" ON "ai"."assistant_chat_message" USING btree ("chat_id","sort_order");--> statement-breakpoint
ALTER TABLE "work"."work_item" ADD CONSTRAINT "work_item_origin_check" CHECK ("origin_type" in ('Manual', 'Request', 'Room', 'Schedule', 'Agent', 'Comment'));