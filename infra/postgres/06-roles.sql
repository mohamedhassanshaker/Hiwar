-- Database roles for the AWP domain database (stack specification 7.1).
--
--   awp_app          domain read/write, used by the web application through the pooler
--   awp_ro           reporting; the replica connection the dashboards and exports use
--   awp_migrate      DDL; used only by the db-migrate Job
--   awp_audit_reader SELECT on the audit schema and nothing else
--
-- Passwords are not set here. CloudNativePG issues certificates and the Secrets the
-- connection strings are built from; locally `scripts/secrets-from-env.sh` sets them.
--
-- Runs last, after the migrations have created the schemas and after the partitioning has
-- rebuilt the append-only tables, so every grant lands on the table that will be read.
--
-- Idempotent: safe to run on every deploy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awp_app') THEN
    CREATE ROLE awp_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awp_ro') THEN
    CREATE ROLE awp_ro NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awp_migrate') THEN
    CREATE ROLE awp_migrate NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awp_audit_reader') THEN
    CREATE ROLE awp_audit_reader NOLOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE awp TO awp_app, awp_ro, awp_migrate, awp_audit_reader;
GRANT USAGE ON SCHEMA public TO awp_app, awp_ro, awp_migrate, awp_audit_reader;

-- The migrate role owns the schemas the migrations created, so only it can change them.
DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['core', 'work', 'ai', 'gov', 'audit'] LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO awp_migrate', s);
  END LOOP;
END
$$;

-- Domain schemas: the application reads and writes, the reporting role only reads.
DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['core', 'work', 'ai', 'gov'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO awp_app, awp_ro', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO awp_app', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO awp_ro', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE awp_migrate IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awp_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE awp_migrate IN SCHEMA %I GRANT SELECT ON TABLES TO awp_ro', s);
  END LOOP;
END
$$;

-- D387: password hashes and reset-link hashes are for the sign-in code alone, never a report.
DO $$
BEGIN
  IF to_regclass('core.person_credential') IS NOT NULL THEN
    REVOKE ALL ON core.person_credential, core.password_reset FROM awp_ro;
  END IF;
END
$$;

-- Audit schema: insert and select only, for anybody (specification section 9, data model
-- section 23 rule 7). The guard trigger in 03-audit.sql is the second line of defence.
GRANT USAGE ON SCHEMA audit TO awp_app, awp_ro, awp_audit_reader;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO awp_app;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO awp_ro, awp_audit_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_migrate IN SCHEMA audit GRANT SELECT, INSERT ON TABLES TO awp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE awp_migrate IN SCHEMA audit GRANT SELECT ON TABLES TO awp_ro, awp_audit_reader;

REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA audit FROM awp_app, awp_ro, awp_audit_reader;

-- The migration runs as a superuser, so the tables it creates are not owned by the login
-- role the console connects with. That role is the owner of the database, and it is given
-- the application and reporting roles here so the grants above reach it.
DO $$
DECLARE
  app_login text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO app_login FROM pg_database WHERE datname = current_database();
  IF app_login IS NOT NULL AND NOT pg_has_role(app_login, 'awp_app', 'MEMBER') THEN
    EXECUTE format('GRANT awp_app, awp_ro TO %I', app_login);
  END IF;
END
$$;
