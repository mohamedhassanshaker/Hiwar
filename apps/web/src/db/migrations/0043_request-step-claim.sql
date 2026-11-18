-- A person who may act on a request's current step takes it; the other audiences wait until it moves.
ALTER TABLE "work"."request" ADD COLUMN IF NOT EXISTS "claimed_by" uuid REFERENCES "core"."person"("id");--> statement-breakpoint
ALTER TABLE "work"."request" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
