ALTER TABLE "work"."project_file" DROP CONSTRAINT IF EXISTS "project_file_status_check";--> statement-breakpoint
ALTER TABLE "work"."project_file" ADD CONSTRAINT "project_file_status_check" CHECK ("status" in ('Active', 'Inactive', 'Quarantined'));
