ALTER TABLE "ai"."approval" ADD COLUMN "arguments_hash" text;--> statement-breakpoint
ALTER TABLE "ai"."approval" ADD COLUMN "target_version" integer;--> statement-breakpoint
ALTER TABLE "ai"."approval" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai"."approval" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "approval_binding_idx" ON "ai"."approval" USING btree ("run_id","action","arguments_hash");
