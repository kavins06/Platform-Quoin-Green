DO $$
BEGIN
  CREATE TYPE "AuthProvider" AS ENUM ('CLERK', 'SUPABASE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "auth_provider" "AuthProvider",
  ADD COLUMN IF NOT EXISTS "auth_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

UPDATE "users"
SET
  "auth_provider" = COALESCE("auth_provider", 'CLERK'::"AuthProvider"),
  "auth_user_id" = COALESCE("auth_user_id", "clerk_user_id", CONCAT('legacy_user_', "id"))
WHERE "auth_provider" IS NULL OR "auth_user_id" IS NULL;

ALTER TABLE "users"
  ALTER COLUMN "auth_provider" SET NOT NULL,
  ALTER COLUMN "auth_provider" SET DEFAULT 'CLERK',
  ALTER COLUMN "auth_user_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_provider_auth_user_id_key"
  ON "users"("auth_provider", "auth_user_id");
