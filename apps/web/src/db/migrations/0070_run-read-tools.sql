-- The built-in Assistant reads runs: run_list and run_get (T0) join its defaults, so it can name the
-- runs an agent_delete refusal points at and delete them with run_delete. Every version of the
-- built-in agent gets them, as 0059 did for the agent tools (D254). Other agents' grants are
-- unchanged (D293).
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
  JOIN "ai"."agent" a ON a."id" = v."agent_id" AND a."is_builtin"
 CROSS JOIN (VALUES
	('run_list'),
	('run_get')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
