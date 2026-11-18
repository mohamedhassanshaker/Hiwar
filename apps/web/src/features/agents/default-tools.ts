/**
 * What the harness itself calls over the platform MCP server to run a run at all — an
 * approval, a question, the start of a delegated run and its finish.
 *
 * Not model-callable: the model is never told these names. They are granted because the
 * harness's own plumbing speaks to the platform with the run's token, so a run token that
 * could not call them could not record an approval or finish.
 */
export const HARNESS_PLUMBING_TOOLS = [
  "approval_create",
  "agent_question_create",
  "run_start",
  "run_finish",
  // A run outliving its 30-minute token asks for a new one on this (#31). On the harness
  // token, like the rest of the plumbing: the model has no business re-crediting its run,
  // and a model token presenting it is refused.
  "run_token_refresh",
] as const;

/**
 * The platform tools an agent is granted unless its configuration says otherwise.
 *
 * Specification 7.4: an agent is its instructions *and* its skills, tools, memory and
 * knowledge — so what a run may call is its configuration, held in `ai.agent_platform_tool`
 * and read per run (D38). This list is no longer that configuration: it is the default a
 * new agent is created with and the one every agent that predates the table was migrated
 * to, so nothing an agent could do before the grant existed stopped working.
 *
 * It is `list`/`get`/`create`/`edit` class work only. `publish` and `delete` are T2: they
 * are grantable per agent and off by default (D63).
 *
 * Every name here must be a tool the model can actually be offered — that is, one the
 * harness has a spec for (D78).
 */
export const DEFAULT_PLATFORM_TOOLS = [
  // Reads.
  "my_attention",
  "page_read",
  "file_search",
  "file_list",
  "artifact_list",
  "request_read",
  "request_list",
  "request_type_get",
  "settings_get",
  "work_item_read",
  "work_item_search",
  "knowledge_search",
  "knowledge_collection_list",
  "knowledge_collection_get",
  "memory_search",
  "memory_list",
  "project_list",
  "org_unit_list",
  "person_list",
  "role_list",
  "skill_list",
  "connector_list",
  "connector_operation_list",
  "channel_list",
  "deployment_list",
  "storyline_problem_list",
  "storyline_simulation_create",
  "budget_list",
  "integration_client_list",
  "conversation_scenario_list",
  "agent_list",
  "agent_get",
  "run_list",
  "run_get",
  "room_list",
  "schedule_list",
  // Writes that create or amend, which is the work an agent is asked to do.
  "artifact_create",
  "memory_write",
  "work_item_create",
  "work_item_edit",
  "work_item_assignee_edit",
  "work_item_comment_create",
  "work_item_sub_item_create",
  "work_item_review_create",
  "work_item_approval_create",
  "work_item_change_request_create",
  "request_create",
  "request_step_action_create",
  "request_change_request_create",
  "request_rejection_create",
  "request_type_create",
  "request_type_edit",
  "request_type_step_create",
  "request_type_step_edit",
  "request_type_audience_create",
  "request_type_rule_create",
  "request_type_rule_edit",
  "request_type_attribute_create",
  "request_type_attribute_edit",
  "project_create",
  "project_edit",
  "project_member_create",
  "org_unit_create",
  "org_unit_edit",
  "knowledge_collection_create",
  "knowledge_collection_edit",
  "knowledge_source_create",
  "knowledge_source_reindex_create",
  "knowledge_collection_reindex_create",
  "skill_create",
  "file_create",
  "file_edit",
  "attachment_create",
  "budget_create",
  "budget_edit",
  "conversation_scenario_create",
] as const;

/**
 * Platform writes the built-in Assistant is given by default and any other agent only when
 * granted (D265), so a domain agent cannot reach them unless somebody chose to give them.
 */
export const BUILTIN_ONLY_PLATFORM_TOOLS = [
  "deployment_create",
  "deployment_edit",
  "storyline_create",
  "storyline_edit",
  "storyline_step_create",
  "storyline_step_edit",
  "storyline_step_delete",
  "room_create",
  "room_edit",
  "room_participant_create",
  "room_participant_delete",
  "room_closure_create",
  "room_fork_create",
  "schedule_create",
  "schedule_edit",
  "schedule_activation_edit",
  "schedule_run_create",
  // Checking a connector answers and re-reading its tools (D277).
  "connector_test_create",
  "connector_refresh_create",
] as const;

/**
 * The tools the harness answers inside the run, which never reach the platform MCP
 * server (D80).
 *
 * They are configuration like any other tool: on by default, switchable per agent, out
 * of the same stored grant as the platform tools. Leaving them outside it would keep a
 * second answer to "what may this agent do", which is the drift D74 removed everywhere
 * else. The platform cannot refuse one — it never sees the call — so the grant is what
 * the harness reads to decide whether to offer it at all.
 */
export const HARNESS_BUILTIN_TOOLS = [
  "delegate_to_agent",
  "knowledge_search",
  "generate_document",
  "ask_person",
  "write_handoff",
  // A granted skill's scripts, in the run's sandbox (D209); offered only when one ships a script.
  "skill_script_run",
  "workspace_file_write",
  "workspace_file_read",
  "workspace_file_save",
] as const;

/**
 * What a new agent is granted, and what every agent that predates the grant table was
 * migrated to: today's platform default plus the harness's own built-ins.
 *
 * One list, used by the seed, by agent creation and by migration 0034, so the three
 * cannot disagree about what "default" means.
 */
export const DEFAULT_TOOL_GRANT: string[] = [
  ...new Set<string>([...DEFAULT_PLATFORM_TOOLS, ...HARNESS_BUILTIN_TOOLS]),
];
