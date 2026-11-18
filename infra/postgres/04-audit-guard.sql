-- The audit schema is insert-only (data model section 23 rule 7).
--
-- 02-roles.sql revokes UPDATE and DELETE from every application role. This trigger is the
-- second line of defence: it refuses the statement even for a superuser or a role that was
-- granted the privilege by mistake, which is what acceptance criterion 33 checks.
--
-- Idempotent: safe to run on every deploy.

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

COMMENT ON FUNCTION audit.reject_change() IS
  'Guard trigger: the audit schema accepts INSERT and SELECT only.';

/*
 * Attached to every table in the audit schema, including partitions, so a write that
 * targets a partition directly is refused as well.
 */
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
