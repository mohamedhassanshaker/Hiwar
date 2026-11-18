-- D381: the built-in Assistant deletes an invited or suspended person with `person_delete`, a T2
-- tool, so each call waits for an approval. Every version of the built-in agent gets it, as its
-- defaults (BUILTIN_DEFAULTS.tools) now carry it; any other agent only when it is granted.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", 'person_delete'
  FROM "ai"."agent_version" v
  JOIN "ai"."agent" a ON a."id" = v."agent_id" AND a."is_builtin"
ON CONFLICT DO NOTHING;
