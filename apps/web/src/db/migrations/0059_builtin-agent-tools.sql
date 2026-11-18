-- The built-in Assistant holds the agent tools (D254). Each is T2 and its approval goes to a
-- holder of approvals:decide other than the person asking (D253). Every version of the built-in
-- agent gets them, as its defaults (BUILTIN_DEFAULTS.tools) now carry them.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
  JOIN "ai"."agent" a ON a."id" = v."agent_id" AND a."is_builtin"
 CROSS JOIN (VALUES
	('agent_create'),
	('agent_edit'),
	('agent_tool_grant_edit'),
	('agent_skill_edit'),
	('agent_knowledge_access_edit'),
	('agent_memory_access_edit'),
	('agent_trust_edit'),
	('agent_run_budget_edit'),
	('agent_publish'),
	('agent_delete')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
