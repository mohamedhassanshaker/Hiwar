-- The platform's own tools appear as one built-in connector, `platform` (D228). Its tools are the
-- platform's catalogue, read from the code, so no tool rows are stored for it; an agent's grant of
-- them stays in `ai.agent_platform_tool`. It cannot be removed or switched off.
--
-- The built-in `platform-operations` skill ships with it and joins the built-in Assistant's
-- defaults (version 4). An Assistant still on version 3 gets the skill on its active version and
-- its draft; a customised one keeps its other changes, since a skill is added, not replaced.
INSERT INTO "ai"."connector" ("id", "code", "name_en", "name_ar", "transport", "server_url", "auth_type", "default_tier_for_new_tools", "is_enabled", "status")
VALUES ('d71f8f4b-7833-53a1-890e-772987c61fd3', 'platform', 'Platform', 'المنصة', 'StreamableHttp', 'internal://platform', 'None', 'T1', true, 'Connected')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ai"."skill" ("id", "skill_name", "title_en", "title_ar", "description_en", "description_ar", "source_type", "tags")
VALUES ('d870bf54-f2fe-54f7-a339-34e2ce05a46e', 'platform-operations', 'Platform operations', 'عمليات المنصة', 'Carry out work on the platform that takes one or many consecutive actions through the Platform connector, with the authority of the person asking.', 'تنفيذ عمل على المنصة يتطلب إجراءً واحداً أو عدة إجراءات متتالية عبر موصل المنصة، بصلاحيات الشخص الطالب.', 'Bundled', ARRAY['platform','built-in']::text[])
ON CONFLICT ("skill_name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ai"."skill_version" ("id", "skill_id", "version_label", "package_ref", "checksum", "frontmatter_valid", "declared_tools", "status")
SELECT '0565b1c5-7a7c-5da7-b3d1-96d50999d0d5', s."id", '1.0.0', 'skills/platform-operations/1.0.0.zip', 'sha256:platform-operations', true, ARRAY['project_list','request_list','request_read','work_item_search','work_item_read','person_list','role_list']::text[], 'Published'
  FROM "ai"."skill" s WHERE s."skill_name" = 'platform-operations'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "ai"."skill" s SET "current_version_id" = sv."id"
  FROM "ai"."skill_version" sv
 WHERE sv."skill_id" = s."id" AND s."skill_name" = 'platform-operations' AND s."current_version_id" IS NULL;
--> statement-breakpoint
INSERT INTO "ai"."skill_scan_result" ("skill_version_id", "scripts", "network_calls", "prompt_injection_patterns", "embedded_secrets", "sandbox_only", "scanned_at")
SELECT s."current_version_id", 0, 0, 0, 0, true, now()
  FROM "ai"."skill" s
 WHERE s."skill_name" = 'platform-operations'
   AND NOT EXISTS (SELECT 1 FROM "ai"."skill_scan_result" r WHERE r."skill_version_id" = s."current_version_id");
--> statement-breakpoint
INSERT INTO "ai"."agent_skill" ("agent_version_id", "skill_version_id")
SELECT v."id", s."current_version_id"
  FROM "ai"."agent" a
  JOIN "ai"."agent_version" v ON v."agent_id" = a."id" AND (v."is_active" OR v."published_at" IS NULL)
 CROSS JOIN "ai"."skill" s
 WHERE a."is_builtin" AND a."default_version" = 3 AND s."skill_name" = 'platform-operations'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "ai"."agent" SET "default_version" = 4 WHERE "is_builtin" AND "default_version" = 3;
