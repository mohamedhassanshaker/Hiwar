-- The service identity a deployment's agent acts as for an anonymous visitor (D221). Empty
-- until an administrator sets it, and a deployment without one does not answer a free
-- conversation.
ALTER TABLE "ai"."embedded_deployment" ADD COLUMN IF NOT EXISTS "run_as_person_id" uuid
  REFERENCES "core"."person"("id");
