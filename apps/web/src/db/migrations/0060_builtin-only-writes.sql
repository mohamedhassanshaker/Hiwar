-- The deployment, storyline, room and schedule writes are the built-in Assistant's by default
-- and any other agent's only when granted (D265, amending D253). Migration 0058 gave them to
-- every version; this takes back the ones it gave to other agents. A grant a person made has
-- its author recorded and is kept.
DELETE FROM "ai"."agent_platform_tool" t
 USING "ai"."agent_version" v, "ai"."agent" a
 WHERE t."agent_version_id" = v."id"
   AND v."agent_id" = a."id"
   AND NOT a."is_builtin"
   AND t."created_by" IS NULL
   AND t."tool_name" IN (
	'deployment_create',
	'deployment_edit',
	'storyline_create',
	'storyline_edit',
	'storyline_step_create',
	'storyline_step_edit',
	'storyline_step_delete',
	'room_create',
	'room_edit',
	'room_participant_create',
	'room_participant_delete',
	'room_closure_create',
	'schedule_create',
	'schedule_edit',
	'schedule_activation_edit'
   );
