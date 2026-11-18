-- Voice input is wanted again (D386, reverses D340's default): the widget's microphone now
-- sends a recording to the platform's Transcription model. Existing deployments turn Voice
-- input on and new ones start with it on; a deployment's settings can still switch it off.
ALTER TABLE "ai"."embedded_deployment" ALTER COLUMN "voice_input" SET DEFAULT true;
--> statement-breakpoint
UPDATE "ai"."embedded_deployment" SET "voice_input" = true WHERE NOT "voice_input";
