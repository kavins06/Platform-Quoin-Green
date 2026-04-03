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
