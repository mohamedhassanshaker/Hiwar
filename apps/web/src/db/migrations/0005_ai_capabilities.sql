CREATE SCHEMA "ai";
--> statement-breakpoint
CREATE SCHEMA "gov";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "work";
--> statement-breakpoint
CREATE TABLE "ai"."agent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"initials" text NOT NULL,
	"org_unit_id" uuid,
	"reports_to_type" text,
	"reports_to_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"default_version" integer,
	"status" text DEFAULT 'Idle' NOT NULL,
	"active_version_id" uuid,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_status_check" CHECK ("status" in ('Idle', 'Running', 'Waiting', 'Paused', 'Error', 'Retired')),
	CONSTRAINT "agent_reports_to_check" CHECK ("reports_to_type" is null or "reports_to_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client'))
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_knowledge_access" (
	"agent_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_knowledge_access_pk" PRIMARY KEY("agent_version_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_memory_access" (
	"agent_version_id" uuid NOT NULL,
	"memory_scope_id" uuid NOT NULL,
	"access" text DEFAULT 'Read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_memory_access_pk" PRIMARY KEY("agent_version_id","memory_scope_id"),
	CONSTRAINT "agent_memory_access_check" CHECK ("access" in ('Read', 'ReadWrite'))
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_platform_tool" (
	"agent_version_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_platform_tool_pk" PRIMARY KEY("agent_version_id","tool_name")
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_question" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"asked_to_type" text NOT NULL,
	"asked_to_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" text[],
	"answer" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_question_asked_to_check" CHECK ("asked_to_type" in ('Person', 'Group'))
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_skill" (
	"agent_version_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_skill_pk" PRIMARY KEY("agent_version_id","skill_version_id")
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_tool_mode" (
	"agent_version_id" uuid NOT NULL,
	"connector_tool_id" uuid NOT NULL,
	"mode" text DEFAULT 'Approval' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_tool_mode_pk" PRIMARY KEY("agent_version_id","connector_tool_id"),
	CONSTRAINT "agent_tool_mode_check" CHECK ("mode" in ('Auto', 'Approval', 'Denied'))
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"execution_profile" text DEFAULT 'Task' NOT NULL,
	"primary_route_id" uuid,
	"fallback_route_id" uuid,
	"trust" text DEFAULT 'Standard' NOT NULL,
	"memory_enabled" boolean DEFAULT false NOT NULL,
	"run_budget_soft_aed" numeric(18, 4),
	"run_budget_hard_aed" numeric(18, 4),
	"release_notes" text,
	"eval_score" numeric(5, 2),
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_version_profile_check" CHECK ("execution_profile" in ('Conversational', 'Task', 'Planner', 'Reviewer', 'Triage', 'Scripted', 'Routine')),
	CONSTRAINT "agent_version_trust_check" CHECK ("trust" in ('Restricted', 'Standard', 'Elevated', 'Coordinator', 'System')),
	CONSTRAINT "agent_version_budget_check" CHECK ("run_budget_soft_aed" is null or "run_budget_hard_aed" is null or "run_budget_soft_aed" <= "run_budget_hard_aed")
);
--> statement-breakpoint
CREATE TABLE "ai"."approval" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"run_id" uuid,
	"requested_by_type" text NOT NULL,
	"requested_by_id" uuid,
	"work_item_id" uuid,
	"request_id" uuid,
	"action" text NOT NULL,
	"call_id" text,
	"arguments_redacted" jsonb,
	"arguments_hash" text,
	"target_version" integer,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"evidence" text,
	"risk" text DEFAULT 'Medium' NOT NULL,
	"policy" text DEFAULT 'Single' NOT NULL,
	"escalate_after" timestamp with time zone,
	"status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_requester_check" CHECK ("requested_by_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "approval_risk_check" CHECK ("risk" in ('Low', 'Medium', 'High')),
	CONSTRAINT "approval_policy_check" CHECK ("policy" in ('Single', 'AnyOf', 'Sequential')),
	CONSTRAINT "approval_status_check" CHECK ("status" in ('Pending', 'Approved', 'Rejected', 'ChangesRequested', 'Expired')),
	CONSTRAINT "approval_arguments_check" CHECK ("arguments_redacted" is null or jsonb_typeof("arguments_redacted") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."approval_decision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"approval_id" uuid NOT NULL,
	"approver_person_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_decision_check" CHECK ("decision" in ('Approved', 'Rejected', 'ChangesRequested')),
	CONSTRAINT "approval_decision_reason_check" CHECK (("decision" <> 'Rejected') or ("reason" is not null and length(btrim("reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "ai"."assistant_chat" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"screen" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."assistant_chat_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"body_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "assistant_chat_message_role_check" CHECK ("role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "ai"."channel" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Disabled' NOT NULL,
	"binding_type" text,
	"binding_id" uuid,
	"unknown_senders" text DEFAULT 'ExternalContact' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"business_hours" text DEFAULT 'AlwaysOn' NOT NULL,
	"secret_ref" "bytea",
	"endpoint_url" text,
	"inbound_secret_ref" "bytea",
	"offline_message_en" text,
	"offline_message_ar" text,
	"last_test_at" timestamp with time zone,
	"last_test_result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "channel_type_check" CHECK ("type" in ('WebWidget', 'WhatsApp', 'MicrosoftTeams', 'Slack', 'Email', 'Sms', 'VoiceIvr', 'Telegram', 'Webex', 'GoogleChat', 'Instagram', 'FacebookMessenger')),
	CONSTRAINT "channel_status_check" CHECK ("status" in ('Enabled', 'Degraded', 'Disabled')),
	CONSTRAINT "channel_binding_check" CHECK ("binding_type" is null or "binding_type" in ('EmbeddedDeployment', 'RoomMirror', 'RequestIntake')),
	CONSTRAINT "channel_unknown_senders_check" CHECK ("unknown_senders" in ('ExternalContact', 'Ignore')),
	CONSTRAINT "channel_business_hours_check" CHECK ("business_hours" in ('AlwaysOn', 'WorkingCalendar')),
	CONSTRAINT "channel_last_test_check" CHECK ("last_test_result_json" is null or jsonb_typeof("last_test_result_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."channel_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_key" text NOT NULL,
	"body_text" text,
	"action" text NOT NULL,
	"detail" text,
	"conversation_id" uuid,
	"room_id" uuid,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "channel_message_direction_check" CHECK ("direction" in ('Inbound', 'Outbound')),
	CONSTRAINT "channel_message_action_check" CHECK ("action" in ('Process', 'Offline', 'Throttled', 'Dropped'))
);
--> statement-breakpoint
CREATE TABLE "ai"."connection_allowed_model" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"modalities" text[] DEFAULT '{text}'::text[] NOT NULL,
	"kind" text DEFAULT 'Chat' NOT NULL,
	"context_window" integer,
	"price_in" numeric(18, 6),
	"price_out" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connection_allowed_model_kind_check" CHECK ("kind" in ('Chat', 'Embedding', 'Image', 'Speech', 'Transcription', 'Rerank', 'Decision', 'Audio', 'Video'))
);
--> statement-breakpoint
CREATE TABLE "ai"."connector" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"catalog_entry_id" uuid,
	"transport" text DEFAULT 'StreamableHttp' NOT NULL,
	"server_url" text,
	"command" text,
	"auth_type" text DEFAULT 'None' NOT NULL,
	"secret_ref" "bytea",
	"default_tier_for_new_tools" text DEFAULT 'T1' NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Disabled' NOT NULL,
	"last_handshake_at" timestamp with time zone,
	"protocol_version" text,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connector_transport_check" CHECK ("transport" in ('StreamableHttp', 'Stdio', 'OpenApi')),
	CONSTRAINT "connector_auth_check" CHECK ("auth_type" in ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'Basic', 'None')),
	CONSTRAINT "connector_status_check" CHECK ("status" in ('Connected', 'Error', 'Disabled')),
	CONSTRAINT "connector_default_tier_check" CHECK ("default_tier_for_new_tools" in ('T0', 'T1', 'T2', 'T3'))
);
--> statement-breakpoint
CREATE TABLE "ai"."connector_allowed_agent" (
	"connector_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connector_allowed_agent_pk" PRIMARY KEY("connector_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "ai"."connector_catalog_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"logo_ref" text,
	"default_url" text,
	"auth_type" text DEFAULT 'None' NOT NULL,
	"tool_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connector_catalog_auth_check" CHECK ("auth_type" in ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'Basic', 'None'))
);
--> statement-breakpoint
CREATE TABLE "ai"."connector_tool" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connector_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"read_only_hint" boolean,
	"destructive_hint" boolean,
	"tier" text DEFAULT 'T1' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"operation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connector_tool_tier_check" CHECK ("tier" in ('T0', 'T1', 'T2', 'T3')),
	CONSTRAINT "connector_tool_operation_check" CHECK ("operation" is null or jsonb_typeof("operation") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"text_en" text,
	"text_ar" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "conversation_message_role_check" CHECK ("role" in ('Visitor', 'Agent', 'HumanAgent', 'System')),
	CONSTRAINT "conversation_message_payload_check" CHECK ("payload_json" is null or jsonb_typeof("payload_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."deployment_conversation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"storyline_version_id" uuid,
	"external_contact_id" uuid,
	"channel_id" uuid,
	"visitor_key" text,
	"state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"room_id" uuid,
	"current_step_id" uuid,
	"slots_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"request_id" uuid,
	"rating" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"agent_paused_by" uuid,
	"agent_paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deployment_conversation_outcome_check" CHECK ("outcome" is null or "outcome" in ('Completed', 'HandedOff', 'Abandoned', 'Cancelled', 'RequestCreated')),
	CONSTRAINT "deployment_conversation_slots_check" CHECK ("slots_json" is null or jsonb_typeof("slots_json") = 'object'),
	CONSTRAINT "deployment_conversation_state_check" CHECK ("state_json" is null or jsonb_typeof("state_json") = 'object'),
	CONSTRAINT "deployment_conversation_rating_check" CHECK ("rating" is null or "rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "ai"."deployment_surface" (
	"deployment_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"channel_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deployment_surface_pk" PRIMARY KEY("deployment_id","surface"),
	CONSTRAINT "deployment_surface_check" CHECK ("surface" in ('Widget', 'WhatsApp', 'Teams'))
);
--> statement-breakpoint
CREATE TABLE "ai"."embedded_deployment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"default_agent_id" uuid,
	"status" text DEFAULT 'Draft' NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"visitor_identity" text DEFAULT 'AnonymousOtpStepUp' NOT NULL,
	"visitor_jwt_secret_ref" "bytea",
	"visitor_jwt_fallback" text DEFAULT 'Anonymous' NOT NULL,
	"handoff_queue" text,
	"rate_limit_per_visitor" integer DEFAULT 30 NOT NULL,
	"widget_title_en" text,
	"widget_title_ar" text,
	"accent_colour" text,
	"welcome_message_en" text,
	"welcome_message_ar" text,
	"active_storyline_version_id" uuid,
	"run_as_person_id" uuid,
	"disclaimer_en" text,
	"disclaimer_ar" text,
	"disclaimer_dismissible" boolean DEFAULT true NOT NULL,
	"quick_actions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voice_input" boolean DEFAULT true NOT NULL,
	"read_aloud" boolean DEFAULT true NOT NULL,
	"session_idle_minutes" integer DEFAULT 30 NOT NULL,
	"progress_retention_minutes" integer DEFAULT 1440 NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "embedded_deployment_status_check" CHECK ("status" in ('Enabled', 'Disabled', 'Draft')),
	CONSTRAINT "embedded_deployment_identity_check" CHECK ("visitor_identity" in ('AnonymousOtpStepUp', 'SignedJwt')),
	CONSTRAINT "embedded_deployment_jwt_fallback_check" CHECK ("visitor_jwt_fallback" in ('Anonymous', 'Refuse'))
);
--> statement-breakpoint
CREATE TABLE "ai"."inbox_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title_en" text,
	"title_ar" text,
	"link_path" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_item_kind_check" CHECK ("kind" in ('Approval', 'Question', 'Mention', 'SlaWarning', 'Review', 'Update')),
	CONSTRAINT "inbox_item_status_check" CHECK ("status" in ('Open', 'Resolved'))
);
--> statement-breakpoint
CREATE TABLE "ai"."ingestion_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"collection_id" uuid NOT NULL,
	"source_id" uuid,
	"kind" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Queued' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"temporal_workflow_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ingestion_job_kind_check" CHECK ("kind" in ('Ingest', 'Reindex', 'ReindexAll')),
	CONSTRAINT "ingestion_job_status_check" CHECK ("status" in ('Queued', 'Running', 'Succeeded', 'Failed')),
	CONSTRAINT "ingestion_job_progress_check" CHECK ("progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "ai"."knowledge_collection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"collection_id" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"project_id" uuid,
	"visibility" text DEFAULT 'Internal' NOT NULL,
	"status" text DEFAULT 'Ready' NOT NULL,
	"index_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chunking_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"models_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retrieval_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("collection_id", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "knowledge_collection_status_check" CHECK ("status" in ('Ready', 'Ingesting', 'Error')),
	CONSTRAINT "knowledge_collection_visibility_check" CHECK ("visibility" in ('Public', 'Internal', 'Confidential', 'Restricted')),
	CONSTRAINT "knowledge_collection_index_check" CHECK ("index_config_json" is null or jsonb_typeof("index_config_json") = 'object'),
	CONSTRAINT "knowledge_collection_chunking_check" CHECK ("chunking_config_json" is null or jsonb_typeof("chunking_config_json") = 'object'),
	CONSTRAINT "knowledge_collection_models_check" CHECK ("models_config_json" is null or jsonb_typeof("models_config_json") = 'object'),
	CONSTRAINT "knowledge_collection_retrieval_check" CHECK ("retrieval_config_json" is null or jsonb_typeof("retrieval_config_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."knowledge_document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"raw_ref" text NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'Indexed' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "knowledge_document_status_check" CHECK ("status" in ('Indexed', 'Indexing', 'Error'))
);
--> statement-breakpoint
CREATE TABLE "ai"."knowledge_source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"collection_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Indexed' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "knowledge_source_type_check" CHECK ("type" in ('Upload', 'UrlCrawl', 'McpResource')),
	CONSTRAINT "knowledge_source_status_check" CHECK ("status" in ('Indexed', 'Indexing', 'Error')),
	CONSTRAINT "knowledge_source_config_check" CHECK ("config_json" is null or jsonb_typeof("config_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."memory" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"path" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'Active' NOT NULL,
	"access_json" jsonb,
	"write_policy_json" jsonb,
	"review_due_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"current_version" integer DEFAULT 1 NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title_en", '') || ' ' || coalesce("title_ar", '') || ' ' || coalesce("path", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_status_check" CHECK ("status" in ('Active', 'PendingReview', 'NeedsAttention', 'Rejected', 'Archived')),
	CONSTRAINT "memory_owner_check" CHECK ("owner_type" is null or "owner_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "memory_access_check" CHECK ("access_json" is null or jsonb_typeof("access_json") = 'object'),
	CONSTRAINT "memory_write_policy_check" CHECK ("write_policy_json" is null or jsonb_typeof("write_policy_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."memory_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"memory_version_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_entry_source_check" CHECK ("source_type" in ('AgentRun', 'Person', 'Document'))
);
--> statement-breakpoint
CREATE TABLE "ai"."memory_review" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"memory_id" uuid NOT NULL,
	"memory_version_id" uuid,
	"proposed_by_agent_id" uuid,
	"reviewer_person_id" uuid,
	"decision" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_review_decision_check" CHECK ("decision" is null or "decision" in ('Approved', 'Rejected'))
);
--> statement-breakpoint
CREATE TABLE "ai"."memory_scope" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid,
	"person_id" uuid,
	"parent_scope_id" uuid,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_scope_kind_check" CHECK ("kind" in ('Organisation', 'BusinessUnit', 'Agent', 'Session'))
);
--> statement-breakpoint
CREATE TABLE "ai"."memory_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"memory_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content_ref" text,
	"content" text,
	"change_note" text,
	"created_by_type" text NOT NULL,
	"created_by_id" uuid,
	"restored_from_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_version_creator_check" CHECK ("created_by_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client'))
);
--> statement-breakpoint
CREATE TABLE "ai"."model_provider" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text DEFAULT 'Cloud' NOT NULL,
	"gateway_provider" text DEFAULT 'Custom' NOT NULL,
	"engine" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "model_provider_kind_check" CHECK ("kind" in ('Cloud', 'Custom')),
	CONSTRAINT "model_provider_gateway_check" CHECK ("gateway_provider" in ('Anthropic', 'Azure', 'Baseten', 'Bedrock', 'Cerebras', 'Cohere', 'Custom', 'Deepinfra', 'Deepseek', 'Fireworks', 'Gemini', 'Groq', 'Huggingface', 'Meta', 'Mistral', 'Ollama', 'OpenAI', 'Openrouter', 'TogetherAI', 'VertexAI', 'XAI')),
	CONSTRAINT "model_provider_custom_gateway_check" CHECK (("kind" <> 'Custom') or ("gateway_provider" = 'Custom')),
	CONSTRAINT "model_provider_engine_check" CHECK ("engine" is null or "engine" in ('Ollama', 'VLlm', 'LmStudio', 'Tgi', 'LlamaCpp', 'LocalAi', 'TritonNim', 'OpenAiCompatible')),
	CONSTRAINT "model_provider_engine_required_check" CHECK (("kind" = 'Cloud' and "engine" is null) or ("kind" = 'Custom' and "engine" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai"."playground_test" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"duration_ms" integer,
	"estimated_cost_aed" numeric(18, 4),
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."provider_connection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"base_url" text,
	"auth_type" text DEFAULT 'ApiKey' NOT NULL,
	"secret_ref" "bytea",
	"is_active" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "provider_connection_auth_check" CHECK ("auth_type" in ('ApiKey', 'EntraId', 'IamRole', 'BearerToken', 'OAuth', 'None')),
	CONSTRAINT "provider_connection_last_test_check" CHECK ("last_test_result_json" is null or jsonb_typeof("last_test_result_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."retrieval_test" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"collection_id" uuid,
	"query" text NOT NULL,
	"mode" text NOT NULL,
	"duration_ms" integer,
	"results_json" jsonb,
	"run_by" uuid,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "retrieval_test_mode_check" CHECK ("mode" in ('Vector', 'Graph', 'Hybrid')),
	CONSTRAINT "retrieval_test_results_check" CHECK ("results_json" is null or jsonb_typeof("results_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."route" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"alias" text NOT NULL,
	"kind" text DEFAULT 'Standard' NOT NULL,
	"output_schema_json" jsonb,
	"confidence_threshold" numeric(5, 4),
	"max_retries_on_invalid" integer,
	"voice_mode" text,
	"stt_model" text,
	"tts_voice" text,
	"languages" text[],
	"barge_in" boolean,
	"max_call_minutes" integer,
	"route_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "route_kind_check" CHECK ("kind" in ('Standard', 'Typesafe', 'Voice', 'Embedding', 'Decision')),
	CONSTRAINT "route_voice_mode_check" CHECK ("voice_mode" is null or "voice_mode" in ('Realtime', 'Pipeline')),
	CONSTRAINT "route_output_schema_check" CHECK ("output_schema_json" is null or jsonb_typeof("output_schema_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai"."route_step" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"route_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"provider_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"context_type" text NOT NULL,
	"granted_tools" text[],
	"parent_run_id" uuid,
	"context_id" uuid,
	"status" text DEFAULT 'Queued' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"waiting_seconds" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cache_hit_pct" numeric(5, 2),
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_aed" numeric(18, 4) DEFAULT 0 NOT NULL,
	"temporal_workflow_id" text,
	"trace_id" text,
	"replay_of_run_id" uuid,
	"replay_from_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "run_trigger_check" CHECK ("trigger" in ('Mention', 'Assignment', 'RequestStep', 'Schedule', 'Widget', 'Manual', 'Replay', 'Delegation')),
	CONSTRAINT "run_context_check" CHECK ("context_type" in ('Room', 'WorkItem', 'Request', 'Deployment', 'Console')),
	CONSTRAINT "run_status_check" CHECK ("status" in ('Queued', 'Running', 'Waiting', 'Blocked', 'Succeeded', 'Failed', 'Cancelled', 'BudgetExceeded'))
);
--> statement-breakpoint
CREATE TABLE "ai"."run_step" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"result" text,
	"hooks_applied" text[] DEFAULT '{}'::text[] NOT NULL,
	"estimated_cost_aed" numeric(18, 4) DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "run_step_pk" PRIMARY KEY("id","started_at"),
	CONSTRAINT "run_step_type_check" CHECK ("type" in ('Start', 'Model', 'Tool', 'Skill', 'Approval', 'Question', 'Verify', 'Handoff'))
);
--> statement-breakpoint
CREATE TABLE "ai"."skill" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"skill_name" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"source_type" text DEFAULT 'Authored' NOT NULL,
	"source_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_person_id" uuid,
	"current_version_id" uuid,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("skill_name", '') || ' ' || coalesce("title_en", '') || ' ' || coalesce("title_ar", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "skill_source_check" CHECK ("source_type" in ('Bundled', 'Uploaded', 'Git', 'Registry', 'Authored'))
);
--> statement-breakpoint
CREATE TABLE "ai"."skill_scan_result" (
	"skill_version_id" uuid PRIMARY KEY NOT NULL,
	"scripts" integer DEFAULT 0 NOT NULL,
	"network_calls" integer DEFAULT 0 NOT NULL,
	"prompt_injection_patterns" integer DEFAULT 0 NOT NULL,
	"embedded_secrets" integer DEFAULT 0 NOT NULL,
	"sandbox_only" boolean DEFAULT true NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."skill_test_case" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" text,
	"expected" text,
	"last_result" text,
	"last_duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."skill_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"package_ref" text,
	"checksum" text,
	"frontmatter_valid" boolean DEFAULT false NOT NULL,
	"declared_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "skill_version_status_check" CHECK ("status" in ('Draft', 'Published'))
);
--> statement-breakpoint
CREATE TABLE "ai"."storyline" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."storyline_step" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"storyline_version_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"step_type" text NOT NULL,
	"agent_override_id" uuid,
	"message_en" text,
	"message_ar" text,
	"send_verbatim" boolean DEFAULT false NOT NULL,
	"slot" text,
	"max_attempts" integer,
	"verify_method" text,
	"handoff_queue" text,
	"tool_refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"skill_refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_step_id" uuid,
	"on_error" text DEFAULT 'Handoff' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "storyline_step_type_check" CHECK ("step_type" in ('Message', 'Ask', 'Form', 'Confirm', 'Decide', 'Classify', 'Tool', 'Skill', 'Verify', 'CreateWork', 'Handoff', 'Wait', 'Subflow', 'GoTo', 'End')),
	CONSTRAINT "storyline_step_on_error_check" CHECK ("on_error" in ('RetryOnce', 'GoToStep', 'Handoff')),
	CONSTRAINT "storyline_step_config_check" CHECK ("config_json" is null or jsonb_typeof("config_json") = 'object'),
	CONSTRAINT "storyline_step_verbatim_check" CHECK ((not "send_verbatim") or ("message_en" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai"."storyline_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"storyline_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"mode" text DEFAULT 'Guided' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "storyline_version_mode_check" CHECK ("mode" in ('Guided', 'Strict')),
	CONSTRAINT "storyline_version_status_check" CHECK ("status" in ('Draft', 'Published', 'Superseded'))
);
--> statement-breakpoint
CREATE TABLE "ai"."widget_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"conversation_id" uuid,
	"name" text NOT NULL,
	"props_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gov"."agent_budget" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_id" uuid NOT NULL,
	"limit_aed" numeric(18, 4) NOT NULL,
	"period" text DEFAULT 'Monthly' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"warn_at_pct" integer DEFAULT 80 NOT NULL,
	"action_at_100" text DEFAULT 'NotifyOnly' NOT NULL,
	"cheaper_route_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_budget_period_check" CHECK ("period" in ('Daily', 'Weekly', 'Monthly', 'Quarterly')),
	CONSTRAINT "agent_budget_action_check" CHECK ("action_at_100" in ('NotifyOnly', 'SwitchToCheaperAlias', 'PauseAgent')),
	CONSTRAINT "agent_budget_warn_check" CHECK ("warn_at_pct" between 1 and 100),
	CONSTRAINT "agent_budget_window_check" CHECK ("effective_to" is null or "effective_to" > "effective_from"),
	CONSTRAINT "agent_budget_cheaper_route_check" CHECK ("action_at_100" <> 'SwitchToCheaperAlias' or "cheaper_route_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "gov"."branding_asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"content_ref" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "branding_asset_kind_check" CHECK ("kind" in ('LogoLight', 'LogoDark', 'Favicon'))
);
--> statement-breakpoint
CREATE TABLE "gov"."budget_change" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"description_en" text NOT NULL,
	"description_ar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gov"."budget_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"period_id" uuid,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail_en" text,
	"detail_ar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_event_type_check" CHECK ("type" in ('WarningSent', 'HardLimitReached', 'ActionApplied'))
);
--> statement-breakpoint
CREATE TABLE "gov"."budget_period" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"estimated_spend_aed" numeric(18, 4) DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_period_window_check" CHECK ("period_end" > "period_start")
);
--> statement-breakpoint
CREATE TABLE "gov"."client_agent" (
	"client_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_agent_pk" PRIMARY KEY("client_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "gov"."client_agui_exposure" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"allowed_events" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gov"."client_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_key_status_check" CHECK ("status" in ('Active', 'Revoked'))
);
--> statement-breakpoint
CREATE TABLE "gov"."client_mcp_exposure" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"auth_type" text DEFAULT 'ApiKey' NOT NULL,
	"exposed_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_mcp_exposure_auth_check" CHECK ("auth_type" in ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'Basic', 'None'))
);
--> statement-breakpoint
CREATE TABLE "gov"."client_permission" (
	"client_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_permission_pk" PRIMARY KEY("client_id","permission"),
	CONSTRAINT "client_permission_check" CHECK ("permission" in ('agents:invoke', 'requests:write', 'work_items:read', 'rooms:read', 'knowledge:search', 'webhooks:receive'))
);
--> statement-breakpoint
CREATE TABLE "gov"."doc_page" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title_en", '') || ' ' || coalesce("title_ar", '') || ' ' || coalesce("slug", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gov"."feature_flag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"group" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "feature_flag_group_check" CHECK ("group" in ('AgentsAndRuns', 'MemoryAndKnowledge', 'Collaboration', 'Engage', 'Platform'))
);
--> statement-breakpoint
CREATE TABLE "gov"."integration_client" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"owner_person_id" uuid,
	"status" text DEFAULT 'Active' NOT NULL,
	"all_agents" boolean DEFAULT false NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("client_id", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "integration_client_status_check" CHECK ("status" in ('Active', 'Inactive'))
);
--> statement-breakpoint
CREATE TABLE "gov"."log_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"context_json" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "log_entry_level_check" CHECK ("level" in ('Debug', 'Info', 'Warn', 'Error')),
	CONSTRAINT "log_entry_context_check" CHECK ("context_json" is null or jsonb_typeof("context_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "gov"."mail_notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"notification_key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"person_id" uuid,
	"recipient" text,
	"outcome" text NOT NULL,
	"status" text DEFAULT 'Queued' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"mail_subject" text,
	"mail_body" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mail_notification_kind_check" CHECK ("kind" in ('RequestCreated', 'RequestUpdated', 'RequestFinished', 'WorkItemFinished', 'Invitation', 'Test', 'AgentEmail', 'Alert')),
	CONSTRAINT "mail_notification_status_check" CHECK ("status" in ('Queued', 'Sending', 'Sent', 'Failed', 'Skipped'))
);
--> statement-breakpoint
CREATE TABLE "gov"."outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"topic" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "outbox_event_status_check" CHECK ("status" in ('Pending', 'Delivered', 'Failed')),
	CONSTRAINT "outbox_event_payload_check" CHECK ("payload_json" is null or jsonb_typeof("payload_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "gov"."settings_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version_number" integer NOT NULL,
	"settings_json" jsonb NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "settings_version_json_check" CHECK ("settings_json" is null or jsonb_typeof("settings_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "gov"."system_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agents_paused" boolean DEFAULT false NOT NULL,
	"paused_by" uuid,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_entry" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid,
	"object_label" text,
	"detail_json" jsonb,
	"outcome" text DEFAULT 'Allowed' NOT NULL,
	"correlation_id" text,
	"ip_address" text,
	CONSTRAINT "audit_entry_pk" PRIMARY KEY("id","at"),
	CONSTRAINT "audit_entry_actor_check" CHECK ("actor_type" in ('Person', 'Agent', 'Client', 'ExternalContact', 'System')),
	CONSTRAINT "audit_entry_outcome_check" CHECK ("outcome" in ('Allowed', 'Denied')),
	CONSTRAINT "audit_entry_detail_check" CHECK ("detail_json" is null or jsonb_typeof("detail_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "core"."calendar" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"working_days" integer[] NOT NULL,
	"working_hours_json" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."calendar_holiday" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."external_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"display_name" text NOT NULL,
	"channel" text NOT NULL,
	"channel_address" text NOT NULL,
	"verified_level" text DEFAULT 'None' NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("display_name", '') || ' ' || coalesce("channel_address", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."group_member" (
	"group_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "group_member_pk" PRIMARY KEY("group_id","principal_type","principal_id"),
	CONSTRAINT "group_member_principal_check" CHECK ("principal_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client'))
);
--> statement-breakpoint
CREATE TABLE "core"."organisation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"time_zone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"languages" text[] DEFAULT '{en,ar}'::text[] NOT NULL,
	"working_calendar_id" uuid,
	"holiday_calendar_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."attachment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_ref" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attachment_owner_check" CHECK ("owner_type" in ('Request', 'WorkItem', 'Room', 'Conversation'))
);
--> statement-breakpoint
CREATE TABLE "work"."context_handoff" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"goal" text,
	"decisions" text,
	"open_questions" text,
	"next_step" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "context_handoff_owner_check" CHECK ("owner_type" in ('Room', 'WorkItem', 'Request', 'Run'))
);
--> statement-breakpoint
CREATE TABLE "work"."discussion_room" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"type" text DEFAULT 'Chat' NOT NULL,
	"source" text DEFAULT 'Console' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"turn_taking" text DEFAULT 'MentionOnly' NOT NULL,
	"agent_hop_limit" integer DEFAULT 6 NOT NULL,
	"cost_cap_aed" numeric(18, 4),
	"forked_from_room_id" uuid,
	"mirror_channel_id" uuid,
	"mirror_external_ref" text,
	"last_activity_at" timestamp with time zone,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title_en", '') || ' ' || coalesce("title_ar", '') || ' ' || coalesce("key", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "discussion_room_status_check" CHECK ("status" in ('Active', 'Idle', 'Paused', 'Closed', 'Archived')),
	CONSTRAINT "discussion_room_type_check" CHECK ("type" in ('Chat', 'Review', 'WarRoom', 'Support', 'Automation')),
	CONSTRAINT "discussion_room_source_check" CHECK ("source" in ('Console', 'Teams', 'Widget', 'WhatsApp', 'Routine')),
	CONSTRAINT "discussion_room_turn_taking_check" CHECK ("turn_taking" in ('MentionOnly', 'Autonomous'))
);
--> statement-breakpoint
CREATE TABLE "work"."project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"owner_person_id" uuid,
	"org_unit_id" uuid,
	"sensitivity" text DEFAULT 'Internal' NOT NULL,
	"status" text DEFAULT 'Planned' NOT NULL,
	"require_reviewer_not_author" boolean DEFAULT true NOT NULL,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("key", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_status_check" CHECK ("status" in ('Backlog', 'Planned', 'InProgress', 'Paused', 'Done', 'Archived')),
	CONSTRAINT "project_sensitivity_check" CHECK ("sensitivity" in ('Public', 'Internal', 'Confidential', 'Restricted'))
);
--> statement-breakpoint
CREATE TABLE "work"."project_allowed_connector" (
	"project_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_allowed_connector_pk" PRIMARY KEY("project_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "work"."project_member" (
	"project_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"project_role" text DEFAULT 'Member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_member_pk" PRIMARY KEY("project_id","principal_type","principal_id"),
	CONSTRAINT "project_member_principal_check" CHECK ("principal_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "project_member_role_check" CHECK ("project_role" in ('Owner', 'Member', 'Agent'))
);
--> statement-breakpoint
CREATE TABLE "work"."request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"request_type_version_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"requester_type" text DEFAULT 'Person' NOT NULL,
	"requester_id" uuid NOT NULL,
	"channel" text DEFAULT 'Console' NOT NULL,
	"entry_mode" text DEFAULT 'Form' NOT NULL,
	"current_step_id" uuid,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"submitted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"parent_request_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin_room_id" uuid,
	"origin_deployment_id" uuid,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title_en", '') || ' ' || coalesce("title_ar", '') || ' ' || coalesce("key", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "request_requester_check" CHECK ("requester_type" in ('Person', 'ExternalContact')),
	CONSTRAINT "request_entry_mode_check" CHECK ("entry_mode" in ('Form', 'Agentic')),
	CONSTRAINT "request_channel_check" CHECK ("channel" in ('Console', 'Teams', 'Email', 'Widget', 'WhatsApp', 'Api')),
	CONSTRAINT "request_attributes_check" CHECK ("attributes" is null or jsonb_typeof("attributes") = 'object')
);
--> statement-breakpoint
CREATE TABLE "work"."request_type" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"category_en" text,
	"category_ar" text,
	"current_published_version_id" uuid,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("name_en", '') || ' ' || coalesce("name_ar", '') || ' ' || coalesce("code", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."request_type_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_type_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"default_project_id" uuid,
	"decomposition" text DEFAULT 'None' NOT NULL,
	"sla_value" integer,
	"sla_unit" text,
	"intake_channels" text[] DEFAULT '{Console}'::text[] NOT NULL,
	"entry_modes" text[] DEFAULT '{TemplateForm}'::text[] NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "request_type_version_status_check" CHECK ("status" in ('Draft', 'Published', 'Retired')),
	CONSTRAINT "request_type_version_decomposition_check" CHECK ("decomposition" in ('None', 'Template', 'Agent', 'Hybrid')),
	CONSTRAINT "request_type_version_sla_unit_check" CHECK ("sla_unit" is null or "sla_unit" in ('Minutes', 'Hours', 'Days', 'BusinessDays')),
	CONSTRAINT "request_type_version_channels_check" CHECK ("intake_channels" <@ ARRAY['Console','Teams','Email','Widget','WhatsApp','Api']::text[]),
	CONSTRAINT "request_type_version_modes_check" CHECK ("entry_modes" <@ ARRAY['TemplateForm','AgenticInteractive']::text[])
);
--> statement-breakpoint
CREATE TABLE "work"."room_message" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"room_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid,
	"content_json" jsonb NOT NULL,
	"run_id" uuid,
	"artifact_id" uuid,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_message_pk" PRIMARY KEY("id","created_at"),
	CONSTRAINT "room_message_sender_check" CHECK ("sender_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "room_message_content_check" CHECK ("content_json" is null or jsonb_typeof("content_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "work"."room_participant" (
	"room_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"room_role" text DEFAULT 'Member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_participant_pk" PRIMARY KEY("room_id","principal_type","principal_id"),
	CONSTRAINT "room_participant_principal_check" CHECK ("principal_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "room_participant_role_check" CHECK ("room_role" in ('Owner', 'Admin', 'Member', 'LeadAgent', 'MemberAgent', 'Observer'))
);
--> statement-breakpoint
CREATE TABLE "work"."work_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text DEFAULT 'Task' NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"status" text DEFAULT 'Backlog' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"assignee_type" text DEFAULT 'None' NOT NULL,
	"assignee_id" uuid,
	"reviewer_type" text,
	"reviewer_id" uuid,
	"due_at" timestamp with time zone,
	"parent_work_item_id" uuid,
	"request_id" uuid,
	"request_type_version_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin_type" text DEFAULT 'Manual' NOT NULL,
	"origin_id" uuid,
	"blocked_reason_en" text,
	"blocked_reason_ar" text,
	"completed_at" timestamp with time zone,
	"search_key" text GENERATED ALWAYS AS (public.awp_normalise(coalesce("title_en", '') || ' ' || coalesce("title_ar", '') || ' ' || coalesce("key", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "work_item_type_check" CHECK ("type" in ('Task', 'SubItem', 'Bug')),
	CONSTRAINT "work_item_status_check" CHECK ("status" in ('Backlog', 'ToDo', 'InProgress', 'InReview', 'Blocked', 'Done', 'Cancelled')),
	CONSTRAINT "work_item_priority_check" CHECK ("priority" in ('High', 'Medium', 'Low')),
	CONSTRAINT "work_item_assignee_check" CHECK ("assignee_type" in ('Person', 'Agent', 'Group', 'None')),
	CONSTRAINT "work_item_reviewer_check" CHECK ("reviewer_type" is null or "reviewer_type" in ('Person', 'Agent', 'Group', 'Role', 'ExternalContact', 'System', 'Client')),
	CONSTRAINT "work_item_origin_check" CHECK ("origin_type" in ('Manual', 'Request', 'Room', 'Schedule', 'Agent', 'Comment')),
	CONSTRAINT "work_item_attributes_check" CHECK ("attributes" is null or jsonb_typeof("attributes") = 'object'),
	CONSTRAINT "work_item_sub_item_check" CHECK (("type" <> 'SubItem') or ("parent_work_item_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai"."agent" ADD CONSTRAINT "agent_org_unit_id_organizations_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_knowledge_access" ADD CONSTRAINT "agent_knowledge_access_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_knowledge_access" ADD CONSTRAINT "agent_knowledge_access_collection_id_knowledge_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "ai"."knowledge_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_memory_access" ADD CONSTRAINT "agent_memory_access_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_memory_access" ADD CONSTRAINT "agent_memory_access_memory_scope_id_memory_scope_id_fk" FOREIGN KEY ("memory_scope_id") REFERENCES "ai"."memory_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_platform_tool" ADD CONSTRAINT "agent_platform_tool_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_question" ADD CONSTRAINT "agent_question_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ai"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_question" ADD CONSTRAINT "agent_question_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_skill" ADD CONSTRAINT "agent_skill_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_skill" ADD CONSTRAINT "agent_skill_skill_version_id_skill_version_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "ai"."skill_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_tool_mode" ADD CONSTRAINT "agent_tool_mode_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_tool_mode" ADD CONSTRAINT "agent_tool_mode_connector_tool_id_connector_tool_id_fk" FOREIGN KEY ("connector_tool_id") REFERENCES "ai"."connector_tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_version" ADD CONSTRAINT "agent_version_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_version" ADD CONSTRAINT "agent_version_primary_route_id_route_id_fk" FOREIGN KEY ("primary_route_id") REFERENCES "ai"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_version" ADD CONSTRAINT "agent_version_fallback_route_id_route_id_fk" FOREIGN KEY ("fallback_route_id") REFERENCES "ai"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."agent_version" ADD CONSTRAINT "agent_version_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."approval" ADD CONSTRAINT "approval_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ai"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."approval_decision" ADD CONSTRAINT "approval_decision_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "ai"."approval"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."approval_decision" ADD CONSTRAINT "approval_decision_approver_person_id_users_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."assistant_chat" ADD CONSTRAINT "assistant_chat_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."assistant_chat_message" ADD CONSTRAINT "assistant_chat_message_chat_id_assistant_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "ai"."assistant_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "ai"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."channel_message" ADD CONSTRAINT "channel_message_conversation_id_deployment_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."deployment_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."connection_allowed_model" ADD CONSTRAINT "connection_allowed_model_connection_id_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "ai"."provider_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."connector" ADD CONSTRAINT "connector_catalog_entry_id_connector_catalog_entry_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "ai"."connector_catalog_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."connector_allowed_agent" ADD CONSTRAINT "connector_allowed_agent_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "ai"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."connector_allowed_agent" ADD CONSTRAINT "connector_allowed_agent_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."connector_tool" ADD CONSTRAINT "connector_tool_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "ai"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_deployment_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."deployment_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_deployment_id_embedded_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "ai"."embedded_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_storyline_version_id_storyline_version_id_fk" FOREIGN KEY ("storyline_version_id") REFERENCES "ai"."storyline_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_current_step_id_storyline_step_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "ai"."storyline_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_conversation" ADD CONSTRAINT "deployment_conversation_agent_paused_by_users_id_fk" FOREIGN KEY ("agent_paused_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_surface" ADD CONSTRAINT "deployment_surface_deployment_id_embedded_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "ai"."embedded_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."deployment_surface" ADD CONSTRAINT "deployment_surface_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "ai"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."embedded_deployment" ADD CONSTRAINT "embedded_deployment_default_agent_id_agent_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "ai"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."embedded_deployment" ADD CONSTRAINT "embedded_deployment_run_as_person_id_users_id_fk" FOREIGN KEY ("run_as_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."inbox_item" ADD CONSTRAINT "inbox_item_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."ingestion_job" ADD CONSTRAINT "ingestion_job_collection_id_knowledge_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "ai"."knowledge_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."ingestion_job" ADD CONSTRAINT "ingestion_job_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ai"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."knowledge_document" ADD CONSTRAINT "knowledge_document_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ai"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."knowledge_source" ADD CONSTRAINT "knowledge_source_collection_id_knowledge_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "ai"."knowledge_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory" ADD CONSTRAINT "memory_scope_id_memory_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "ai"."memory_scope"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_entry" ADD CONSTRAINT "memory_entry_memory_version_id_memory_version_id_fk" FOREIGN KEY ("memory_version_id") REFERENCES "ai"."memory_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_review" ADD CONSTRAINT "memory_review_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "ai"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_review" ADD CONSTRAINT "memory_review_memory_version_id_memory_version_id_fk" FOREIGN KEY ("memory_version_id") REFERENCES "ai"."memory_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_review" ADD CONSTRAINT "memory_review_proposed_by_agent_id_agent_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "ai"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_review" ADD CONSTRAINT "memory_review_reviewer_person_id_users_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_scope" ADD CONSTRAINT "memory_scope_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_scope" ADD CONSTRAINT "memory_scope_parent_fk" FOREIGN KEY ("parent_scope_id") REFERENCES "ai"."memory_scope"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."memory_version" ADD CONSTRAINT "memory_version_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "ai"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."playground_test" ADD CONSTRAINT "playground_test_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."playground_test" ADD CONSTRAINT "playground_test_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ai"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."provider_connection" ADD CONSTRAINT "provider_connection_provider_id_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai"."model_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."retrieval_test" ADD CONSTRAINT "retrieval_test_collection_id_knowledge_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "ai"."knowledge_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."retrieval_test" ADD CONSTRAINT "retrieval_test_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."route_step" ADD CONSTRAINT "route_step_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "ai"."route"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."route_step" ADD CONSTRAINT "route_step_provider_id_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai"."model_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."route_step" ADD CONSTRAINT "route_step_connection_id_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "ai"."provider_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "ai"."agent_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."run" ADD CONSTRAINT "run_replay_fk" FOREIGN KEY ("replay_of_run_id") REFERENCES "ai"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."run_step" ADD CONSTRAINT "run_step_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ai"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."skill" ADD CONSTRAINT "skill_author_person_id_users_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."skill_scan_result" ADD CONSTRAINT "skill_scan_result_skill_version_id_skill_version_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "ai"."skill_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."skill_test_case" ADD CONSTRAINT "skill_test_case_skill_version_id_skill_version_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "ai"."skill_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."skill_version" ADD CONSTRAINT "skill_version_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "ai"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."storyline" ADD CONSTRAINT "storyline_deployment_id_embedded_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "ai"."embedded_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."storyline_step" ADD CONSTRAINT "storyline_step_storyline_version_id_storyline_version_id_fk" FOREIGN KEY ("storyline_version_id") REFERENCES "ai"."storyline_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."storyline_step" ADD CONSTRAINT "storyline_step_agent_override_id_agent_id_fk" FOREIGN KEY ("agent_override_id") REFERENCES "ai"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."storyline_step" ADD CONSTRAINT "storyline_step_next_fk" FOREIGN KEY ("next_step_id") REFERENCES "ai"."storyline_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."storyline_version" ADD CONSTRAINT "storyline_version_storyline_id_storyline_id_fk" FOREIGN KEY ("storyline_id") REFERENCES "ai"."storyline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."widget_event" ADD CONSTRAINT "widget_event_deployment_id_embedded_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "ai"."embedded_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai"."widget_event" ADD CONSTRAINT "widget_event_conversation_id_deployment_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai"."deployment_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."agent_budget" ADD CONSTRAINT "agent_budget_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."agent_budget" ADD CONSTRAINT "agent_budget_cheaper_route_id_route_id_fk" FOREIGN KEY ("cheaper_route_id") REFERENCES "ai"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."branding_asset" ADD CONSTRAINT "branding_asset_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."budget_change" ADD CONSTRAINT "budget_change_budget_id_agent_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "gov"."agent_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."budget_change" ADD CONSTRAINT "budget_change_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."budget_event" ADD CONSTRAINT "budget_event_budget_id_agent_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "gov"."agent_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."budget_event" ADD CONSTRAINT "budget_event_period_id_budget_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "gov"."budget_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."budget_period" ADD CONSTRAINT "budget_period_budget_id_agent_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "gov"."agent_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_agent" ADD CONSTRAINT "client_agent_client_id_integration_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "gov"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_agent" ADD CONSTRAINT "client_agent_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_agui_exposure" ADD CONSTRAINT "client_agui_exposure_client_id_integration_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "gov"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_key" ADD CONSTRAINT "client_key_client_id_integration_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "gov"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_mcp_exposure" ADD CONSTRAINT "client_mcp_exposure_client_id_integration_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "gov"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."client_permission" ADD CONSTRAINT "client_permission_client_id_integration_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "gov"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."integration_client" ADD CONSTRAINT "integration_client_owner_person_id_users_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."mail_notification" ADD CONSTRAINT "mail_notification_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."settings_version" ADD CONSTRAINT "settings_version_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov"."system_state" ADD CONSTRAINT "system_state_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."calendar_holiday" ADD CONSTRAINT "calendar_holiday_calendar_id_calendar_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "core"."calendar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."group_member" ADD CONSTRAINT "group_member_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "core"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."organisation" ADD CONSTRAINT "organisation_working_calendar_id_calendar_id_fk" FOREIGN KEY ("working_calendar_id") REFERENCES "core"."calendar"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."organisation" ADD CONSTRAINT "organisation_holiday_calendar_id_calendar_id_fk" FOREIGN KEY ("holiday_calendar_id") REFERENCES "core"."calendar"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."attachment" ADD CONSTRAINT "attachment_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."discussion_room" ADD CONSTRAINT "discussion_room_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "work"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."discussion_room" ADD CONSTRAINT "discussion_room_fork_fk" FOREIGN KEY ("forked_from_room_id") REFERENCES "work"."discussion_room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."project" ADD CONSTRAINT "project_owner_person_id_users_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."project" ADD CONSTRAINT "project_org_unit_id_organizations_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."project_allowed_connector" ADD CONSTRAINT "project_allowed_connector_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "work"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "work"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request" ADD CONSTRAINT "request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "work"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request" ADD CONSTRAINT "request_request_type_version_id_request_type_version_id_fk" FOREIGN KEY ("request_type_version_id") REFERENCES "work"."request_type_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request" ADD CONSTRAINT "request_origin_room_id_discussion_room_id_fk" FOREIGN KEY ("origin_room_id") REFERENCES "work"."discussion_room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request" ADD CONSTRAINT "request_parent_fk" FOREIGN KEY ("parent_request_id") REFERENCES "work"."request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request_type_version" ADD CONSTRAINT "request_type_version_request_type_id_request_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "work"."request_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request_type_version" ADD CONSTRAINT "request_type_version_default_project_id_project_id_fk" FOREIGN KEY ("default_project_id") REFERENCES "work"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."request_type_version" ADD CONSTRAINT "request_type_version_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."room_message" ADD CONSTRAINT "room_message_room_id_discussion_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "work"."discussion_room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."room_participant" ADD CONSTRAINT "room_participant_room_id_discussion_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "work"."discussion_room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."work_item" ADD CONSTRAINT "work_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "work"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."work_item" ADD CONSTRAINT "work_item_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "work"."request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."work_item" ADD CONSTRAINT "work_item_request_type_version_id_request_type_version_id_fk" FOREIGN KEY ("request_type_version_id") REFERENCES "work"."request_type_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."work_item" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("parent_work_item_id") REFERENCES "work"."work_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_code_key" ON "ai"."agent" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_org_unit_idx" ON "ai"."agent" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "agent_search_idx" ON "ai"."agent" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_question_run_idx" ON "ai"."agent_question" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_key" ON "ai"."agent_version" USING btree ("agent_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_active_key" ON "ai"."agent_version" USING btree ("agent_id") WHERE "ai"."agent_version"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "approval_key_key" ON "ai"."approval" USING btree ("key");--> statement-breakpoint
CREATE INDEX "approval_status_idx" ON "ai"."approval" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_binding_idx" ON "ai"."approval" USING btree ("run_id","action","arguments_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decision_key" ON "ai"."approval_decision" USING btree ("approval_id","approver_person_id");--> statement-breakpoint
CREATE INDEX "assistant_chat_person_idx" ON "ai"."assistant_chat" USING btree ("person_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_chat_message_order_key" ON "ai"."assistant_chat_message" USING btree ("chat_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_type_key" ON "ai"."channel" USING btree ("type");--> statement-breakpoint
CREATE INDEX "channel_message_sender_idx" ON "ai"."channel_message" USING btree ("channel_id","sender_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_allowed_model_key" ON "ai"."connection_allowed_model" USING btree ("connection_id","model_name");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_code_key" ON "ai"."connector" USING btree ("code");--> statement-breakpoint
CREATE INDEX "connector_search_idx" ON "ai"."connector" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "connector_tool_key" ON "ai"."connector_tool" USING btree ("connector_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_order_key" ON "ai"."conversation_message" USING btree ("conversation_id","sort_order");--> statement-breakpoint
CREATE INDEX "deployment_conversation_deployment_idx" ON "ai"."deployment_conversation" USING btree ("deployment_id","started_at");--> statement-breakpoint
CREATE INDEX "deployment_conversation_started_idx" ON "ai"."deployment_conversation" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "deployment_conversation_visitor_idx" ON "ai"."deployment_conversation" USING btree ("deployment_id","visitor_key");--> statement-breakpoint
CREATE UNIQUE INDEX "embedded_deployment_code_key" ON "ai"."embedded_deployment" USING btree ("code");--> statement-breakpoint
CREATE INDEX "embedded_deployment_origins_idx" ON "ai"."embedded_deployment" USING gin ("allowed_origins");--> statement-breakpoint
CREATE INDEX "embedded_deployment_search_idx" ON "ai"."embedded_deployment" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_key" ON "ai"."inbox_item" USING btree ("person_id","kind","source_type","source_id");--> statement-breakpoint
CREATE INDEX "inbox_item_open_idx" ON "ai"."inbox_item" USING btree ("person_id") WHERE "ai"."inbox_item"."status" = 'Open';--> statement-breakpoint
CREATE INDEX "inbox_item_person_listed_idx" ON "ai"."inbox_item" USING btree ("person_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "ingestion_job_collection_idx" ON "ai"."ingestion_job" USING btree ("collection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_collection_code_key" ON "ai"."knowledge_collection" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "knowledge_collection_search_idx" ON "ai"."knowledge_collection" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "knowledge_document_source_idx" ON "ai"."knowledge_document" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "knowledge_document_search_idx" ON "ai"."knowledge_document" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "knowledge_source_collection_created_idx" ON "ai"."knowledge_source" USING btree ("collection_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_source_name_search_idx" ON "ai"."knowledge_source" USING gin ((public.awp_normalise("name")) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "memory_path_key" ON "ai"."memory" USING btree ("path");--> statement-breakpoint
CREATE INDEX "memory_scope_idx" ON "ai"."memory" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "memory_search_idx" ON "ai"."memory" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "memory_entry_version_idx" ON "ai"."memory_entry" USING btree ("memory_version_id");--> statement-breakpoint
CREATE INDEX "memory_review_memory_idx" ON "ai"."memory_review" USING btree ("memory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_scope_path_key" ON "ai"."memory_scope" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_scope_agent_person_key" ON "ai"."memory_scope" USING btree ("ref_id","person_id") WHERE "ai"."memory_scope"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "memory_scope_person_idx" ON "ai"."memory_scope" USING btree ("person_id") WHERE "ai"."memory_scope"."person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_version_key" ON "ai"."memory_version" USING btree ("memory_id","version_number");--> statement-breakpoint
CREATE INDEX "playground_test_version_idx" ON "ai"."playground_test" USING btree ("agent_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connection_key" ON "ai"."provider_connection" USING btree ("provider_id","name");--> statement-breakpoint
CREATE INDEX "retrieval_test_collection_idx" ON "ai"."retrieval_test" USING btree ("collection_id","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_alias_key" ON "ai"."route" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "route_step_order_key" ON "ai"."route_step" USING btree ("route_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "run_key_key" ON "ai"."run" USING btree ("key");--> statement-breakpoint
CREATE INDEX "run_agent_idx" ON "ai"."run" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "run_started_idx" ON "ai"."run" USING btree ("started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "run_agent_started_idx" ON "ai"."run" USING btree ("agent_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "run_context_idx" ON "ai"."run" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX "run_status_idx" ON "ai"."run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "run_step_run_idx" ON "ai"."run_step" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_name_key" ON "ai"."skill" USING btree ("skill_name");--> statement-breakpoint
CREATE INDEX "skill_tags_idx" ON "ai"."skill" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "skill_search_idx" ON "ai"."skill" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_case_key" ON "ai"."skill_test_case" USING btree ("skill_version_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_key" ON "ai"."skill_version" USING btree ("skill_id","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "storyline_code_key" ON "ai"."storyline" USING btree ("deployment_id","code");--> statement-breakpoint
CREATE INDEX "storyline_search_idx" ON "ai"."storyline" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "storyline_step_order_key" ON "ai"."storyline_step" USING btree ("storyline_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "storyline_version_key" ON "ai"."storyline_version" USING btree ("storyline_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "storyline_version_published_key" ON "ai"."storyline_version" USING btree ("storyline_id") WHERE "ai"."storyline_version"."status" = 'Published';--> statement-breakpoint
CREATE INDEX "widget_event_deployment_idx" ON "ai"."widget_event" USING btree ("deployment_id","at");--> statement-breakpoint
CREATE INDEX "agent_budget_agent_idx" ON "gov"."agent_budget" USING btree ("agent_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "branding_asset_kind_key" ON "gov"."branding_asset" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "budget_change_budget_idx" ON "gov"."budget_change" USING btree ("budget_id","at");--> statement-breakpoint
CREATE INDEX "budget_event_budget_idx" ON "gov"."budget_event" USING btree ("budget_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_period_key" ON "gov"."budget_period" USING btree ("budget_id","period_start");--> statement-breakpoint
CREATE INDEX "client_agui_exposure_origins_idx" ON "gov"."client_agui_exposure" USING gin ("allowed_origins");--> statement-breakpoint
CREATE UNIQUE INDEX "client_key_prefix_key" ON "gov"."client_key" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "client_key_client_idx" ON "gov"."client_key" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_mcp_exposure_tools_idx" ON "gov"."client_mcp_exposure" USING gin ("exposed_tools");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_page_slug_key" ON "gov"."doc_page" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "doc_page_search_idx" ON "gov"."doc_page" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_key_key" ON "gov"."feature_flag" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_client_key" ON "gov"."integration_client" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "integration_client_search_idx" ON "gov"."integration_client" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "log_entry_at_idx" ON "gov"."log_entry" USING btree ("at");--> statement-breakpoint
CREATE INDEX "log_entry_service_idx" ON "gov"."log_entry" USING btree ("service","at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_notification_key" ON "gov"."mail_notification" USING btree ("notification_key");--> statement-breakpoint
CREATE INDEX "mail_notification_due_idx" ON "gov"."mail_notification" USING btree ("next_attempt_at") WHERE "gov"."mail_notification"."status" in ('Queued', 'Sending');--> statement-breakpoint
CREATE INDEX "mail_notification_recent_idx" ON "gov"."mail_notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "gov"."outbox_event" USING btree ("available_at") WHERE "gov"."outbox_event"."status" = 'Pending';--> statement-breakpoint
CREATE UNIQUE INDEX "settings_version_key" ON "gov"."settings_version" USING btree ("version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "system_state_singleton" ON "gov"."system_state" USING btree ((true));--> statement-breakpoint
CREATE INDEX "audit_entry_at_idx" ON "audit"."audit_entry" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entry_actor_idx" ON "audit"."audit_entry" USING btree ("actor_type","actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_entry_object_idx" ON "audit"."audit_entry" USING btree ("object_type","object_id","at");--> statement-breakpoint
CREATE INDEX "audit_entry_action_idx" ON "audit"."audit_entry" USING btree ("action","at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holiday_key" ON "core"."calendar_holiday" USING btree ("calendar_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "external_contact_address_key" ON "core"."external_contact" USING btree ("channel","channel_address");--> statement-breakpoint
CREATE INDEX "external_contact_search_idx" ON "core"."external_contact" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "group_code_key" ON "core"."group" USING btree ("code");--> statement-breakpoint
CREATE INDEX "group_search_idx" ON "core"."group" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_singleton" ON "core"."organisation" USING btree ((true));--> statement-breakpoint
CREATE INDEX "attachment_owner_idx" ON "work"."attachment" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_handoff_owner_key" ON "work"."context_handoff" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_room_key_key" ON "work"."discussion_room" USING btree ("key");--> statement-breakpoint
CREATE INDEX "discussion_room_project_idx" ON "work"."discussion_room" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "discussion_room_activity_idx" ON "work"."discussion_room" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "discussion_room_recent_idx" ON "work"."discussion_room" USING btree ((coalesce("last_activity_at", "created_at")) desc,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discussion_room_search_idx" ON "work"."discussion_room" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "project_key_key" ON "work"."project" USING btree ("key");--> statement-breakpoint
CREATE INDEX "project_org_unit_idx" ON "work"."project" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "project_search_idx" ON "work"."project" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "request_key_key" ON "work"."request" USING btree ("key");--> statement-breakpoint
CREATE INDEX "request_project_idx" ON "work"."request" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "request_step_idx" ON "work"."request" USING btree ("current_step_id");--> statement-breakpoint
CREATE INDEX "request_due_idx" ON "work"."request" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "request_list_idx" ON "work"."request" USING btree ("created_at" DESC NULLS LAST,"key" DESC NULLS LAST) WHERE "work"."request"."parent_request_id" is null;--> statement-breakpoint
CREATE INDEX "request_requester_idx" ON "work"."request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "request_search_idx" ON "work"."request" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "request_attributes_idx" ON "work"."request" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "request_type_code_key" ON "work"."request_type" USING btree ("code");--> statement-breakpoint
CREATE INDEX "request_type_search_idx" ON "work"."request_type" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "request_type_version_key" ON "work"."request_type_version" USING btree ("request_type_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "request_type_version_published_key" ON "work"."request_type_version" USING btree ("request_type_id") WHERE "work"."request_type_version"."status" = 'Published';--> statement-breakpoint
CREATE INDEX "request_type_version_channels_idx" ON "work"."request_type_version" USING gin ("intake_channels");--> statement-breakpoint
CREATE INDEX "room_message_room_idx" ON "work"."room_message" USING btree ("room_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_key_key" ON "work"."work_item" USING btree ("key");--> statement-breakpoint
CREATE INDEX "work_item_project_idx" ON "work"."work_item" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "work"."work_item" USING btree ("assignee_type","assignee_id");--> statement-breakpoint
CREATE INDEX "work_item_parent_idx" ON "work"."work_item" USING btree ("parent_work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_due_idx" ON "work"."work_item" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "work_item_created_idx" ON "work"."work_item" USING btree ("created_at" DESC NULLS LAST,"key" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_item_status_created_idx" ON "work"."work_item" USING btree ("status","created_at" DESC NULLS LAST,"key" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_item_reviewer_idx" ON "work"."work_item" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "work_item_created_by_idx" ON "work"."work_item" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "work_item_search_idx" ON "work"."work_item" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "work_item_attributes_idx" ON "work"."work_item" USING gin ("attributes" jsonb_path_ops);