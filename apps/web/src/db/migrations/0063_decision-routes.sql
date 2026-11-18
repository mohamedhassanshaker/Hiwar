-- A route may be a Decision route, whose steps answer at the provider's decisions endpoint (D290).
ALTER TABLE "ai"."route" DROP CONSTRAINT "route_kind_check";
--> statement-breakpoint
ALTER TABLE "ai"."route" ADD CONSTRAINT "route_kind_check"
  CHECK ("kind" IN ('Standard', 'Typesafe', 'Voice', 'Embedding', 'Decision'));
--> statement-breakpoint
-- A room chooses among its agents on `agent-choice` (D290). An install that has the seeded
-- OpenRouter connection gets the route the seed ships, on the decision model the seed allows;
-- a fresh install gets both from the seed, which runs after this.
INSERT INTO "ai"."connection_allowed_model" ("id", "connection_id", "model_name", "modalities", "kind")
SELECT 'b5756ee4-f6ae-519d-8516-72b76fb64caf', c."id", 'cloudflare/clef-flash', ARRAY['text'], 'Decision'
  FROM "ai"."provider_connection" c
 WHERE c."id" = '2810cdfa-17de-5bff-8298-fda97a5bb13c'
   AND NOT EXISTS (SELECT 1 FROM "ai"."connection_allowed_model" m
                    WHERE m."connection_id" = c."id" AND m."model_name" = 'cloudflare/clef-flash');
--> statement-breakpoint
INSERT INTO "ai"."route" ("id", "alias", "kind")
SELECT '205149d6-0bcd-5cb4-8217-d6077c548aee', 'agent-choice', 'Decision'
 WHERE EXISTS (SELECT 1 FROM "ai"."connection_allowed_model"
                WHERE "connection_id" = '2810cdfa-17de-5bff-8298-fda97a5bb13c'
                  AND "model_name" = 'cloudflare/clef-flash' AND "kind" = 'Decision')
   AND NOT EXISTS (SELECT 1 FROM "ai"."route" WHERE "alias" = 'agent-choice');
--> statement-breakpoint
INSERT INTO "ai"."route_step" ("id", "route_id", "sort_order", "provider_id", "connection_id", "model_name")
SELECT '55e94e3d-f90f-5e74-b895-6312c518f52c', r."id", 0, c."provider_id", c."id", 'cloudflare/clef-flash'
  FROM "ai"."route" r, "ai"."provider_connection" c
 WHERE r."id" = '205149d6-0bcd-5cb4-8217-d6077c548aee'
   AND c."id" = '2810cdfa-17de-5bff-8298-fda97a5bb13c'
   AND NOT EXISTS (SELECT 1 FROM "ai"."route_step" s WHERE s."route_id" = r."id");
