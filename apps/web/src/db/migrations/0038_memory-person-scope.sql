-- D68: memory is scoped per (agent, person). A scope row carries the person it belongs
-- to; null stays shared (the organisation, a business unit, a room).
ALTER TABLE "ai"."memory_scope" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memory_scope_person_id_person_id_fk'
  ) THEN
    ALTER TABLE "ai"."memory_scope"
      ADD CONSTRAINT "memory_scope_person_id_person_id_fk"
      FOREIGN KEY ("person_id") REFERENCES "core"."person"("id");
  END IF;
END
$$;--> statement-breakpoint

-- One private scope per (agent, person): two concurrent runs for the same person both
-- resolve the scope before either has written it.
CREATE UNIQUE INDEX IF NOT EXISTS "memory_scope_agent_person_key"
  ON "ai"."memory_scope" ("ref_id", "person_id") WHERE "person_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "memory_scope_person_idx"
  ON "ai"."memory_scope" ("person_id") WHERE "person_id" IS NOT NULL;
