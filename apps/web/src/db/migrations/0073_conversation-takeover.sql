-- A person may take a widget conversation over from its agent (D342): who did, and when. While
-- set, the agent answers nothing and the person writes to the visitor. The Conversations
-- screen lists every conversation newest first.
ALTER TABLE "ai"."deployment_conversation"
  ADD COLUMN "agent_paused_by" uuid,
  ADD COLUMN "agent_paused_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_agent_paused_by_person_id_fk"
  FOREIGN KEY ("agent_paused_by") REFERENCES "core"."person"("id");
--> statement-breakpoint
CREATE INDEX "deployment_conversation_started_idx" ON "ai"."deployment_conversation" USING btree ("started_at");
