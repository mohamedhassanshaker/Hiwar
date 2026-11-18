-- The built-in Assistant moves onto its defaults (D65, D99): the seed gave it a "never change
-- anything" text the reset target did not have, so a fresh install and a reset disagreed. Only a
-- version still holding that seeded text is changed; a customised one is left alone.
--
-- It also ships the discovery skill it creates platform objects with, and every room that has
-- agents but no lead agent gets one: its earliest-joined agent (rooms keep one lead while they
-- have agents).
INSERT INTO "ai"."skill" ("id", "skill_name", "title_en", "title_ar", "description_en", "description_ar", "source_type", "tags")
VALUES ('dfd15c2b-7c9d-5418-81b2-c34bc72beb9f', 'guided-platform-creation', 'Guided platform creation', 'إنشاء أو تكوين أي كائن منصة — نوع طلب أو مشروع أو وكيل أو مه', 'Create or configure any platform object — request type, project, agent, skill, knowledge collection — by discovering available options from live data and asking step-by-step questions.', 'إنشاء أو تكوين أي كائن منصة — نوع طلب أو مشروع أو وكيل أو مهارة أو مجموعة معرفة — من خلال اكتشاف الخيارات المتاحة من البيانات الحية وطرح أسئلة خطوة بخطوة.', 'Bundled', ARRAY['setup','platform']::text[])
ON CONFLICT ("skill_name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ai"."skill_version" ("id", "skill_id", "version_label", "package_ref", "checksum", "frontmatter_valid", "declared_tools", "status")
SELECT '165d079a-a699-5da1-97a5-c256a0f06421', s."id", '1.0.0', 'skills/guided-platform-creation/1.0.0.zip', 'sha256:guided-platform-creation', true, ARRAY['project_list','role_list','request_type_create','request_type_attribute_create']::text[], 'Published'
  FROM "ai"."skill" s WHERE s."skill_name" = 'guided-platform-creation'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "ai"."skill" s SET "current_version_id" = sv."id"
  FROM "ai"."skill_version" sv
 WHERE sv."skill_id" = s."id" AND s."skill_name" = 'guided-platform-creation' AND s."current_version_id" IS NULL;
--> statement-breakpoint
INSERT INTO "ai"."skill_scan_result" ("skill_version_id", "scripts", "network_calls", "prompt_injection_patterns", "embedded_secrets", "sandbox_only", "scanned_at")
SELECT s."current_version_id", 0, 0, 0, 0, true, now()
  FROM "ai"."skill" s
 WHERE s."skill_name" = 'guided-platform-creation'
   AND NOT EXISTS (SELECT 1 FROM "ai"."skill_scan_result" r WHERE r."skill_version_id" = s."current_version_id");
--> statement-breakpoint
UPDATE "ai"."agent_version" v SET "instructions" = 'You are the Platform Assistant. You work on behalf of the person asking, with their permissions and no more. Read the screen they are on before answering a question about it, and name real records rather than describing what you would do. You can carry out work, not only advise: when someone asks for something that needs several steps, plan them and do them, then say what you did. Ask for what you are missing in one message, as specific questions with a sensible default for each, rather than announcing that something is missing. A refusal is an answer: if the platform refuses a call, say plainly whether it is because the person may not do it, because you were not granted the tool, or because it needs somebody''s approval — and never retry against a wall. To summarise or answer about the page, call `page_read` with the page the task frame names and summarise what it returns. Asked what needs attention, call `my_attention` and answer with its entries in order, each with its link and why it is waiting. For one request or work item, call `request_read` or `work_item_read` first. Before creating or configuring anything on the platform, load the `guided-platform-creation` skill and follow it.'
  FROM "ai"."agent" a
 WHERE v."agent_id" = a."id" AND a."is_builtin" AND a."default_version" = 1
   AND v."instructions" = 'You are the assistant of Tahseel Juman, the Agentic Work Platform. Answer about the screen you were opened on, using the platform tools to read what it shows. You see exactly what the person asking sees, so if a tool returns nothing, say you cannot see that data rather than guessing at it. Link to the records you name. Never change anything: when someone asks for a change, say that the Setup Director prepares it as a draft change set for approval. To summarise or answer about the page, call `page_read` with the path the task frame names, and summarise what it returns — never the page''s title alone. Asked what needs attention, call `my_attention` and answer with its entries in the order it returns them, each with its link and why it is waiting. For a question about one request or work item, call `request_read` or `work_item_read` first. For a question the organisation''s own documents answer, call `knowledge_search`; leave its `collection_id` out to search everything you are granted.'
   AND (v."is_active" OR v."published_at" IS NULL);
--> statement-breakpoint
INSERT INTO "ai"."agent_skill" ("agent_version_id", "skill_version_id")
SELECT v."id", s."current_version_id"
  FROM "ai"."agent" a
  JOIN "ai"."agent_version" v ON v."agent_id" = a."id" AND (v."is_active" OR v."published_at" IS NULL)
 CROSS JOIN "ai"."skill" s
 WHERE a."is_builtin" AND a."default_version" = 1 AND s."skill_name" IN ('guided-platform-creation')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "ai"."agent" SET "name_en" = 'Platform Assistant', "name_ar" = 'مساعد المنصة'
 WHERE "is_builtin" AND "name_en" = 'Page Assistant';
--> statement-breakpoint
UPDATE "ai"."agent" SET "default_version" = 2 WHERE "is_builtin" AND "default_version" = 1;
--> statement-breakpoint
UPDATE "work"."room_participant" p SET "room_role" = 'LeadAgent'
 WHERE p."principal_type" = 'Agent'
   AND NOT EXISTS (
     SELECT 1 FROM "work"."room_participant" l WHERE l."room_id" = p."room_id" AND l."room_role" = 'LeadAgent')
   AND (p."joined_at", p."principal_id") = (
     SELECT e."joined_at", e."principal_id" FROM "work"."room_participant" e
      WHERE e."room_id" = p."room_id" AND e."principal_type" = 'Agent'
      ORDER BY e."joined_at", e."principal_id" LIMIT 1);
