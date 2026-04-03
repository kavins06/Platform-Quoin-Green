-- Add missing Green Button OAuth fields to buildings table
ALTER TABLE "buildings" ADD COLUMN "green_button_access_token" TEXT;
ALTER TABLE "buildings" ADD COLUMN "green_button_refresh_token" TEXT;
ALTER TABLE "buildings" ADD COLUMN "green_button_subscription_id" TEXT;
ALTER TABLE "buildings" ADD COLUMN "green_button_connected_at" TIMESTAMP(3);
