CREATE SCHEMA "kb";
--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('AI_ACTIVE', 'HANDOVER_PENDING', 'HUMAN_ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('draft', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'paid', 'failed', 'void');--> statement-breakpoint
CREATE TYPE "public"."limit_behaviour" AS ENUM('stop_route', 'offline', 'overage');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('visitor', 'ai', 'staff', 'note', 'event');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('trial', 'active', 'past_due', 'suspended', 'trial_ended');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('trial', 'starter', 'growth', 'business', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('platform_admin', 'support_operator');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'builder', 'support_agent', 'analyst', 'billing');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('file', 'website', 'faq');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('waiting_approval', 'waiting_visitor', 'approved', 'rejected', 'ran', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"config" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"live_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts_sent" (
	"org_id" uuid NOT NULL,
	"period" text NOT NULL,
	"threshold" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_sent_org_id_period_threshold_pk" PRIMARY KEY("org_id","period","threshold")
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"area" text NOT NULL,
	"action" text NOT NULL,
	"item" text NOT NULL,
	"change" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb"."chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"search_key" text NOT NULL,
	"embedding" vector(1024) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"visitor_token" text NOT NULL,
	"visitor" jsonb NOT NULL,
	"state" "conversation_state" DEFAULT 'AI_ACTIVE' NOT NULL,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"reason_code" text,
	"waiting_since" timestamp with time zone,
	"follow_up_offered" boolean DEFAULT false NOT NULL,
	"tell_visitor_back" boolean DEFAULT true NOT NULL,
	"summary" text,
	"feedback" text,
	"ai_counted" boolean DEFAULT false NOT NULL,
	"handed_over" boolean DEFAULT false NOT NULL,
	"repeated_question" boolean DEFAULT false NOT NULL,
	"low_confidence_streak" integer DEFAULT 0 NOT NULL,
	"tool_failure_streak" integer DEFAULT 0 NOT NULL,
	"prior_chats" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visitor_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "deployment_status" DEFAULT 'draft' NOT NULL,
	"public_key" text NOT NULL,
	"previous_key" text,
	"previous_key_expires_at" timestamp with time zone,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "deployments_previous_key_unique" UNIQUE("previous_key")
);
--> statement-breakpoint
CREATE TABLE "http_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"access" text NOT NULL,
	"config" jsonb NOT NULL,
	"secrets" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"message" text,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"plan" "plan" NOT NULL,
	"plan_amount_aed" numeric(10, 2) NOT NULL,
	"overage_count" integer DEFAULT 0 NOT NULL,
	"overage_amount_aed" numeric(10, 2) DEFAULT '0' NOT NULL,
	"vat_aed" numeric(10, 2) NOT NULL,
	"total_aed" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "message_kind" NOT NULL,
	"author_user_id" uuid,
	"author_name" text,
	"text" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"done_at" timestamp with time zone,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"operator_name" text NOT NULL,
	"org_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" "plan" DEFAULT 'trial' NOT NULL,
	"status" "org_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"plan_version_id" uuid,
	"custom_limits" jsonb,
	"scheduled_plan" "plan",
	"scheduled_plan_at" timestamp with time zone,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"renews_at" timestamp with time zone,
	"require_2fa" boolean DEFAULT false NOT NULL,
	"session_days" integer DEFAULT 14 NOT NULL,
	"auto_close_minutes" integer DEFAULT 30 NOT NULL,
	"alert_first" integer DEFAULT 80 NOT NULL,
	"alert_second" integer DEFAULT 100 NOT NULL,
	"limit_behaviour" "limit_behaviour" DEFAULT 'stop_route' NOT NULL,
	"overage_cap_aed" numeric(10, 2) DEFAULT '500' NOT NULL,
	"payment_card" jsonb,
	"payment_failed_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"verified_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"reason_code" text NOT NULL,
	"version" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan" "plan" NOT NULL,
	"version" integer NOT NULL,
	"monthly_aed" numeric(10, 2),
	"yearly_aed" numeric(10, 2),
	"overage_aed" numeric(10, 2),
	"limits" jsonb NOT NULL,
	"trial_days" integer,
	"reason" text NOT NULL,
	"changed_by" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"support_grant_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"status" "source_status" DEFAULT 'queued' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reason" text,
	"chunks" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"languages" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"granted_by" uuid,
	"include_conversations" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tool_key" text NOT NULL,
	"tool_name" text NOT NULL,
	"access" text NOT NULL,
	"policy" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"status" "tool_call_status" NOT NULL,
	"decided_by" uuid,
	"reason" text,
	"duration_ms" integer,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unanswered_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"question" text NOT NULL,
	"key" text NOT NULL,
	"language" text NOT NULL,
	"suggested_answer" text,
	"asks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deployment_id" uuid,
	"conversation_id" uuid NOT NULL,
	"period" text NOT NULL,
	"overage" boolean DEFAULT false NOT NULL,
	"amount_aed" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost_aed" numeric(10, 4) DEFAULT '0' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"totp_secret" text,
	"totp_enabled_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"platform_role" "platform_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts_sent" ADD CONSTRAINT "alerts_sent_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_tools" ADD CONSTRAINT "http_tools_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_events" ADD CONSTRAINT "ownership_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_events" ADD CONSTRAINT "ownership_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unanswered_questions" ADD CONSTRAINT "unanswered_questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_number" ON "agent_versions" USING btree ("agent_id","number");--> statement-breakpoint
CREATE INDEX "audit_org_time" ON "audit_entries" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "chunks_org_source" ON "kb"."chunks" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE INDEX "conversations_org_state" ON "conversations" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "conversations_visitor" ON "conversations" USING btree ("visitor_token");--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_org" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "origins_unique" ON "origins" USING btree ("deployment_id","origin");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_unique" ON "plan_versions" USING btree ("plan","version");--> statement-breakpoint
CREATE INDEX "sources_org" ON "sources" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unanswered_key" ON "unanswered_questions" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "usage_org_period" ON "usage_events" USING btree ("org_id","period");