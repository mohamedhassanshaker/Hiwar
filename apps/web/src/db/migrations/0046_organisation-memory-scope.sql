-- The organisation's own memory scope (UC-55.3-06, D199): the shipped seed never created it and
-- nothing in the console does, so an install that started from that seed could not hold an
-- organisation memory. Added where it is missing, under the id the seed and the fixtures use.
INSERT INTO "ai"."memory_scope" ("id", "kind", "ref_id", "parent_scope_id", "path")
SELECT 'd88c31d4-4060-54b9-bff8-d6c6df67ce45', 'Organisation', o."id", NULL, 'org'
  FROM "core"."organisation" o
 WHERE NOT EXISTS (SELECT 1 FROM "ai"."memory_scope" m WHERE m."kind" = 'Organisation' AND m."person_id" IS NULL)
 LIMIT 1
ON CONFLICT DO NOTHING;
