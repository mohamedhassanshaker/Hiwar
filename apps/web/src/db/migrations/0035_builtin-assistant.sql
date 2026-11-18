ALTER TABLE "ai"."agent" ADD COLUMN "is_builtin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."agent" ADD COLUMN "default_version" integer;--> statement-breakpoint
UPDATE "ai"."agent" SET "is_builtin" = true WHERE "code" = 'pa';
