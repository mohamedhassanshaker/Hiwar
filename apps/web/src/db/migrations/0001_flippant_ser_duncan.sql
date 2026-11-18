ALTER TABLE "ai"."inbox_item" DROP CONSTRAINT "inbox_item_kind_check";--> statement-breakpoint
ALTER TABLE "ai"."run_step" DROP CONSTRAINT "run_step_type_check";--> statement-breakpoint
ALTER TABLE "gov"."feature_flag" DROP CONSTRAINT "feature_flag_group_check";--> statement-breakpoint
ALTER TABLE "ai"."connector_catalog_entry" ADD COLUMN "tool_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."knowledge_collection" ADD COLUMN "entity_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD CONSTRAINT "inbox_item_kind_check" CHECK ("kind" in ('Approval', 'Question', 'Mention', 'SlaWarning', 'Review'));--> statement-breakpoint
ALTER TABLE "ai"."run_step" ADD CONSTRAINT "run_step_type_check" CHECK ("type" in ('Start', 'Model', 'Tool', 'Skill', 'Approval', 'Question', 'Verify', 'Handoff'));--> statement-breakpoint
ALTER TABLE "gov"."feature_flag" ADD CONSTRAINT "feature_flag_group_check" CHECK ("group" in ('AgentsAndRuns', 'MemoryAndKnowledge', 'Collaboration', 'Engage', 'Platform'));