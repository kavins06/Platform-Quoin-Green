ALTER TABLE "organization_memberships"
  DROP CONSTRAINT IF EXISTS "organization_memberships_clerk_membership_id_key";

ALTER TABLE "organizations"
  DROP CONSTRAINT IF EXISTS "organizations_clerk_org_id_key";

ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_auth_provider_auth_user_id_key",
  DROP CONSTRAINT IF EXISTS "users_clerk_user_id_key";

ALTER TABLE "organization_memberships"
  DROP COLUMN IF EXISTS "clerk_membership_id";

ALTER TABLE "organizations"
  DROP COLUMN IF EXISTS "clerk_org_id";

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "auth_provider",
  DROP COLUMN IF EXISTS "clerk_user_id";

DROP TYPE IF EXISTS "AuthProvider";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_user_id_key'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_auth_user_id_key" UNIQUE ("auth_user_id");
  END IF;
END
$$;
