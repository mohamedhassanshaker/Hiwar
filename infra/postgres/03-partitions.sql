-- Monthly range partitions for the append-only tables, and the maintenance routine.
--
-- Data model section 1.1 lists `AuditEntry`, `RequestEvent`, `WorkItemActivity` and
-- `RoomMessage` as append-only with monthly partitions; the stack specification adds run
-- steps. Drizzle has no `PARTITION BY` in its schema language, so the migration creates a
-- plain table and this file converts it, once, before any row is written.
--
-- Runs after the Drizzle migrations and before the seed. Idempotent: a table that is
-- already partitioned is left alone.

/*
 * Rebuilds an empty table as partitioned. `LIKE ... INCLUDING ALL` carries the columns,
 * defaults, checks, primary key and indexes across; PostgreSQL's `LIKE` never copies
 * foreign keys, so the caller re-adds them.
 */
CREATE OR REPLACE FUNCTION public.awp_make_partitioned(
  target_schema text,
  target_table text,
  partition_column text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  parked text := target_table || '__flat';
  row_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = target_schema AND c.relname = target_table
  ) THEN
    RETURN false;
  END IF;

  EXECUTE format('SELECT count(*) FROM %I.%I', target_schema, target_table) INTO row_count;
  IF row_count > 0 THEN
    RAISE EXCEPTION 'cannot partition %.% after % rows were written', target_schema, target_table, row_count;
  END IF;

  EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', target_schema, target_table, parked);
  EXECUTE format(
    'CREATE TABLE %I.%I (LIKE %I.%I INCLUDING ALL) PARTITION BY RANGE (%I)',
    target_schema, target_table, target_schema, parked, partition_column
  );
  EXECUTE format('DROP TABLE %I.%I', target_schema, parked);
  RETURN true;
END
$$;

COMMENT ON FUNCTION public.awp_make_partitioned(text, text, text) IS
  'Rebuilds an empty table as range-partitioned on the given column. Returns true when it converted one.';

/*
 * One month of one partitioned table. Safe to call for a month that already exists.
 */
CREATE OR REPLACE FUNCTION public.awp_ensure_partition(
  target_schema text,
  target_table text,
  month_start date
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  first_day date := date_trunc('month', month_start)::date;
  next_month date := (first_day + interval '1 month')::date;
  part_name text := format('%s_%s', target_table, to_char(first_day, 'YYYY_MM'));
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = target_schema AND c.relname = part_name
  ) THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
    target_schema, part_name, target_schema, target_table, first_day, next_month
  );
END
$$;

/*
 * The maintenance routine. Run on every deploy and monthly from the Temporal `maintenance`
 * task queue: it keeps a partition for last month, this month and the next three, so a
 * write never lands outside a partition.
 */
CREATE OR REPLACE FUNCTION public.awp_maintain_partitions()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target record;
  offset_months int;
  converted boolean;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('audit', 'audit_entry', 'at', NULL, NULL, NULL),
      ('work', 'request_event', 'at', 'request_id', 'work.request', 'request_event_request_fk'),
      ('work', 'work_item_activity', 'at', 'work_item_id', 'work.work_item', 'work_item_activity_item_fk'),
      ('work', 'room_message', 'created_at', 'room_id', 'work.discussion_room', 'room_message_room_fk'),
      ('ai', 'run_step', 'started_at', 'run_id', 'ai.run', 'run_step_run_fk')
    ) AS t(schema_name, table_name, column_name, fk_column, fk_target, fk_name)
  LOOP
    converted := public.awp_make_partitioned(target.schema_name, target.table_name, target.column_name);

    IF converted AND target.fk_column IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id)',
        target.schema_name, target.table_name, target.fk_name, target.fk_column, target.fk_target
      );
    END IF;

    FOR offset_months IN -1..3 LOOP
      PERFORM public.awp_ensure_partition(
        target.schema_name,
        target.table_name,
        (date_trunc('month', now()) + make_interval(months => offset_months))::date
      );
    END LOOP;
  END LOOP;
END
$$;

COMMENT ON FUNCTION public.awp_maintain_partitions() IS
  'Partitions the append-only tables and keeps last month plus the next three in place.';

SELECT public.awp_maintain_partitions();
