-- An agent working a request step returns it and finds its duplicates with the tools a person
-- has for the same decisions (D215). Both are in the default grant (D122), so every version
-- gets them, as 0040 gave every version the reads and writes of its day.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
 CROSS JOIN (VALUES
	('request_list'),
	('request_change_request_create')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
