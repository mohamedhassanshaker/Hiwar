-- The catalogue covers deployments, storylines, rooms and schedules (D253). Their reads and
-- amendments are in the default grant (D122), so every version gets them, as 0048 did. The
-- agent tools are T2 and, like every T2 tool, granted per agent rather than given (D63).
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT v."id", t."tool_name"
  FROM "ai"."agent_version" v
 CROSS JOIN (VALUES
	('agent_list'),
	('agent_get'),
	('room_list'),
	('schedule_list'),
	('deployment_create'),
	('deployment_edit'),
	('storyline_create'),
	('storyline_edit'),
	('storyline_step_create'),
	('storyline_step_edit'),
	('storyline_step_delete'),
	('room_create'),
	('room_edit'),
	('room_participant_create'),
	('room_participant_delete'),
	('room_closure_create'),
	('schedule_create'),
	('schedule_edit'),
	('schedule_activation_edit')
 ) AS t("tool_name")
ON CONFLICT DO NOTHING;
