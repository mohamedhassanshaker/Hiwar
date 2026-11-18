-- The trace store is Arize Phoenix (stack specification 6.3), so the column that
-- carries a run's trace id is named for what it holds, not for a product.
ALTER TABLE "ai"."run" RENAME COLUMN "langfuse_trace_id" TO "trace_id";
