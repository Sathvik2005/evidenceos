-- Row-level security and API-role lockdown.
--
-- Supabase exposes every table in the `public` schema through its REST/GraphQL API, protected only by row-level
-- security. EvidenceOS never uses that API: the backend connects directly to PostgreSQL as the table owner, which
-- is not subject to row-level security. So the correct posture is:
--   1. enable row-level security on every table, with NO policies (the API roles then see no rows and can change none);
--   2. revoke all privileges from the API roles, as a second, independent barrier.
-- The owner role keeps full access, so application behavior is unchanged. On a plain PostgreSQL (no `anon` or
-- `authenticated` roles, e.g. local tests or Neon) step 2 is skipped. The migration is idempotent.

DO $$
DECLARE
  tbl text;
  api_role text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      -- Tables created later by the owner must not become reachable by default either.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
