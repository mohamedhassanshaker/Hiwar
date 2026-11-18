CREATE TABLE IF NOT EXISTS "ai"."agent_platform_tool" (
	"agent_version_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_platform_tool_pk" PRIMARY KEY("agent_version_id","tool_name"),
	CONSTRAINT "agent_platform_tool_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
-- Every version that predates the grant gets an explicit copy of what it could already
-- reach: `DEFAULT_PLATFORM_TOOLS`, which every agent held implicitly, plus the five
-- built-ins the harness answered for every run regardless (D38, D80). Nothing an agent
-- could do before this migration stops working because of it.
--
-- Every version, not only the active one: a draft becomes active when it is published and
-- a rollback makes an older one live again, so a version left without rows would silently
-- publish an agent that reaches nothing.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
 CROSS JOIN (VALUES
	('memory_search'),
	('memory_write'),
	('knowledge_search'),
	('artifact_create'),
	('request_read'),
	('work_item_read'),
	('work_item_search'),
	('work_item_create'),
	('work_item_set_status'),
	('file_search'),
	('page_read'),
	('my_attention'),
	('delegate_to_agent'),
	('generate_document'),
	('ask_person'),
	('write_handoff')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
