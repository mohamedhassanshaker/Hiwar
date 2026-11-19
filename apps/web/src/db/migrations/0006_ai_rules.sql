-- Rules the AI capabilities module enforces in the database (its infra/postgres/04-audit-guard.sql
-- and the parts of 05-integrity.sql that apply to the tables Hiwar has), and the module's people
-- as a view over Hiwar's users.
--> statement-breakpoint
CREATE OR REPLACE VIEW core.person AS
SELECT
  u.id,
  u.email,
  u.name AS name_en,
  u.name AS name_ar,
  CASE WHEN u.platform_role IS NULL THEN 'Inactive' ELSE 'Active' END AS status,
  'en'::text AS preferred_language
FROM public.users u;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit.reject_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit.% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION audit.reject_change() IS
  'Guard trigger: the audit schema accepts INSERT and SELECT only.';
--> statement-breakpoint
/*
 * Attached to every table in the audit schema, including partitions, so a write that
 * targets a partition directly is refused as well.
 */
--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON audit.%I', 'audit_guard_' || target.relname, target.relname);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change()',
      'audit_guard_' || target.relname, target.relname
    );
  END LOOP;
END
$$;
--> statement-breakpoint
/* --------------------------------------------------------------------------- rule 3 */
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai.enforce_approver_independence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent ai.approval%ROWTYPE;
  requester uuid;
  author uuid;
BEGIN
  SELECT * INTO parent FROM ai.approval WHERE id = NEW.approval_id;

  -- "Agents never appear as approvers": the column references core.person, and this check
  -- keeps a person row that stands for an agent out as well.
  IF EXISTS (SELECT 1 FROM ai.agent a WHERE a.id = NEW.approver_person_id) THEN
    RAISE EXCEPTION 'an agent may not approve' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF parent.request_id IS NOT NULL THEN
    SELECT CASE WHEN requester_type = 'Person' THEN requester_id END INTO requester
    FROM work.request WHERE id = parent.request_id;
    IF requester = NEW.approver_person_id THEN
      RAISE EXCEPTION 'the requester may not approve their own request'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF parent.work_item_id IS NOT NULL THEN
    SELECT CASE WHEN assignee_type = 'Person' THEN assignee_id END INTO author
    FROM work.work_item WHERE id = parent.work_item_id;
    IF author = NEW.approver_person_id THEN
      RAISE EXCEPTION 'the author of the work may not approve it'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_decision_independence ON ai.approval_decision;
--> statement-breakpoint
CREATE TRIGGER approval_decision_independence
  BEFORE INSERT OR UPDATE ON ai.approval_decision
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_approver_independence();
--> statement-breakpoint
/* --------------------------------------------------------------------------- rule 4 */
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai.enforce_tool_mode_tier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tool_tier text;
BEGIN
  SELECT tier INTO tool_tier FROM ai.connector_tool WHERE id = NEW.connector_tool_id;

  -- T3 is forbidden outright; T2 always needs a human; T1 is never fully automatic.
  IF tool_tier = 'T3' AND NEW.mode <> 'Denied' THEN
    RAISE EXCEPTION 'a T3 tool is forbidden and can only be Denied'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF tool_tier = 'T2' AND NEW.mode = 'Auto' THEN
    RAISE EXCEPTION 'a T2 tool always needs a human approval and cannot be Auto'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS agent_tool_mode_tier ON ai.agent_tool_mode;
--> statement-breakpoint
CREATE TRIGGER agent_tool_mode_tier
  BEFORE INSERT OR UPDATE ON ai.agent_tool_mode
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_tool_mode_tier();
--> statement-breakpoint
/* -------------------------------------------------------------------------- rule 10 */
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gov.enforce_budget_windows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM gov.agent_budget b
    WHERE b.agent_id = NEW.agent_id
      AND b.id <> NEW.id
      AND tstzrange(b.effective_from, b.effective_to, '[)')
          && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'budget periods for one agent may not overlap'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS agent_budget_no_overlap ON gov.agent_budget;
--> statement-breakpoint
CREATE TRIGGER agent_budget_no_overlap
  BEFORE INSERT OR UPDATE OF agent_id, effective_from, effective_to ON gov.agent_budget
  FOR EACH ROW EXECUTE FUNCTION gov.enforce_budget_windows();
--> statement-breakpoint
/* ------------------------------------------------- optimistic concurrency (COM-10) */
--> statement-breakpoint
/*
 * Data model section 1: `Version` is the optimistic-concurrency column. The service layer
 * sends `where version = :expected` and reports COM-10's message when no row matches; this
 * trigger makes the increment automatic, so no repository can forget it.
 */
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.awp_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'version' AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname IN ('core', 'work', 'ai', 'gov') AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS awp_version_bump ON %I.%I', target.schema_name, target.table_name);
    -- No `WHEN` clause: a BEFORE trigger may not read a generated column of NEW, and a
    -- statement that writes the same values is still a write for concurrency purposes.
    EXECUTE format(
      'CREATE TRIGGER awp_version_bump BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.awp_bump_version()',
      target.schema_name, target.table_name
    );
  END LOOP;
END
$$;
