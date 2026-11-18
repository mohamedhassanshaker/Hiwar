-- The integrity rules of data model section 23 that a column constraint cannot express.
--
-- Rules 2 (dynamic attributes against the pinned request type version), 4's project-rule
-- and trust parts, and 8's "never plain text" are enforced in the module services, because
-- they need the compiled JSON Schema, the project's approval rules and the application
-- key. Everything a single statement can decide is enforced here, so a direct SQL write
-- cannot break it either.
--
--   1  A sub item's project is its parent's project.
--   3  An approver is never the requester or the author, and never an agent.
--   4  An agent's tool mode is never looser than the tool's tier.
--   5  A terminal transition step has no audience and no outgoing routing rule.
--  10  Budget windows for one agent do not overlap.
--
-- Idempotent: safe to run on every deploy.

/* --------------------------------------------------------------------------- rule 1 */

CREATE OR REPLACE FUNCTION work.enforce_sub_item_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_project uuid;
BEGIN
  IF NEW.parent_work_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO parent_project FROM work.work_item WHERE id = NEW.parent_work_item_id;
  IF parent_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'a sub item belongs to its parent''s project (% expected, % given)', parent_project, NEW.project_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS work_item_sub_item_project ON work.work_item;
CREATE TRIGGER work_item_sub_item_project
  BEFORE INSERT OR UPDATE OF project_id, parent_work_item_id ON work.work_item
  FOR EACH ROW EXECUTE FUNCTION work.enforce_sub_item_project();

/* --------------------------------------------------------------------------- rule 3 */

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

DROP TRIGGER IF EXISTS approval_decision_independence ON ai.approval_decision;
CREATE TRIGGER approval_decision_independence
  BEFORE INSERT OR UPDATE ON ai.approval_decision
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_approver_independence();

/* --------------------------------------------------------------------------- rule 4 */

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

DROP TRIGGER IF EXISTS agent_tool_mode_tier ON ai.agent_tool_mode;
CREATE TRIGGER agent_tool_mode_tier
  BEFORE INSERT OR UPDATE ON ai.agent_tool_mode
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_tool_mode_tier();

/* --------------------------------------------------------------------------- rule 5 */

-- One function per table: PL/pgSQL resolves `NEW.<field>` against the triggering table, so
-- a shared body that names both columns cannot compile for either of them.
CREATE OR REPLACE FUNCTION work.reject_terminal_step(step_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT is_terminal FROM work.transition_step WHERE id = step_id) THEN
    RAISE EXCEPTION 'a terminal transition step has no audience and no outgoing routing rule'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION work.enforce_step_audience_not_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM work.reject_terminal_step(NEW.step_id);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION work.enforce_routing_rule_not_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM work.reject_terminal_step(NEW.from_step_id);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS step_audience_not_terminal ON work.step_audience;
CREATE TRIGGER step_audience_not_terminal
  BEFORE INSERT OR UPDATE ON work.step_audience
  FOR EACH ROW EXECUTE FUNCTION work.enforce_step_audience_not_terminal();

DROP TRIGGER IF EXISTS routing_rule_not_terminal ON work.routing_rule;
CREATE TRIGGER routing_rule_not_terminal
  BEFORE INSERT OR UPDATE ON work.routing_rule
  FOR EACH ROW EXECUTE FUNCTION work.enforce_routing_rule_not_terminal();

/* -------------------------------------------------------------------------- rule 10 */

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

DROP TRIGGER IF EXISTS agent_budget_no_overlap ON gov.agent_budget;
CREATE TRIGGER agent_budget_no_overlap
  BEFORE INSERT OR UPDATE OF agent_id, effective_from, effective_to ON gov.agent_budget
  FOR EACH ROW EXECUTE FUNCTION gov.enforce_budget_windows();

/* ------------------------------------------------- optimistic concurrency (COM-10) */

/*
 * Data model section 1: `Version` is the optimistic-concurrency column. The service layer
 * sends `where version = :expected` and reports COM-10's message when no row matches; this
 * trigger makes the increment automatic, so no repository can forget it.
 */
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
