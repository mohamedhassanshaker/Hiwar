-- The widget's microphone is off until speech input is wanted again (D340): existing deployments
-- turn Voice input off and new ones start with it off. Switching Voice input on in a deployment's
-- settings brings the microphone back.
ALTER TABLE "ai"."embedded_deployment" ALTER COLUMN "voice_input" SET DEFAULT false;
--> statement-breakpoint
UPDATE "ai"."embedded_deployment" SET "voice_input" = false WHERE "voice_input";
