-- D349: the console's lists are filtered, ordered and paged on the server. Each index serves one
-- list's order or one visibility or filter condition, measured on 100,000 requests and work items.
-- The request list: top-level requests, newest first.
CREATE INDEX IF NOT EXISTS "request_list_idx" ON "work"."request" USING btree ("created_at" DESC, "key" DESC) WHERE "parent_request_id" IS NULL;
--> statement-breakpoint
-- A request outside the person's projects that they raised, or one they acted on (`UC-27.1-05`).
CREATE INDEX IF NOT EXISTS "request_requester_idx" ON "work"."request" USING btree ("requester_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_event_actor_idx" ON "work"."request_event" USING btree ("actor_id");
--> statement-breakpoint
-- The work item list newest first, and each board column newest first.
CREATE INDEX IF NOT EXISTS "work_item_created_idx" ON "work"."work_item" USING btree ("created_at" DESC, "key" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_status_created_idx" ON "work"."work_item" USING btree ("status", "created_at" DESC, "key" DESC);
--> statement-breakpoint
-- A work item outside the person's projects that they review or created (D328).
CREATE INDEX IF NOT EXISTS "work_item_reviewer_idx" ON "work"."work_item" USING btree ("reviewer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_created_by_idx" ON "work"."work_item" USING btree ("created_by");
--> statement-breakpoint
-- The room list, latest activity first.
CREATE INDEX IF NOT EXISTS "discussion_room_recent_idx" ON "work"."discussion_room" USING btree ((coalesce("last_activity_at", "created_at")) DESC, "id" DESC);
--> statement-breakpoint
-- One person's Inbox page and the shell's preview of it.
CREATE INDEX IF NOT EXISTS "inbox_item_person_listed_idx" ON "ai"."inbox_item" USING btree ("person_id", "status", "created_at", "id");
--> statement-breakpoint
-- The artifact and file lists, newest first.
CREATE INDEX IF NOT EXISTS "artifact_created_idx" ON "work"."artifact" USING btree ("created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_file_created_idx" ON "work"."project_file" USING btree ("created_at" DESC, "id" DESC);
--> statement-breakpoint
-- An open collection's sources, newest first, and the search by name. The first replaces the
-- index on the collection alone, which it leads with.
CREATE INDEX IF NOT EXISTS "knowledge_source_collection_created_idx" ON "ai"."knowledge_source" USING btree ("collection_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
DROP INDEX IF EXISTS "ai"."knowledge_source_collection_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_source_name_search_idx" ON "ai"."knowledge_source" USING gin ((public.awp_normalise("name")) gin_trgm_ops);
--> statement-breakpoint
-- The newest run (the run viewer with no id, the records' run list) and one agent's runs page.
CREATE INDEX IF NOT EXISTS "run_started_idx" ON "ai"."run" USING btree ("started_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_agent_started_idx" ON "ai"."run" USING btree ("agent_id", "started_at" DESC, "id" DESC);
