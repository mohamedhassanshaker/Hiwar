ALTER TABLE "ai"."run" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_parent_run_id_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "ai"."run"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "run_parent_idx" ON "ai"."run" USING btree ("parent_run_id");
