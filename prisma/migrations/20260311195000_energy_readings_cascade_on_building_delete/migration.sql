ALTER TABLE "energy_readings"
DROP CONSTRAINT IF EXISTS "energy_readings_building_id_organization_id_fkey";

ALTER TABLE "energy_readings"
ADD CONSTRAINT "energy_readings_building_id_organization_id_fkey"
FOREIGN KEY ("building_id", "organization_id")
REFERENCES "buildings"("id", "organization_id")
ON DELETE CASCADE
ON UPDATE CASCADE;
