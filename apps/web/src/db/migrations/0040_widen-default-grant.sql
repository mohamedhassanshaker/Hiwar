-- The default grant was twelve read-ish names while the catalogue grew to eighty-seven,
-- so an agent asked to create a request type answered that it only reads. Every agent
-- version gets the reads and the create/edit writes it should always have had; publish,
-- delete and the setup tools stay out, grantable per agent rather than given (D63).
INSERT INTO "ai"."agent_platform_tool" ("agent_version_id", "tool_name")
SELECT av."id", t."name"
  FROM "ai"."agent_version" av
 CROSS JOIN (VALUES
   ('my_attention'),('page_read'),('file_search'),('file_list'),('artifact_list'),
   ('request_read'),('work_item_read'),('work_item_search'),('knowledge_search'),
   ('knowledge_collection_list'),('knowledge_collection_get'),('knowledge_passage_search'),
   ('memory_search'),('memory_list'),('project_list'),('org_unit_list'),('person_list'),
   ('role_list'),('skill_list'),('connector_list'),('connector_operation_list'),
   ('channel_list'),('deployment_list'),('storyline_problem_list'),
   ('storyline_simulation_create'),('budget_list'),('integration_client_list'),
   ('artifact_create'),('memory_write'),('memory_create'),('work_item_create'),
   ('work_item_edit'),('work_item_set_status'),('work_item_comment_create'),
   ('work_item_sub_item_create'),('work_item_review_create'),('work_item_approval_create'),
   ('work_item_change_request_create'),('request_create'),('request_step_action_create'),
   ('request_type_create'),('request_type_edit'),('request_type_step_create'),
   ('request_type_step_edit'),('request_type_audience_create'),('request_type_rule_create'),
   ('request_type_attribute_create'),('project_create'),('project_edit'),
   ('project_member_create'),('org_unit_create'),('org_unit_edit'),
   ('knowledge_collection_create'),('knowledge_collection_edit'),('knowledge_source_create'),
   ('skill_create'),('skill_test_case_create'),('skill_test_run_create'),('file_create'),
   ('file_edit'),('attachment_create'),('budget_create'),('budget_edit')
 ) AS t("name")
    ON CONFLICT DO NOTHING;
