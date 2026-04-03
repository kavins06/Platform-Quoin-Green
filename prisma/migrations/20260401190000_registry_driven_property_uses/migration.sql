DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'BuildingPropertyUseType'
  ) THEN
    CREATE TYPE "BuildingPropertyUseType" AS ENUM (
      'BANK_BRANCH',
      'FINANCIAL_OFFICE',
      'OFFICE',
      'MULTIFAMILY_HOUSING',
      'RESIDENCE_HALL_DORMITORY',
      'RESIDENTIAL_CARE_FACILITY',
      'SENIOR_LIVING_COMMUNITY',
      'COLLEGE_UNIVERSITY',
      'K12_SCHOOL',
      'PRESCHOOL_DAYCARE',
      'COMMUNITY_CENTER_AND_SOCIAL_MEETING_HALL',
      'CONVENTION_CENTER',
      'MOVIE_THEATER',
      'MUSEUM',
      'PERFORMING_ARTS',
      'BAR_NIGHTCLUB',
      'FAST_FOOD_RESTAURANT',
      'SUPERMARKET_GROCERY_STORE',
      'WHOLESALE_CLUB_SUPERCENTER'
    );
  END IF;
END $$;

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "occupancy_rate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "irrigated_area_square_feet" INTEGER,
  ADD COLUMN IF NOT EXISTS "number_of_buildings" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "planned_construction_completion_year" INTEGER;

CREATE TABLE IF NOT EXISTS "building_property_uses" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "use_key" "BuildingPropertyUseType" NOT NULL,
  "display_name" TEXT NOT NULL,
  "gross_square_feet" INTEGER NOT NULL,
  "details_json" JSONB NOT NULL DEFAULT '{}',
  "espm_property_use_id" BIGINT,
  "espm_use_details_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "building_property_uses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "building_property_uses_organization_id_building_i_idx"
  ON "building_property_uses"("organization_id", "building_id", "sort_order");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'building_property_uses_organization_id_fkey'
  ) THEN
    ALTER TABLE "building_property_uses"
      ADD CONSTRAINT "building_property_uses_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'building_property_uses_building_id_organization_id_fkey'
  ) THEN
    ALTER TABLE "building_property_uses"
      ADD CONSTRAINT "building_property_uses_building_id_organization_id_fkey"
      FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "building_property_uses" (
  "id",
  "organization_id",
  "building_id",
  "sort_order",
  "use_key",
  "display_name",
  "gross_square_feet",
  "details_json",
  "espm_property_use_id",
  "espm_use_details_id"
)
SELECT
  'bpu_' || substr(md5(pm_inputs.id), 1, 24),
  pm_inputs.organization_id,
  pm_inputs.building_id,
  pm_inputs.sort_order,
  CASE
    WHEN pm_inputs.use_type = 'MULTIFAMILY' THEN 'MULTIFAMILY_HOUSING'::"BuildingPropertyUseType"
    ELSE 'OFFICE'::"BuildingPropertyUseType"
  END,
  pm_inputs.display_name,
  pm_inputs.gross_square_feet,
  jsonb_strip_nulls(
    jsonb_build_object(
      'weeklyOperatingHours', pm_inputs.weekly_operating_hours,
      'workersOnMainShift', pm_inputs.workers_on_main_shift,
      'numberOfComputers', pm_inputs.number_of_computers,
      'totalResidentialUnits', pm_inputs.total_residential_units,
      'totalBedrooms', pm_inputs.total_bedrooms
    )
  ),
  pm_inputs.espm_property_use_id,
  pm_inputs.espm_use_details_id
FROM "portfolio_manager_property_use_inputs" pm_inputs
WHERE NOT EXISTS (
  SELECT 1
  FROM "building_property_uses" existing
  WHERE existing.organization_id = pm_inputs.organization_id
    AND existing.building_id = pm_inputs.building_id
    AND existing.sort_order = pm_inputs.sort_order
);

INSERT INTO "building_property_uses" (
  "id",
  "organization_id",
  "building_id",
  "sort_order",
  "use_key",
  "display_name",
  "gross_square_feet",
  "details_json"
)
SELECT
  'bpu_' || substr(md5(buildings.id || ':default'), 1, 24),
  buildings.organization_id,
  buildings.id,
  0,
  CASE
    WHEN buildings.property_type = 'MULTIFAMILY' THEN 'MULTIFAMILY_HOUSING'::"BuildingPropertyUseType"
    ELSE 'OFFICE'::"BuildingPropertyUseType"
  END,
  CASE
    WHEN buildings.property_type = 'MULTIFAMILY' THEN buildings.name || ' Multifamily Housing'
    ELSE buildings.name || ' Office'
  END,
  buildings.gross_square_feet,
  '{}'::jsonb
FROM "buildings" buildings
WHERE buildings.property_type IN ('OFFICE', 'MULTIFAMILY')
  AND NOT EXISTS (
    SELECT 1
    FROM "building_property_uses" uses
    WHERE uses.building_id = buildings.id
      AND uses.organization_id = buildings.organization_id
  );

WITH derived_types AS (
  SELECT
    uses.building_id,
    CASE
      WHEN COUNT(*) > 1 THEN 'MIXED_USE'
      WHEN MIN(uses.use_key) = 'MULTIFAMILY_HOUSING' THEN 'MULTIFAMILY'
      WHEN MIN(uses.use_key) IN ('OFFICE', 'BANK_BRANCH', 'FINANCIAL_OFFICE') THEN 'OFFICE'
      ELSE 'OTHER'
    END AS derived_property_type
  FROM "building_property_uses" uses
  GROUP BY uses.building_id
)
UPDATE "buildings" buildings
SET
  "property_type" = derived_types.derived_property_type::"PropertyType",
  "beps_target_score" = CASE derived_types.derived_property_type
    WHEN 'OFFICE' THEN 71
    WHEN 'MULTIFAMILY' THEN 61
    WHEN 'MIXED_USE' THEN 66
    ELSE 50
  END
FROM derived_types
WHERE derived_types.building_id = buildings.id;
