ALTER TABLE "ai"."embedded_deployment" ADD COLUMN "visitor_jwt_secret_ref" "bytea";--> statement-breakpoint
ALTER TABLE "ai"."embedded_deployment" ADD COLUMN "visitor_jwt_fallback" text DEFAULT 'Anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."embedded_deployment" ADD CONSTRAINT "embedded_deployment_jwt_fallback_check" CHECK ("visitor_jwt_fallback" in ('Anonymous', 'Refuse'));