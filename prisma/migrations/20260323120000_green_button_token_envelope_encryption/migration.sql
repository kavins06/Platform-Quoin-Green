ALTER TABLE "green_button_connections"
  ALTER COLUMN "access_token" DROP NOT NULL,
  ALTER COLUMN "refresh_token" DROP NOT NULL,
  ADD COLUMN "access_token_encrypted" TEXT,
  ADD COLUMN "refresh_token_encrypted" TEXT,
  ADD COLUMN "token_encryption_version" INTEGER;
