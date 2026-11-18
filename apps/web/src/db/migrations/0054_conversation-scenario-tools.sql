-- A deployment's agent starts a website service from what a visitor typed (D231), with the two
-- tools in the default grant (D122) like the rest, and every version gets them as 0048 did.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", tool.name
  FROM "ai"."agent_version" v
 CROSS JOIN (VALUES ('conversation_scenario_list'), ('conversation_scenario_create')) AS tool(name)
ON CONFLICT DO NOTHING;
