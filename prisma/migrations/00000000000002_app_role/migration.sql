-- Create non-superuser role for application queries.
-- RLS is only enforced for non-superuser roles.
-- The app uses SET LOCAL ROLE quoin_app inside each tenant transaction.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quoin_app') THEN
    CREATE ROLE quoin_app NOLOGIN;
  END IF;
END
$$;

-- Grant the app role access to the public schema and all tables
GRANT USAGE ON SCHEMA public TO quoin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quoin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quoin_app;

-- Grant the runtime app role to whichever login role is running the migration.
DO $$
DECLARE
  runtime_grantee text := current_user;
BEGIN
  IF runtime_grantee = 'quoin_app' THEN
    RETURN;
  END IF;

  EXECUTE format('GRANT quoin_app TO %I WITH SET TRUE', runtime_grantee);
END
$$;
