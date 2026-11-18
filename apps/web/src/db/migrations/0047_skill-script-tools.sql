-- The skill-script tools (D209) are harness built-ins, on by default like the others (D80), so
-- every version gets them, as 0034 gave every version the built-ins of its day. A run is
-- offered them only when one of its granted skills ships a script.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
 CROSS JOIN (VALUES
	('skill_script_run'),
	('workspace_file_write'),
	('workspace_file_read'),
	('workspace_file_save')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
