-- Every request step offers Reject beside Return (D218), so an agent working a step has the tool
-- for it, in the default grant (D122) like the rest, and every version gets it as 0048 did.
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", 'request_rejection_create'
  FROM "ai"."agent_version" v
ON CONFLICT DO NOTHING;
