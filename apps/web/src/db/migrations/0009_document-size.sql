ALTER TABLE "ai"."knowledge_document" ADD COLUMN IF NOT EXISTS "size_bytes" integer DEFAULT 0 NOT NULL;
